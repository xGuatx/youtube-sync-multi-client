const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Redis initialization
const redisClient = require('./services/redisClient');
const RoomStateManager = require('./services/roomStateManager');

let roomStateManager;
let roomState = {
  queue: [],
  currentTrackIndex: 0,
  isPlaying: false,
  currentTime: 0,
  startTime: null,
  users: new Map(),
  serverStartTimestamp: null
};

let syncInterval = null;
const SYNC_INTERVAL = 100;

// Protection against simultaneous play/pause commands
let playPauseLock = false;
let lastPlayPauseTime = 0;
const PLAY_PAUSE_COOLDOWN = 300; // 300ms minimum between play/pause commands

// Timeout for waiting clients to be ready
let readyTimeout = null;
const READY_TIMEOUT_MS = 10000; // 10 seconds max to wait for all clients

const searchRoutes = require('./routes/search');
const YouTubeAudioService = require('./services/youtubeAudio');

const youtubeAudio = new YouTubeAudioService();

app.use('/api/search', searchRoutes);

// Route to force reload all clients
app.post('/api/admin/reload-clients', (req, res) => {
  console.log('[Admin] Force reload requested for all clients');
  io.emit('force-reload', { message: 'New version available, reloading...' });
  res.json({ success: true, message: 'Reload command sent to all clients' });
});

// Function to start synchronized playback
function startSynchronizedPlayback() {
  if (!syncInterval) {
    console.log('[Sync] Starting high-frequency synchronization (100ms)');

    syncInterval = setInterval(() => {
      if (roomState.isPlaying && roomState.queue.length > 0) {
        // Calculate precise elapsed time
        const elapsed = (Date.now() - roomState.startTime) / 1000;
        roomState.currentTime = elapsed;

        const currentTrack = roomState.queue[roomState.currentTrackIndex];

        // Check if track has ended
        if (currentTrack && roomState.currentTime >= currentTrack.duration) {
          if (roomState.currentTrackIndex < roomState.queue.length - 1) {
            // Temporarily stop syncs during track change
            clearInterval(syncInterval);
            syncInterval = null;

            // Move to next track
            roomState.currentTrackIndex++;
            roomState.currentTime = 0;
            roomState.startTime = Date.now();
            roomState.serverStartTimestamp = Date.now();

            // Reset ready state for new track
            roomState.users.forEach(user => user.ready = false);

            console.log('[Track] Moving to next track, waiting for buffering...');
            io.emit('queue-update', roomState);

            // Wait before requesting pre-buffering to avoid resyncs during transition
            setTimeout(() => {
              io.emit('prepare-playback', {
                trackIndex: roomState.currentTrackIndex,
                startTime: 0,
                serverTimestamp: Date.now()
              });
            }, 500);
          } else {
            // End of queue
            roomState.isPlaying = false;
            roomState.currentTime = 0;
            clearInterval(syncInterval);
            syncInterval = null;

            console.log('[Queue] End of queue reached');
            io.emit('player-update', {
              isPlaying: false,
              currentTime: 0
            });
          }
        }

        // Send high-frequency sync with server timestamp
        io.emit('sync-time', {
          currentTime: roomState.currentTime,
          isPlaying: roomState.isPlaying,
          currentTrackIndex: roomState.currentTrackIndex,
          serverTimestamp: Date.now()
        });
      }
    }, SYNC_INTERVAL);
  }

  // Send synchronized play command immediately
  io.emit('synchronized-play', {
    startTime: roomState.currentTime,
    serverTimestamp: Date.now(),
    isPlaying: true
  });
}

// Route to provide track audio
app.get('/api/audio/:trackId', async (req, res) => {
  const { trackId } = req.params;

  try {
    console.log('[Audio] Request for trackId:', trackId);

    // Check if it's a valid YouTube ID (11 alphanumeric characters)
    const isYouTubeId = /^[a-zA-Z0-9_-]{11}$/.test(trackId);

    // Return local audio proxy URL
    res.json({
      audioUrl: `/api/audio-stream/${trackId}`,
      trackId: trackId,
      type: isYouTubeId ? 'youtube' : 'unknown',
      duration: 0,
      success: true
    });

  } catch (error) {
    console.error('[Audio] Error fetching audio:', error);
    res.status(500).json({
      error: 'Error fetching audio',
      trackId: trackId,
      success: false
    });
  }
});

