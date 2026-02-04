class AudioPlayerManager {
    constructor() {
        this.audioElement = null;
        this.isReady = false;
        this.currentTrackId = null;
        this.isPlaying = false;
        this.volume = 0.7;
        this.currentTime = 0;
        this.duration = 0;
        this.pendingPlay = false;
        this.pendingPause = false;
        this.supportedFormats = {};

        // Next track preloading
        this.nextAudioElement = null;
        this.nextTrackId = null;
        this.preloadedNextTrack = false;

        // Audio healthcheck
        this.lastTimeUpdate = Date.now();
        this.healthCheckInterval = null;
        this.audioStallDetected = false;

        this.detectAudioSupport();
        this.initializeAudioElement();
        this.startHealthCheck();
    }

    detectAudioSupport() {
        const audio = new Audio();

        // Test common audio formats
        this.supportedFormats = {
            mp3: audio.canPlayType('audio/mpeg') !== '',
            mp4: audio.canPlayType('audio/mp4; codecs="mp4a.40.2"') !== '',
            m4a: audio.canPlayType('audio/x-m4a') !== '' || audio.canPlayType('audio/mp4') !== '',
            webm: audio.canPlayType('audio/webm; codecs="opus"') !== '',
            opus: audio.canPlayType('audio/webm; codecs="opus"') !== '',
            ogg: audio.canPlayType('audio/ogg; codecs="vorbis"') !== '',
            wav: audio.canPlayType('audio/wav') !== ''
        };

        console.log('[AudioPlayer] Supported audio formats:', this.supportedFormats);

        // Check if at least one format is supported
        const hasSupport = Object.values(this.supportedFormats).some(v => v);
        if (!hasSupport) {
            console.error('[AudioPlayer] No supported audio format detected!');
        }
    }

    initializeAudioElement() {
        // Create HTML5 audio element
        this.audioElement = new Audio();
        this.audioElement.volume = this.volume;
        this.audioElement.crossOrigin = 'anonymous';

        // Audio events
        this.audioElement.addEventListener('loadstart', () => {
            console.log('[AudioPlayer] Audio loading started');
        });

        this.audioElement.addEventListener('canplay', () => {
            console.log('[AudioPlayer] Audio ready to play');
            this.isReady = true;
            this.duration = this.audioElement.duration;
        });

        this.audioElement.addEventListener('play', () => {
            console.log('[AudioPlayer] Audio playback started');
            this.isPlaying = true;
        });

        this.audioElement.addEventListener('pause', () => {
            console.log('[AudioPlayer] Audio paused');
            this.isPlaying = false;
        });

        this.audioElement.addEventListener('ended', () => {
            console.log('[AudioPlayer] Audio ended');
            this.isPlaying = false;
            this.handleTrackEnded();
        });

        this.audioElement.addEventListener('timeupdate', () => {
            if (this.audioElement && !this.audioElement.paused) {
                this.currentTime = this.audioElement.currentTime;
                this.duration = this.audioElement.duration;
                this.lastTimeUpdate = Date.now();
                this.audioStallDetected = false;
            }
        });

        this.audioElement.addEventListener('error', (e) => {
            console.error('[AudioPlayer] Audio error:', e);
            this.handleError();
        });

        console.log('[AudioPlayer] Audio Player initialized');
    }

    async loadTrack(trackId) {
        if (!trackId) {
            console.warn('[AudioPlayer] No track ID provided');
            return false;
        }

        if (this.currentTrackId === trackId) {
            console.log('[AudioPlayer] Track already loaded:', trackId);
            return true;
        }

        try {
            console.log('[AudioPlayer] Loading audio for:', trackId);

            // Get audio URL from server
            const response = await fetch(`/api/audio/${trackId}`);
            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            const data = await response.json();
            if (!data.audioUrl) {
                throw new Error('Audio URL not available');
            }

            console.log('[AudioPlayer] Audio URL retrieved:', data.audioUrl);
            this.currentTrackId = trackId;
            this.audioElement.src = data.audioUrl;
            console.log('[AudioPlayer] Audio source set:', this.audioElement.src);
            this.audioElement.load();

            return true;
        } catch (error) {
            console.error('[AudioPlayer] Audio loading error:', error);
            this.handleError();
            return false;
        }
    }

    async play(startTime = 0) {
        if (!this.audioElement || this.pendingPlay) {
            console.warn('[AudioPlayer] Audio element not ready or play already pending');
            return false;
        }

        // Avoid concurrent calls
        if (this.pendingPause) {
            this.pendingPause = false;
        }

        this.pendingPlay = true;

        try {
            if (startTime > 0) {
                this.audioElement.currentTime = startTime;
            }

            await this.audioElement.play();
            console.log('[AudioPlayer] Playback started');
            this.pendingPlay = false;
            return true;
        } catch (error) {
            console.error('[AudioPlayer] Play error:', error);
            this.pendingPlay = false;
            return false;
        }
    }

    async pause() {
        if (!this.audioElement || this.pendingPause) return false;

        // Avoid concurrent calls
        if (this.pendingPlay) {
            this.pendingPlay = false;
        }

        this.pendingPause = true;

        try {
            this.audioElement.pause();
            this.pendingPause = false;
            return true;
        } catch (error) {
            console.error('[AudioPlayer] Pause error:', error);
            this.pendingPause = false;
            return false;
        }
    }

    async seekTo(time) {
        if (!this.audioElement) return false;

        try {
            this.audioElement.currentTime = time;
            this.currentTime = time;
            return true;
        } catch (error) {
            console.error('[AudioPlayer] Seek error:', error);
            return false;
        }
    }

    setVolume(volume) {
        if (!this.audioElement) return false;

        try {
            this.volume = Math.max(0, Math.min(1, volume));
            this.audioElement.volume = this.volume;
            return true;
        } catch (error) {
            console.error('[AudioPlayer] Volume error:', error);
            return false;
        }
    }

    getCurrentTime() {
        return this.audioElement ? this.audioElement.currentTime : 0;
    }

    getDuration() {
        return this.audioElement ? this.audioElement.duration : 0;
    }

    handleTrackEnded() {
        console.log('[AudioPlayer] Track ended');
        if (window.jamApp) {
            window.jamApp.onAudioTrackEnded();
        }
    }

    handleError() {
        console.error('[AudioPlayer] Audio Player error');
        if (window.jamApp) {
            window.jamApp.onAudioError();
        }
    }

    startHealthCheck() {
        // Check every 2 seconds that audio is progressing normally
        this.healthCheckInterval = setInterval(() => {
            if (this.isPlaying && this.audioElement && !this.audioElement.paused) {
                const timeSinceLastUpdate = Date.now() - this.lastTimeUpdate;

                // If no update for 3 seconds, audio is stalled
                if (timeSinceLastUpdate > 3000 && !this.audioStallDetected) {
                    console.error('[AudioPlayer] Audio stall detected! No progress for 3s');
                    this.audioStallDetected = true;
                    this.handleAudioStall();
                }
            }
        }, 2000);
    }

    handleAudioStall() {
        console.warn('[AudioPlayer] Attempting audio recovery...');

        // Recovery strategies
        if (this.audioElement) {
            const currentTime = this.audioElement.currentTime;

            // Strategy 1: Reload from current position
            this.audioElement.load();
            setTimeout(() => {
                if (this.audioElement) {
                    this.audioElement.currentTime = currentTime;
                    this.audioElement.play().catch(err => {
                        console.error('[AudioPlayer] Recovery failed:', err);
                        this.handleError();
                    });
                }
            }, 500);
        }
    }

    async preloadNextTrack(nextTrackId) {
        if (!nextTrackId || this.nextTrackId === nextTrackId) {
            return; // Already preloaded
        }

        try {
            console.log('[AudioPlayer] Preloading next track:', nextTrackId);

            // Create new audio element for next track
            if (this.nextAudioElement) {
                this.nextAudioElement.pause();
                this.nextAudioElement.src = '';
            }

            const response = await fetch(`/api/audio/${nextTrackId}`);
            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            const data = await response.json();
            if (!data.audioUrl) {
                throw new Error('Audio URL not available');
            }

            // Check format compatibility
            const isCompatible = await this.checkAudioCompatibility(data.audioUrl);
            if (!isCompatible) {
                console.warn('[AudioPlayer] Potentially incompatible audio format for:', nextTrackId);
            }

            this.nextAudioElement = new Audio();
            this.nextAudioElement.crossOrigin = 'anonymous';
            this.nextAudioElement.src = data.audioUrl;
            this.nextAudioElement.preload = 'auto';
            this.nextTrackId = nextTrackId;
            this.preloadedNextTrack = true;

            console.log('[AudioPlayer] Next track preloaded:', nextTrackId);
        } catch (error) {
            console.error('[AudioPlayer] Next track preload error:', error);
            this.preloadedNextTrack = false;
        }
    }

    async checkAudioCompatibility(audioUrl) {
        return new Promise((resolve) => {
            const testAudio = new Audio();
            testAudio.crossOrigin = 'anonymous';

            const timeout = setTimeout(() => {
                testAudio.src = '';
                resolve(false); // Timeout = incompatible
            }, 5000);

            testAudio.addEventListener('canplay', () => {
                clearTimeout(timeout);
                testAudio.src = '';
                resolve(true);
            });

            testAudio.addEventListener('error', () => {
                clearTimeout(timeout);
                testAudio.src = '';
                resolve(false);
            });

            testAudio.src = audioUrl;
        });
    }

    switchToPreloadedTrack() {
        if (this.preloadedNextTrack && this.nextAudioElement) {
            console.log('[AudioPlayer] Switching to preloaded track');

            // Cleanup old player
            if (this.audioElement) {
                this.audioElement.pause();
                this.audioElement.src = '';
            }

            // Copy event listeners
            const oldElement = this.audioElement;
            this.audioElement = this.nextAudioElement;
            this.currentTrackId = this.nextTrackId;
            this.audioElement.volume = this.volume;

            // Reset preloading
            this.nextAudioElement = null;
            this.nextTrackId = null;
            this.preloadedNextTrack = false;

            // Reattach events
            this.attachAudioEvents();

            return true;
        }
        return false;
    }

    attachAudioEvents() {
        if (!this.audioElement) return;

        this.audioElement.addEventListener('play', () => {
            console.log('[AudioPlayer] Audio playback started');
            this.isPlaying = true;
        });

        this.audioElement.addEventListener('pause', () => {
            console.log('[AudioPlayer] Audio paused');
            this.isPlaying = false;
        });

        this.audioElement.addEventListener('ended', () => {
            console.log('[AudioPlayer] Audio ended');
            this.isPlaying = false;
            this.handleTrackEnded();
        });

        this.audioElement.addEventListener('timeupdate', () => {
            if (this.audioElement && !this.audioElement.paused) {
                this.currentTime = this.audioElement.currentTime;
                this.duration = this.audioElement.duration;
                this.lastTimeUpdate = Date.now();
                this.audioStallDetected = false;
            }
        });

        this.audioElement.addEventListener('error', (e) => {
            console.error('[AudioPlayer] Audio error:', e);
            this.handleError();
        });
    }

    destroy() {
        // Cleanup healthcheck
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }

        // Cleanup audio elements
        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.src = '';
            this.audioElement = null;
        }

        if (this.nextAudioElement) {
            this.nextAudioElement.pause();
            this.nextAudioElement.src = '';
            this.nextAudioElement = null;
        }
    }
}

// Global export
window.AudioPlayerManager = AudioPlayerManager;
