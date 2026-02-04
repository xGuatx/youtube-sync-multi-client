class SyncJam {
    constructor() {
        this.socket = null;
        this.roomState = {
            queue: [],
            currentTrackIndex: 0,
            isPlaying: false,
            currentTime: 0
        };
        this.audioPlayer = null;
        this.volume = 0.7;
        this.elements = {};
        this.lastReloadTime = 0; // Last reload timestamp

        // Anti-loop resync
        this.lastResyncTime = 0; // Last resync timestamp
        this.resyncCooldown = 2000; // 2 seconds between each resync
        this.isTransitioning = false; // Transitional state during track change
        this.consecutiveResyncs = 0; // Consecutive resyncs counter
        this.maxConsecutiveResyncs = 3; // Limit before entering degraded mode

        // Play/pause anti-spam protection
        this.lastPlayPauseTime = 0;
        this.playPauseCooldown = 400; // 400ms minimum between clicks
        this.playPausePending = false; // Indicates if an action is in progress

        // Protection against resync pendulum effect
        this.isAdjustingPlaybackRate = false;

        this.initializeSocket();
        this.initializeUI();
        this.setupEventListeners();
        this.initializeAudioPlayer();
    }

    initializeSocket() {
        this.socket = io();
        this.clientLatency = 0;
        this.serverTimeOffset = 0;
        this.latencyInterval = null; // Store interval reference

        // Get last reload timestamp from localStorage
        const lastReload = localStorage.getItem('lastReloadTime');
        if (lastReload) {
            this.lastReloadTime = parseInt(lastReload);
        }

        this.socket.on('connect', () => {
            console.log('[Socket] Connected to server');
            this.updateConnectionStatus(true);

            // Start measuring latency
            this.startLatencyMeasurement();
        });

        this.socket.on('disconnect', () => {
            console.log('[Socket] Disconnected from server');
            this.updateConnectionStatus(false);
        });

        this.socket.on('room-state', (state) => {
            console.log('[Room] Room state received:', state);
            this.roomState = state;
            this.updateUI();
        });

        this.socket.on('queue-update', (state) => {
            console.log('[Queue] Queue update:', state);

            // Detect track change
            const trackChanged = this.roomState.currentTrackIndex !== state.currentTrackIndex;

            if (trackChanged) {
                console.log('[Track] Track change detected, entering transition mode');
                this.isTransitioning = true;
                this.consecutiveResyncs = 0; // Reset resyncs on track change

                // Exit transition mode after 3 seconds
                setTimeout(() => {
                    this.isTransitioning = false;
                    console.log('[Track] Transition mode ended');
                }, 3000);
            }

            this.roomState = state;
            this.updateUI();

            // Load current track if it changed
            const currentTrack = this.getCurrentTrack();
            if (currentTrack) {
                this.loadAudioForTrack(currentTrack);
            }

            // Preload next track
            this.preloadNextTrack();
        });

        this.socket.on('player-update', (update) => {
            console.log('[Player] Player update:', update);
            this.roomState.isPlaying = update.isPlaying;
            this.roomState.currentTime = update.currentTime;

            // Re-enable play/pause button (server confirmation received)
            this.playPausePending = false;
            this.elements.playPauseBtn.style.opacity = '1';
            this.elements.playPauseBtn.style.pointerEvents = 'auto';

            // Update play/pause button UI immediately
            this.updatePlayerUI();

            if (this.roomState.isPlaying) {
                this.playCurrentTrack();
            } else {
                this.pauseCurrentTrack();
            }
        });

        // Prepare for synchronized playback
        this.socket.on('prepare-playback', async (data) => {
            console.log('[Sync] Preparing synchronized playback...', data);
            await this.prepareForSynchronizedPlayback(data);
        });

        // Synchronized play command
        this.socket.on('synchronized-play', (data) => {
            console.log('[Sync] Synchronized playback started', data);

            // Re-enable play/pause button (playback confirmed)
            this.playPausePending = false;
            if (this.elements.playPauseBtn) {
                this.elements.playPauseBtn.style.opacity = '1';
                this.elements.playPauseBtn.style.pointerEvents = 'auto';
            }

            this.executeSynchronizedPlay(data);
        });

        // High-frequency synchronization
        this.socket.on('sync-time', (data) => {
            this.handleTimeSync(data);
        });

        // Ping response
        this.socket.on('pong', (data) => {
            this.clientLatency = data.latency;
            this.serverTimeOffset = data.serverTimestamp - Date.now();
            console.log(`[Latency] Latency: ${this.clientLatency}ms, Server offset: ${this.serverTimeOffset}ms`);
        });

        // Force reload when requested by server (with anti-spam protection)
        this.socket.on('force-reload', (data) => {
            const now = Date.now();
            const timeSinceLastReload = now - this.lastReloadTime;

            // Prevent reloads more frequent than once every 30 seconds
            if (timeSinceLastReload < 30000 && this.lastReloadTime > 0) {
                console.warn(`[Reload] Reload ignored (too frequent: ${Math.floor(timeSinceLastReload/1000)}s since last)`);
                return;
            }

            console.log('[Reload] Force reload:', data.message);
            this.lastReloadTime = now;
            localStorage.setItem('lastReloadTime', now); // Persist to avoid reload loops

            setTimeout(() => {
                window.location.reload(true); // true to force reload from server
            }, 1000); // 1s delay to show message
        });
    }

    startLatencyMeasurement() {
        // Cancel previous interval if exists (avoids memory leaks on reconnections)
        if (this.latencyInterval) {
            clearInterval(this.latencyInterval);
        }

        // Measure latency every 5 seconds
        this.latencyInterval = setInterval(() => {
            this.socket.emit('ping', Date.now());
        }, 5000);

        // First measurement immediately
        this.socket.emit('ping', Date.now());
    }

    async prepareForSynchronizedPlayback(data) {
        try {
            // Enable transition mode during buffering
            console.log('[Sync] Preparing playback, transition mode active');
            this.isTransitioning = true;

            const track = this.roomState.queue[data.trackIndex];
            if (!track) {
                console.error('[Sync] Track not found:', data.trackIndex);
                this.isTransitioning = false;
                return;
            }

            // Load track if necessary
            if (!this.audioPlayer || this.audioPlayer.currentTrackId !== track.id) {
                console.log('[Audio] Loading track:', track.title);
                await this.loadAudioForTrack(track);
            }

            // Wait for audio to be buffered (at least 3 seconds)
            await this.waitForBuffer(3);

            // Position at the right time
            if (this.audioPlayer && this.audioPlayer.audioElement) {
                this.audioPlayer.audioElement.currentTime = data.startTime;
            }

            // Signal to server that we are ready
            console.log('[Sync] Pre-buffering complete, signaling server');
            this.socket.emit('ready-to-play');

        } catch (error) {
            console.error('[Sync] Playback preparation error:', error);
            this.isTransitioning = false;
        }
    }

    async waitForBuffer(minSeconds = 3) {
        return new Promise((resolve) => {
            if (!this.audioPlayer || !this.audioPlayer.audioElement) {
                resolve();
                return;
            }

            const audio = this.audioPlayer.audioElement;
            const checkBuffer = () => {
                if (audio.readyState >= 3) { // HAVE_FUTURE_DATA
                    const buffered = audio.buffered;
                    if (buffered.length > 0) {
                        const bufferedEnd = buffered.end(buffered.length - 1);
                        const bufferedAmount = bufferedEnd - audio.currentTime;

                        if (bufferedAmount >= minSeconds) {
                            console.log(`[Buffer] Buffered: ${bufferedAmount.toFixed(1)}s`);
                            resolve();
                            return;
                        }
                    }
                }

                // Timeout after 10 seconds
                if (Date.now() - startTime > 10000) {
                    console.warn('[Buffer] Buffering timeout, starting anyway');
                    resolve();
                    return;
                }

                setTimeout(checkBuffer, 100);
            };

            const startTime = Date.now();
            checkBuffer();
        });
    }

    executeSynchronizedPlay(data) {
        if (!this.audioPlayer || !this.audioPlayer.audioElement) {
            console.warn('[Sync] Audio player not available');
            this.isTransitioning = false;
            return;
        }

        // Calculate precise timing with latency compensation
        const now = Date.now();
        const timeSinceServer = (now - data.serverTimestamp) / 1000;
        const adjustedTime = data.startTime + timeSinceServer + (this.clientLatency / 1000);

        console.log(`[Sync] Synchronized play: ${adjustedTime.toFixed(3)}s (compensation: ${this.clientLatency}ms)`);

        // Position and play
        this.audioPlayer.audioElement.currentTime = adjustedTime;
        this.audioPlayer.play(adjustedTime);

        this.roomState.isPlaying = true;
        this.updateUI();

        // Disable transition mode after playback starts
        setTimeout(() => {
            this.isTransitioning = false;
            console.log('[Sync] Playback started, transition mode disabled');
        }, 1000);
    }

    handleTimeSync(data) {
        // Periodic resync to avoid drift
        if (!this.audioPlayer || !this.audioPlayer.audioElement || !this.roomState.isPlaying) {
            return;
        }

        // Ignore syncs during transitional states
        if (this.isTransitioning) {
            console.log('[Sync] Sync ignored: transition in progress');
            return;
        }

        const audio = this.audioPlayer.audioElement;
        const serverTime = data.currentTime;
        const clientTime = audio.currentTime;
        const drift = Math.abs(serverTime - clientTime);

        // Adaptive threshold based on consecutive resyncs
        const driftThreshold = this.consecutiveResyncs > 2 ? 0.5 : 0.3; // More tolerant after multiple resyncs

        // If drift > threshold, resync (with cooldown)
        if (drift > driftThreshold) {
            const now = Date.now();
            const timeSinceLastResync = now - this.lastResyncTime;

            // Check cooldown
            if (timeSinceLastResync < this.resyncCooldown) {
                console.log(`[Sync] Resync ignored: cooldown (${Math.floor(timeSinceLastResync/1000)}s/${this.resyncCooldown/1000}s)`);
                return;
            }

            // Check if we reached consecutive resyncs limit
            if (this.consecutiveResyncs >= this.maxConsecutiveResyncs) {
                console.warn(`[Sync] Too many consecutive resyncs (${this.consecutiveResyncs}), degraded mode active`);
                this.resyncCooldown = 5000; // Increase cooldown to 5s
                this.consecutiveResyncs = 0;
                return;
            }

            console.warn(`[Sync] Drift detected: ${(drift * 1000).toFixed(0)}ms, resyncing... (${this.consecutiveResyncs + 1}/${this.maxConsecutiveResyncs})`);

            this.lastResyncTime = now;
            this.consecutiveResyncs++;

            // Soft compensation to avoid abrupt jumps
            if (drift < 1.0) {
                // Avoid pendulum effect: don't modify playbackRate if already in progress
                if (this.isAdjustingPlaybackRate) {
                    console.log('[Sync] PlaybackRate adjustment already in progress, ignored');
                    return;
                }

                // Soft adjustment via temporary playbackRate
                this.isAdjustingPlaybackRate = true;
                audio.playbackRate = serverTime > clientTime ? 1.1 : 0.9;
                setTimeout(() => {
                    if (audio) {
                        audio.playbackRate = 1.0;
                    }
                    this.isAdjustingPlaybackRate = false;
                }, 500);
            } else {
                // Direct jump if drift is too large
                audio.currentTime = serverTime + (this.clientLatency / 1000);
            }

            // Reset counter after 10 seconds without resync
            setTimeout(() => {
                if (Date.now() - this.lastResyncTime >= 10000) {
                    this.consecutiveResyncs = 0;
                    this.resyncCooldown = 2000; // Restore normal cooldown
                    console.log('[Sync] Normal mode restored');
                }
            }, 10000);
        } else {
            // If drift is acceptable, reset counter
            if (drift < 0.1) {
                this.consecutiveResyncs = 0;
            }
        }

        // Update UI with server time
        this.roomState.currentTime = serverTime;
        this.updatePlayerUI();
    }

    initializeUI() {
        this.elements = {
            searchInput: document.getElementById('searchInput'),
            searchBtn: document.getElementById('searchBtn'),
            searchResults: document.getElementById('searchResults'),
            playPauseBtn: document.getElementById('playPauseBtn'),
            prevBtn: document.getElementById('prevBtn'),
            nextBtn: document.getElementById('nextBtn'),
            progressSlider: document.getElementById('progressSlider'),
            progressFill: document.getElementById('progressFill'),
            currentTime: document.getElementById('currentTime'),
            totalTime: document.getElementById('totalTime'),
            volumeSlider: document.getElementById('volumeSlider'),
            queueContainer: document.getElementById('queueContainer'),
            queueCount: document.getElementById('queueCount'),
            nowPlaying: document.getElementById('nowPlaying'),
            statusDot: document.querySelector('.status-dot'),
            statusText: document.querySelector('.status-text')
        };
    }

    setupEventListeners() {
        this.elements.playPauseBtn.addEventListener('click', () => {
            const now = Date.now();

            // Protection against click spam
            if (this.playPausePending) {
                console.log('[Button] Play/Pause ignored: action in progress');
                return;
            }

            if (now - this.lastPlayPauseTime < this.playPauseCooldown) {
                console.log(`[Button] Play/Pause ignored: cooldown (${now - this.lastPlayPauseTime}ms)`);
                return;
            }

            this.lastPlayPauseTime = now;
            this.playPausePending = true;

            // Visually disable button
            this.elements.playPauseBtn.style.opacity = '0.5';
            this.elements.playPauseBtn.style.pointerEvents = 'none';

            if (this.roomState.isPlaying) {
                this.socket.emit('pause');
            } else {
                this.socket.emit('play');
            }

            // Re-enable button after delay
            setTimeout(() => {
                this.playPausePending = false;
                this.elements.playPauseBtn.style.opacity = '1';
                this.elements.playPauseBtn.style.pointerEvents = 'auto';
            }, this.playPauseCooldown);
        });

        this.elements.prevBtn.addEventListener('click', () => {
            this.socket.emit('previous');
        });

        this.elements.nextBtn.addEventListener('click', () => {
            this.socket.emit('skip');
        });

        this.elements.progressSlider.addEventListener('input', (e) => {
            const time = (e.target.value / 100) * this.getCurrentTrackDuration();
            this.seekCurrentTrack(time);
            this.socket.emit('seek', time);
        });

        this.elements.searchBtn.addEventListener('click', () => {
            this.performSearch();
        });

        this.elements.searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.performSearch();
            }
        });

        this.elements.volumeSlider.addEventListener('input', (e) => {
            this.volume = e.target.value / 100;
            this.setVolumeForCurrentTrack(this.volume);
        });
    }

    initializeAudioPlayer() {
        if (window.AudioPlayerManager) {
            this.audioPlayer = new AudioPlayerManager();
            console.log('[Audio] Audio Player initialized');
        } else {
            setTimeout(() => {
                if (window.AudioPlayerManager) {
                    this.audioPlayer = new AudioPlayerManager();
                    console.log('[Audio] Audio Player initialized (deferred)');
                }
            }, 1000);
        }
    }

    updateConnectionStatus(connected) {
        if (connected) {
            this.elements.statusDot.classList.add('connected');
            this.elements.statusText.textContent = 'Connected';
        } else {
            this.elements.statusDot.classList.remove('connected');
            this.elements.statusText.textContent = 'Disconnected';
        }
    }

    updateUI() {
        this.updatePlayerUI();
        this.updateQueueUI();
        this.updateNowPlaying();
    }

    updatePlayerUI() {
        this.elements.playPauseBtn.textContent = this.roomState.isPlaying ? 'II' : '>';

        const currentTrack = this.getCurrentTrack();
        if (currentTrack) {
            const progress = (this.roomState.currentTime / currentTrack.duration) * 100;
            this.elements.progressFill.style.width = `${progress}%`;
            this.elements.progressSlider.value = progress;

            this.elements.currentTime.textContent = this.formatTime(this.roomState.currentTime);
            this.elements.totalTime.textContent = this.formatTime(currentTrack.duration);
        } else {
            this.elements.progressFill.style.width = '0%';
            this.elements.progressSlider.value = 0;
            this.elements.currentTime.textContent = '0:00';
            this.elements.totalTime.textContent = '0:00';
        }
    }

    updateNowPlaying() {
        const currentTrack = this.getCurrentTrack();
        const trackTitle = this.elements.nowPlaying.querySelector('.track-title');
        const trackArtist = this.elements.nowPlaying.querySelector('.track-artist');

        if (currentTrack) {
            trackTitle.textContent = currentTrack.title;
            trackArtist.textContent = currentTrack.artist;
        } else {
            trackTitle.textContent = 'No music';
            trackArtist.textContent = 'Select a track';
        }
    }

    updateQueueUI() {
        const container = this.elements.queueContainer;
        const count = this.elements.queueCount;

        count.textContent = `${this.roomState.queue.length} track${this.roomState.queue.length !== 1 ? 's' : ''}`;

        if (this.roomState.queue.length === 0) {
            container.innerHTML = '<div class="queue-empty">No tracks in queue</div>';
            return;
        }

        container.innerHTML = this.roomState.queue.map((track, index) => `
            <div class="queue-item ${index === this.roomState.currentTrackIndex ? 'playing' : ''}"
                 data-index="${index}">
                <div class="track-info">
                    <div class="track-title">${track.title}</div>
                    <div class="track-artist">${track.artist}</div>
                </div>
                <div class="source-badge ${track.source}">${track.source}</div>
                <div class="track-duration">${this.formatTime(track.duration)}</div>
                <button class="remove-btn" data-index="${index}" title="Remove from queue">X</button>
            </div>
        `).join('');

        this.setupQueueInteractions(container);
    }

    setupQueueInteractions(container) {
        container.querySelectorAll('.queue-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.classList.contains('remove-btn')) {
                    const index = parseInt(e.currentTarget.dataset.index);
                    this.jumpToTrack(index);
                }
            });
        });

        container.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                this.removeFromQueue(index);
            });
        });
    }

    async performSearch() {
        const query = this.elements.searchInput.value.trim();
        if (!query) {
            this.elements.searchResults.innerHTML = '';
            return;
        }

        this.elements.searchResults.innerHTML = '<div style="padding: 1rem; text-align: center;">Searching...</div>';

        try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=10`);
            const data = await response.json();

            if (response.ok) {
                this.displaySearchResults(data.results || []);
            } else {
                throw new Error(data.error || 'Search error');
            }
        } catch (error) {
            console.error('[Search] Search error:', error);
            this.elements.searchResults.innerHTML = `
                <div style="padding: 1rem; text-align: center; color: #ff6b6b;">
                    Search error: ${error.message}
                </div>
            `;
        }
    }

    displaySearchResults(results) {
        if (results.length === 0) {
            this.elements.searchResults.innerHTML = '<div style="padding: 1rem; text-align: center;">No results found</div>';
            return;
        }

        this.elements.searchResults.innerHTML = results.map(track => `
            <div class="search-result-item" data-track='${JSON.stringify(track)}'>
                <div class="track-info">
                    <div class="track-title">${track.title}</div>
                    <div class="track-artist">${track.artist} - ${this.formatTime(track.duration)} - ${track.source}</div>
                </div>
                <button class="add-btn">Add</button>
            </div>
        `).join('');

        this.elements.searchResults.querySelectorAll('.add-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const trackData = JSON.parse(e.target.parentElement.dataset.track);
                this.addToQueue(trackData);
            });
        });
    }

    addToQueue(track) {
        console.log('[Queue] Adding to queue:', track.title);
        this.socket.emit('add-to-queue', track);
    }

    removeFromQueue(index) {
        console.log('[Queue] Removing from queue:', index);
        this.socket.emit('remove-from-queue', index);
    }

    jumpToTrack(index) {
        if (index >= 0 && index < this.roomState.queue.length) {
            this.socket.emit('jump-to-track', index);
        }
    }

    getCurrentTrack() {
        return this.roomState.queue[this.roomState.currentTrackIndex] || null;
    }

    getCurrentTrackDuration() {
        const track = this.getCurrentTrack();
        return track ? track.duration : 0;
    }

    loadAudioForTrack(track) {
        if (!track || !this.audioPlayer) return;

        console.log('[Audio] Loading audio for:', track.title);

        if (track.source === 'youtube') {
            this.audioPlayer.loadTrack(track.id);
        } else {
            console.error('[Audio] Unsupported source:', track.source);
        }
    }

    async playCurrentTrack() {
        if (!this.audioPlayer || this.audioPlayer.pendingPlay) return;

        console.log('[Audio] Playing current track');

        // Make sure a track is loaded
        const currentTrack = this.getCurrentTrack();
        if (currentTrack && this.audioPlayer.currentTrackId !== currentTrack.id) {
            await this.audioPlayer.loadTrack(currentTrack.id);
        }

        await this.audioPlayer.play(this.roomState.currentTime);
    }

    async pauseCurrentTrack() {
        if (!this.audioPlayer || this.audioPlayer.pendingPause) return;

        console.log('[Audio] Pausing current track');
        await this.audioPlayer.pause();
    }

    seekCurrentTrack(time) {
        if (!this.audioPlayer) return;

        console.log('[Audio] Seeking to:', time);
        this.audioPlayer.seekTo(time);
    }

    setVolumeForCurrentTrack(volume) {
        if (!this.audioPlayer) return;

        this.audioPlayer.setVolume(volume);
    }

    onAudioTrackEnded() {
        console.log('[Audio] Track ended, skipping to next');
        this.socket.emit('skip');
    }

    preloadNextTrack() {
        if (!this.audioPlayer) return;

        const nextIndex = this.roomState.currentTrackIndex + 1;
        if (nextIndex < this.roomState.queue.length) {
            const nextTrack = this.roomState.queue[nextIndex];
            if (nextTrack && nextTrack.source === 'youtube') {
                console.log('[Audio] Preloading next track:', nextTrack.title);
                this.audioPlayer.preloadNextTrack(nextTrack.id);
            }
        }
    }

    onAudioError() {
        console.error('[Audio] Audio Player error, skipping to next');
        this.socket.emit('skip');
    }

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    window.jamApp = new SyncJam();
    console.log('[App] SyncJam initialized');
});