// Support for HEAD requests (audio metadata)
app.head('/api/audio-stream/:trackId', async (req, res) => {
  try {
    const { trackId } = req.params;
    const isYouTubeId = /^[a-zA-Z0-9_-]{11}$/.test(trackId);

    if (!isYouTubeId) {
      return res.status(400).end();
    }

    const audioInfo = await youtubeAudio.getAudioUrl(trackId);

    // Get headers from source with timeout
    const headResponse = await axios({
      method: 'HEAD',
      url: audioInfo.url,
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
      }
    });

    // Propagate important headers
    res.setHeader('Content-Type', headResponse.headers['content-type'] || 'audio/mp4');
    res.setHeader('Content-Length', headResponse.headers['content-length'] || '0');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Accept-Ranges');

    res.status(200).end();
  } catch (error) {
    console.error('[Audio] HEAD request error:', error.message);
    res.status(404).end();
  }
});

// Proxy route for audio streaming with Range support (chunks)
app.get('/api/audio-stream/:trackId', async (req, res) => {
  const { trackId } = req.params;

  try {
    console.log('[Stream] Audio streaming for:', trackId);

    // Check if it's a valid YouTube ID
    const isYouTubeId = /^[a-zA-Z0-9_-]{11}$/.test(trackId);
    let audioUrl;

    if (isYouTubeId) {
      // Get direct YouTube URL for streaming
      try {
        const audioInfo = await youtubeAudio.getAudioUrl(trackId);
        audioUrl = audioInfo.url;

        console.log(`[Stream] YouTube direct URL obtained: ${audioInfo.title}`);
      } catch (error) {
        console.error('[Stream] YouTube extraction error:', error.message);
        return res.status(404).json({
          error: 'Audio not available',
          message: error.message
        });
      }
    } else {
      return res.status(400).json({
        error: 'Unsupported track ID',
        message: 'Only YouTube IDs are supported'
      });
    }

    // Handle Range requests for seeking
    const range = req.headers.range;
    console.log(`[Stream] Range request: ${range || 'none'}`);

    try {
      // Headers for YouTube request
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
      };

      // Add Range header if present
      if (range) {
        headers['Range'] = range;
      }

      // Make YouTube request with range support and timeout
      const response = await axios({
        method: 'GET',
        url: audioUrl,
        headers: headers,
        responseType: 'stream',
        timeout: 15000,
        validateStatus: status => status < 300 || status === 206 || status === 416
      });

      // Base headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Length, Content-Range');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
      res.setHeader('Accept-Ranges', 'bytes');

      // Propagate YouTube headers
      if (response.headers['content-type']) {
        res.setHeader('Content-Type', response.headers['content-type']);
      }
      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      }
      if (response.headers['content-range']) {
        res.setHeader('Content-Range', response.headers['content-range']);
      }

      // Set appropriate status code
      const statusCode = response.status === 206 ? 206 : 200;
      res.status(statusCode);

      console.log(`[Stream] Response: ${statusCode}, Content-Length: ${response.headers['content-length']}`);

      // Stream the response
      response.data.pipe(res);

      // Handle stream errors
      response.data.on('error', (error) => {
        console.error('[Stream] YouTube stream error:', error.message);
        if (!res.headersSent) {
          res.status(500).end();
        }
      });

    } catch (error) {
      console.error('[Stream] YouTube request error:', error.message);
      if (error.response?.status === 416) {
        res.status(416).json({ error: 'Range Not Satisfiable' });
      } else {
        res.status(500).json({ error: 'Streaming error' });
      }
    }

  } catch (error) {
    console.error('[Stream] Audio streaming error:', error);
    res.status(500).send('Audio streaming error');
  }
});


