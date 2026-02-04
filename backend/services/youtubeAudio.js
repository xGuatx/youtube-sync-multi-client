const axios = require('axios');

class YouTubeAudioService {
    constructor() {
        this.pythonServiceUrl = process.env.PYTHON_AUDIO_SERVICE_URL || 'http://python-audio:5000';
        this.cache = new Map();
        this.cacheExpire = 5 * 60 * 1000; // 5 minutes - YouTube URLs expire quickly

        console.log(`[YouTubeAudio] Service initialized (Python: ${this.pythonServiceUrl})`);
    }

    async getDirectAudioUrl(videoId) {
        try {
            console.log(`[YouTubeAudio] Getting direct audio URL for: ${videoId}`);

            // Check cache with expiration (URLs only, not files)
            const cached = this.cache.get(videoId);
            if (cached && (Date.now() - cached.timestamp) < this.cacheExpire) {
                console.log(`[YouTubeAudio] URL found in cache: ${videoId}`);
                return cached.data;
            }

            // Call Python service for extraction
            const response = await axios.get(`${this.pythonServiceUrl}/extract/${videoId}`, {
                timeout: 45000 // 45 seconds timeout (yt-dlp can be slow)
            });

            const result = response.data;

            if (!result.success) {
                throw new Error(result.error || 'Extraction failed');
            }

            const audioInfo = {
                url: result.audio_url,
                title: result.title,
                duration: result.duration,
                format: result.format,
                contentType: result.content_type,
                bitrate: result.bitrate
            };

            // Cache the URL (not the audio file!)
            this.cache.set(videoId, {
                data: audioInfo,
                timestamp: Date.now()
            });

            console.log(`[YouTubeAudio] Direct audio URL obtained: ${audioInfo.title} (${audioInfo.format}, ${audioInfo.bitrate}kbps)`);
            return audioInfo;

        } catch (error) {
            console.error(`[YouTubeAudio] getDirectAudioUrl error: ${error.message}`);
            throw error;
        }
    }

    async getAudioUrl(videoId) {
        try {
            const audioInfo = await this.getDirectAudioUrl(videoId);
            return audioInfo;
        } catch (error) {
            console.error(`[YouTubeAudio] getAudioUrl error: ${error.message}`);
            // No fallback, throw error for appropriate handling
            throw new Error(`Unable to extract audio for ${videoId}: ${error.message}`);
        }
    }

    async healthCheck() {
        try {
            const response = await axios.get(`${this.pythonServiceUrl}/health`, {
                timeout: 5000
            });
            return response.data;
        } catch (error) {
            console.error(`[YouTubeAudio] Python service unavailable: ${error.message}`);
            return { status: 'unhealthy', error: error.message };
        }
    }

    clearCache() {
        this.cache.clear();
        console.log('[YouTubeAudio] Audio cache cleared');
    }

    getCacheSize() {
        return this.cache.size;
    }
}

module.exports = YouTubeAudioService;
