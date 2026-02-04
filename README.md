# SyncJam

Synchronized music website between multiple clients with YouTube streaming.

## Features

- **Precise synchronization**: 50-200ms synchronization between all clients
  - Coordinated pre-buffering for simultaneous start
  - Automatic network latency measurement and compensation
  - Automatic time drift correction
  - High frequency sync (100ms) for maximum precision
- **Interactive queue**: Drag & drop to reorganize tracks
- **YouTube music search**: YouTube search and streaming without API limits
- **Playback controls**: Play, pause, skip, time navigation
- **Responsive interface**: Desktop and mobile support
- **Optimized audio formats**: Detection and priority for browser-compatible formats

## Installation

### Prerequisites

- Node.js 16+ installed
- Spotify API token (optional)

### Configuration

1. Clone and install dependencies:
```bash
cd SyncJam
npm install
```

2. Copy and configure environment variables:
```bash
cp .env.example .env
```

3. Edit the `.env` file with your API tokens:
```
# Spotify Configuration (optional for metadata)
SPOTIFY_API=your_spotify_bearer_token
SPOTIFY_USERNAME=your_username
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_EMAIL=your_email@example.com
SPOTIFY_REDIRECT_URI=http://localhost:8080/auth/spotify/callback

# YouTube API (for search and streaming)
YOUTUBE_API_KEY=your_youtube_api_key

# Server
PORT=8080
```

## Running

### Development mode
```bash
npm run dev
```

### Production mode
```bash
npm start
```

The application will be available at `http://localhost:3000`

## Architecture

```
SyncJam/
 backend/                 # Node.js + Socket.io server
    server.js           # Main entry point
    routes/             # REST API routes
       search.js       # Music search API
    services/           # External services
        spotify.js      # Spotify Web API integration
        deezer.js       # Deezer API integration
 frontend/               # User interface
    index.html          # Main page
    css/style.css       # CSS styles
    js/app.js           # Client JavaScript logic
 package.json            # Node.js dependencies
```

## APIs Used

- **Spotify Web API**: Track search and metadata
- **Deezer API**: Alternative search and metadata (public, no auth required)

## Technologies

- **Backend**: Node.js, Express.js, Socket.io
- **Frontend**: HTML5, CSS3, JavaScript ES6+
- **Synchronization**: WebSockets for real-time communication
- **APIs**: Spotify Web API, Deezer public API

## Usage

1. Open the application in multiple tabs/browsers
2. Search for tracks in the search bar
3. Click on a track to add it to the queue
4. Use playback controls (play/pause/skip)
5. Reorganize the queue by drag and drop
6. Click on a track in the queue to play it immediately

All clients will see the same changes in real time!

## Spotify Configuration

To get a Spotify token:

1. Go to [Spotify Developer Console](https://developer.spotify.com/console/)
2. Log in with your Spotify account
3. Use the "Get Token" tool to generate a Bearer Token
4. Copy the token into the `.env` file

**Note**: Spotify tokens expire after 1 hour. For production use, implement the OAuth2 flow.

## Advanced Documentation

- [SYNCHRONIZATION.md](./SYNCHRONIZATION.md) - Detailed synchronization system documentation
- [TEST_SYNC.md](./TEST_SYNC.md) - Synchronization testing guide between clients

## Synchronization Performance

| Metric | Value |
|--------|-------|
| Initial offset | 50-150ms |
| Continuous synchronization | 100ms (10x per second) |
| Drift correction | Automatic if > 200ms |
| Play/pause latency | 100-250ms |

### Optimizations for Maximum Synchronization

1. **Local network (LAN)**: 1-10ms latency > Near perfect
2. **Home WiFi**: 10-50ms latency > Excellent
3. **4G/5G Internet**: 30-100ms latency > Very good
4. **Pre-buffering**: 3 seconds minimum before start

## Troubleshooting

### No Sound

**Problem**: Audio does not play or incompatible format

**Solutions**:
1. Check that the Python service is started (`python-audio-service/app.py`)
2. Check console logs: "Supported audio formats"
3. Test with another browser (Chrome/Firefox recommended)
4. Check that yt-dlp is installed: `yt-dlp --version`

### Desynchronization Between Clients

**Problem**: Clients have > 500ms offset

**Solutions**:
1. Check network latency in console logs
2. Increase buffering time if connection is slow
3. Check that both clients are using the same server
4. Refresh the page to re-measure latency

### Python Service Unavailable

**Problem**: Error "Python service unavailable"

**Solutions**:
1. Start the service: `cd python-audio-service && python3 app.py`
2. Check port 5000: `curl http://localhost:5000/health`
3. Install dependencies: `pip install -r requirements.txt`
4. With Docker: `docker-compose up python-audio`

---

## Known Issues

The following issues are currently known and being fixed:

### 1. Pause/Resume Instability
**Symptom**: Synchronization may break during pause/resume
**Impact**: Temporary desynchronization between clients
**Workaround**: Reload the page or use skip to resynchronize

### 2. Track Change Issues
**Symptom**: Music change may cause synchronization errors
**Impact**: Some clients may not change track correctly
**Workaround**: Refresh the page if there is a problem

### 3. Request Spam
**Symptom**: Network request spam under certain conditions
**Impact**: Increased server load and bandwidth
**Status**: Investigation in progress to identify exact cause

### 4. Spotify Token Expiration
**Symptom**: Spotify tokens expire after 1 hour
**Impact**: Loss of Spotify metadata functionality
**Solution**: Implement OAuth2 refresh flow (TODO)

---

## Contributing & Development Status

This project is under active development. Contributions to resolve the issues above are welcome.

**Current priorities:**
1. Fix pause/resume synchronization
2. Fix track change handling
3. Optimize network requests (prevent spam)
4. Implement OAuth2 refresh token flow