io.on('connection', (socket) => {
  console.log(`[Socket] User connected: ${socket.id}`);

  // Initialize user with default latency
  roomState.users.set(socket.id, {
    latency: 0,
    lastPing: Date.now(),
    ready: false
  });

  // Send initial state
  socket.emit('room-state', roomState);

  // Measure network latency (ping-pong)
  socket.on('ping', (timestamp) => {
    const now = Date.now();
    const roundTripTime = now - timestamp;
    const latency = Math.floor(roundTripTime / 2);

    // Validation: reject negative or abnormal latencies
    if (latency < 0) {
      console.warn(`[Latency] Negative latency detected for ${socket.id}: ${latency}ms (clock offset: ${roundTripTime}ms)`);
      return;
    }

    if (latency > 10000) {
      console.warn(`[Latency] Excessive latency for ${socket.id}: ${latency}ms`);
      return;
    }

    const user = roomState.users.get(socket.id);
    if (user) {
      user.latency = latency;
      user.lastPing = now;
    }

    socket.emit('pong', {
      clientTimestamp: timestamp,
      serverTimestamp: now,
      latency: latency
    });

    // Log only if latency > 100ms to reduce spam
    if (latency > 100) {
      console.log(`[Latency] Client ${socket.id}: ${latency}ms`);
    }
  });

  // Client signals it has finished buffering
  socket.on('ready-to-play', () => {
    const user = roomState.users.get(socket.id);
    if (user) {
      user.ready = true;
      console.log(`[Ready] Client ${socket.id} ready to play`);

      // Check if all clients are ready
      const allReady = Array.from(roomState.users.values()).every(u => u.ready);
      const readyCount = Array.from(roomState.users.values()).filter(u => u.ready).length;
      const totalCount = roomState.users.size;

      console.log(`[Ready] Clients ready: ${readyCount}/${totalCount}`);

      if (allReady && roomState.isPlaying) {
        // Cancel timeout if all are ready
        if (readyTimeout) {
          clearTimeout(readyTimeout);
          readyTimeout = null;
        }
        console.log('[Sync] All clients ready, starting synchronized playback');
        startSynchronizedPlayback();
      }
    }
  });

  socket.on('play', async () => {
    try {
      const now = Date.now();

      // Protection against spam and simultaneous commands
      if (playPauseLock) {
        console.log('[Play] Ignored: command already being processed');
        return;
      }

      if (now - lastPlayPauseTime < PLAY_PAUSE_COOLDOWN) {
        console.log(`[Play] Ignored: cooldown (${now - lastPlayPauseTime}ms < ${PLAY_PAUSE_COOLDOWN}ms)`);
        return;
      }

      // Ignore if already playing
      if (roomState.isPlaying) {
        console.log('[Play] Ignored: already playing');
        return;
      }

      playPauseLock = true;
      lastPlayPauseTime = now;

      console.log('[Play] Play request received');

      // Reset ready state for all clients
      roomState.users.forEach(user => user.ready = false);

      roomState.isPlaying = true;
      roomState.serverStartTimestamp = Date.now();
      roomState.startTime = Date.now() - (roomState.currentTime * 1000);

      // Send pre-buffering command to all clients
      io.emit('prepare-playback', {
        trackIndex: roomState.currentTrackIndex,
        startTime: roomState.currentTime,
        serverTimestamp: roomState.serverStartTimestamp
      });

      console.log('[Play] Waiting for all clients to buffer...');

      // Actual play will happen when all clients signal ready-to-play

      // Timeout: start anyway after READY_TIMEOUT_MS if some clients don't respond
      if (readyTimeout) {
        clearTimeout(readyTimeout);
      }
      readyTimeout = setTimeout(() => {
        if (roomState.isPlaying) {
          const readyCount = Array.from(roomState.users.values()).filter(u => u.ready).length;
          const totalCount = roomState.users.size;
          console.warn(`[Timeout] Ready timeout: starting with ${readyCount}/${totalCount} clients ready`);
          startSynchronizedPlayback();
        }
        readyTimeout = null;
      }, READY_TIMEOUT_MS);

      // Release lock after short delay
      setTimeout(() => {
        playPauseLock = false;
      }, 100);

    } catch (error) {
      console.error('[Play] Error:', error);
      playPauseLock = false;
      socket.emit('error', { message: 'Error during playback' });
    }
  });

  socket.on('pause', async () => {
    try {
      const now = Date.now();

      // Protection against spam and simultaneous commands
      if (playPauseLock) {
        console.log('[Pause] Ignored: command already being processed');
        return;
      }

      if (now - lastPlayPauseTime < PLAY_PAUSE_COOLDOWN) {
        console.log(`[Pause] Ignored: cooldown (${now - lastPlayPauseTime}ms < ${PLAY_PAUSE_COOLDOWN}ms)`);
        return;
      }

      // Ignore if already paused
      if (!roomState.isPlaying) {
        console.log('[Pause] Ignored: already paused');
        return;
      }

      playPauseLock = true;
      lastPlayPauseTime = now;

      roomState.isPlaying = false;
      if (roomState.startTime) {
        roomState.currentTime = (Date.now() - roomState.startTime) / 1000;
      }

      // Cancel ready timeout if in progress
      if (readyTimeout) {
        clearTimeout(readyTimeout);
        readyTimeout = null;
      }

      if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
      }

      io.emit('player-update', {
        isPlaying: roomState.isPlaying,
        currentTime: roomState.currentTime
      });

      // Release lock after short delay
      setTimeout(() => {
        playPauseLock = false;
      }, 100);

    } catch (error) {
      console.error('[Pause] Error:', error);
      playPauseLock = false;
      socket.emit('error', { message: 'Error during pause' });
    }
  });

  socket.on('skip', () => {
    if (roomState.currentTrackIndex < roomState.queue.length - 1) {
      // Temporarily stop syncs
      if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
      }

      roomState.currentTrackIndex++;
      roomState.currentTime = 0;
      roomState.startTime = Date.now();
      roomState.serverStartTimestamp = Date.now();

      // Reset ready state
      roomState.users.forEach(user => user.ready = false);

      console.log('[Skip] Manual skip, transitioning to new track');
      io.emit('queue-update', roomState);

      // If playing, prepare playback for new track
      if (roomState.isPlaying) {
        setTimeout(() => {
          io.emit('prepare-playback', {
            trackIndex: roomState.currentTrackIndex,
            startTime: 0,
            serverTimestamp: Date.now()
          });
        }, 500);
      }
    }
  });

  socket.on('previous', () => {
    if (roomState.currentTrackIndex > 0) {
      // Temporarily stop syncs
      if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
      }

      roomState.currentTrackIndex--;
      roomState.currentTime = 0;
      roomState.startTime = Date.now();
      roomState.serverStartTimestamp = Date.now();

      // Reset ready state
      roomState.users.forEach(user => user.ready = false);

      console.log('[Previous] Manual previous, transitioning to previous track');
      io.emit('queue-update', roomState);

      // If playing, prepare playback for new track
      if (roomState.isPlaying) {
        setTimeout(() => {
          io.emit('prepare-playback', {
            trackIndex: roomState.currentTrackIndex,
            startTime: 0,
            serverTimestamp: Date.now()
          });
        }, 500);
      }
    }
  });

  socket.on('jump-to-track', (index) => {
    if (index >= 0 && index < roomState.queue.length) {
      // Temporarily stop syncs
      if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
      }

      roomState.currentTrackIndex = index;
      roomState.currentTime = 0;
      roomState.startTime = Date.now();
      roomState.serverStartTimestamp = Date.now();

      // Reset ready state
      roomState.users.forEach(user => user.ready = false);

      console.log(`[Jump] Jump to track ${index}, transitioning`);
      io.emit('queue-update', roomState);

      // If playing, prepare playback for new track
      if (roomState.isPlaying) {
        setTimeout(() => {
          io.emit('prepare-playback', {
            trackIndex: roomState.currentTrackIndex,
            startTime: 0,
            serverTimestamp: Date.now()
          });
        }, 500);
      }
    }
  });

  socket.on('seek', (time) => {
    roomState.currentTime = time;
    roomState.startTime = Date.now() - (time * 1000);

    io.emit('player-update', {
      isPlaying: roomState.isPlaying,
      currentTime: roomState.currentTime,
      startTime: roomState.startTime
    });
  });

  socket.on('add-to-queue', async (track) => {
    roomState.queue.push({
      ...track,
      // Keep original ID (YouTube ID)
      addedBy: socket.id,
      addedAt: Date.now()
    });

    // Save to Redis
    if (roomStateManager) {
      await roomStateManager.setState(roomState);
    }

    io.emit('queue-update', roomState);
  });

  socket.on('reorder-queue', (newState) => {
    roomState.queue = newState.queue;
    roomState.currentTrackIndex = newState.currentTrackIndex;
    io.emit('queue-update', roomState);
  });

  socket.on('remove-from-queue', async (index) => {
    if (index < 0 || index >= roomState.queue.length) return;

    // Adjust current track index if necessary
    if (index < roomState.currentTrackIndex) {
      roomState.currentTrackIndex--;
    } else if (index === roomState.currentTrackIndex) {
      // If removing current track, move to next or stop
      if (roomState.queue.length <= 1) {
        // No more tracks, stop playback
        roomState.isPlaying = false;
        roomState.currentTime = 0;
        roomState.currentTrackIndex = 0;
        if (syncInterval) {
          clearInterval(syncInterval);
          syncInterval = null;
        }
      } else if (roomState.currentTrackIndex >= roomState.queue.length - 1) {
        // Last track, go back to beginning
        roomState.currentTrackIndex = 0;
      }
      // Otherwise, index stays the same (automatically moves to next)
    }

    // Remove the track
    roomState.queue.splice(index, 1);

    // Adjust index if we exceeded the end
    if (roomState.currentTrackIndex >= roomState.queue.length && roomState.queue.length > 0) {
      roomState.currentTrackIndex = roomState.queue.length - 1;
    }

    // Save to Redis
    if (roomStateManager) {
      await roomStateManager.setState(roomState);
    }

    io.emit('queue-update', roomState);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] User disconnected: ${socket.id}`);
    roomState.users.delete(socket.id);
    socket.broadcast.emit('user-left', socket.id);
  });
});

// Redis initialization and server startup
async function startServer() {
  try {
    // Redis connection
    const redis = await redisClient.connect();

    // Initialize RoomStateManager with or without Redis
    roomStateManager = new RoomStateManager(redis);

    // Load state from Redis if available
    const savedState = await roomStateManager.getState();
    if (savedState && savedState.queue.length > 0) {
      console.log('[Redis] Room state restored from Redis');
      roomState = savedState;
    }

    // Enable auto-save if Redis is available
    if (redis) {
      roomStateManager.startAutoSave(5000);
    }

    // Start HTTP server
    server.listen(PORT, () => {
      console.log(`[Server] SyncJam server started on port ${PORT}`);
    });

  } catch (error) {
    console.error('[Server] Startup error:', error);
    process.exit(1);
  }
}

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received, graceful shutdown...');

  // Save final state
  if (roomStateManager) {
    await roomStateManager.setState(roomState);
    roomStateManager.stopAutoSave();
  }

  // Close Redis
  await redisClient.disconnect();

  // Close server
  server.close(() => {
    console.log('[Server] Server stopped gracefully');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('[Server] SIGINT received, graceful shutdown...');

  if (roomStateManager) {
    await roomStateManager.setState(roomState);
    roomStateManager.stopAutoSave();
  }

  await redisClient.disconnect();

  server.close(() => {
    console.log('[Server] Server stopped gracefully');
    process.exit(0);
  });
});

// Healthcheck route
app.get('/api/health', async (req, res) => {
  const redisHealth = await redisClient.healthCheck();

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    redis: redisHealth,
    room: {
      queueLength: roomState.queue.length,
      isPlaying: roomState.isPlaying,
      connectedUsers: roomState.users.size
    }
  });
});

// Start the server
startServer();
