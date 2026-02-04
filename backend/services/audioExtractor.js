const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class AudioExtractor {
    constructor() {
        this.tempDir = path.join(__dirname, '../temp');
        this.ensureTempDir();
    }

    ensureTempDir() {
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    async extractAudioUrl(videoId) {
        return new Promise((resolve, reject) => {
            // Use yt-dlp to extract audio URL without downloading
            const ytdlp = spawn('yt-dlp', [
                '--get-url',
                '--format', 'bestaudio[ext=m4a]/bestaudio',
                '--no-playlist',
                `https://www.youtube.com/watch?v=${videoId}`
            ]);

            let audioUrl = '';
            let errorOutput = '';

            ytdlp.stdout.on('data', (data) => {
                audioUrl += data.toString();
            });

            ytdlp.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            ytdlp.on('close', (code) => {
                if (code === 0 && audioUrl.trim()) {
                    const url = audioUrl.trim().split('\n')[0];
                    console.log('[AudioExtractor] Audio URL extracted for:', videoId);
                    resolve(url);
                } else {
                    console.error('[AudioExtractor] Audio extraction error:', errorOutput);
                    reject(new Error(`Audio extraction failed: ${errorOutput}`));
                }
            });

            ytdlp.on('error', (error) => {
                console.error('[AudioExtractor] yt-dlp error:', error);
                reject(error);
            });
        });
    }

    async getAudioStream(videoId) {
        try {
            const audioUrl = await this.extractAudioUrl(videoId);
            return {
                audioUrl: audioUrl,
                videoId: videoId,
                success: true
            };
        } catch (error) {
            console.error(`[AudioExtractor] Audio stream error for ${videoId}:`, error);
            return {
                error: error.message,
                videoId: videoId,
                success: false
            };
        }
    }

    // Method using actual python-audio service
    async getAudioProxy(videoId) {
        const axios = require('axios');

        try {
            const pythonServiceUrl = process.env.PYTHON_AUDIO_SERVICE_URL || 'http://python-audio:5000';
            const response = await axios.get(`${pythonServiceUrl}/extract/${videoId}`);

            if (response.data && response.data.success) {
                return {
                    audioUrl: response.data.url,
                    videoId: videoId,
                    success: true,
                    type: 'python-service',
                    title: response.data.title,
                    duration: response.data.duration
                };
            } else {
                throw new Error('Audio extraction service failed');
            }
        } catch (error) {
            console.error(`[AudioExtractor] Audio service error for ${videoId}:`, error.message);
            return {
                error: error.message,
                videoId: videoId,
                success: false
            };
        }
    }
}

module.exports = AudioExtractor;
