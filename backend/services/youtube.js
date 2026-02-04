const axios = require('axios');

class YouTubeService {
    constructor() {
        this.apiKey = process.env.YOUTUBE_API_KEY;
        this.baseURL = 'https://www.googleapis.com/youtube/v3';

        if (!this.apiKey) {
            console.warn('[YouTube] YOUTUBE_API_KEY not found in environment variables');
        }
    }

    getProxyHeaders() {
        return {
            'Referer': 'https://prosec.xguat.com/',
            'Origin': 'https://prosec.xguat.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
        };
    }

    async searchTracks(query, limit = 20) {
        if (!this.apiKey) {
            throw new Error('YouTube API key missing');
        }

        try {
            const response = await axios.get(`${this.baseURL}/search`, {
                params: {
                    part: 'snippet',
                    q: `${query} song music audio`,
                    type: 'video',
                    maxResults: limit,
                    key: this.apiKey,
                    order: 'relevance'
                },
                headers: this.getProxyHeaders()
            });

            const videoIds = response.data.items.map(item => item.id.videoId).join(',');

            // Get video details (duration, status to check embeddability)
            const detailsResponse = await axios.get(`${this.baseURL}/videos`, {
                params: {
                    part: 'contentDetails,statistics,status',
                    id: videoIds,
                    key: this.apiKey
                },
                headers: this.getProxyHeaders()
            });

            const tracks = response.data.items
                .map((item, index) => {
                    const details = detailsResponse.data.items[index];
                    if (!details) return null;

                    const duration = this.parseDuration(details?.contentDetails?.duration || 'PT0S');

                    // Check if video is embeddable
                    const isEmbeddable = details.status?.embeddable !== false;
                    if (!isEmbeddable) {
                        console.log(`[YouTube] Non-embeddable video ignored: ${item.snippet.title}`);
                        return null;
                    }

                    // Extract artist and title from video title
                    const { artist, title } = this.parseTitle(item.snippet.title);

                    return {
                        id: item.id.videoId,
                        title: title,
                        artist: artist,
                        album: 'YouTube Music',
                        duration: duration,
                        source: 'youtube',
                        youtube_url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
                        cover_image: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
                        channel: item.snippet.channelTitle,
                        published: item.snippet.publishedAt,
                        views: details?.statistics?.viewCount || 0,
                        embeddable: isEmbeddable
                    };
                })
                .filter(track => track !== null); // Remove non-embeddable videos

            console.log(`[YouTube] ${tracks.length} results for "${query}"`);
            return tracks;

        } catch (error) {
            console.error('[YouTube] Search error:', error.message);
            throw error;
        }
    }

    async getVideoDetails(videoId) {
        if (!this.apiKey) {
            throw new Error('YouTube API key missing');
        }

        try {
            const response = await axios.get(`${this.baseURL}/videos`, {
                params: {
                    part: 'snippet,contentDetails,statistics',
                    id: videoId,
                    key: this.apiKey
                },
                headers: this.getProxyHeaders()
            });

            const video = response.data.items[0];
            if (!video) {
                throw new Error('Video not found');
            }

            const duration = this.parseDuration(video.contentDetails.duration);
            const { artist, title } = this.parseTitle(video.snippet.title);

            return {
                id: video.id,
                title: title,
                artist: artist,
                album: 'YouTube Music',
                duration: duration,
                source: 'youtube',
                youtube_url: `https://www.youtube.com/watch?v=${video.id}`,
                cover_image: video.snippet.thumbnails.medium?.url,
                channel: video.snippet.channelTitle,
                description: video.snippet.description,
                published: video.snippet.publishedAt,
                views: video.statistics.viewCount,
                likes: video.statistics.likeCount
            };

        } catch (error) {
            console.error(`[YouTube] Video details error for ${videoId}:`, error.message);
            throw error;
        }
    }

    async searchByArtist(artistName, limit = 20) {
        return this.searchTracks(`${artistName} official music`, limit);
    }

    async getPopularMusic(limit = 20) {
        try {
            const response = await axios.get(`${this.baseURL}/videos`, {
                params: {
                    part: 'snippet,contentDetails,statistics',
                    chart: 'mostPopular',
                    maxResults: limit,
                    key: this.apiKey
                },
                headers: this.getProxyHeaders()
            });

            const tracks = response.data.items.map(video => {
                const duration = this.parseDuration(video.contentDetails.duration);
                const { artist, title } = this.parseTitle(video.snippet.title);

                return {
                    id: video.id,
                    title: title,
                    artist: artist,
                    album: 'YouTube Music',
                    duration: duration,
                    source: 'youtube',
                    youtube_url: `https://www.youtube.com/watch?v=${video.id}`,
                    cover_image: video.snippet.thumbnails.medium?.url,
                    channel: video.snippet.channelTitle,
                    views: video.statistics.viewCount,
                    likes: video.statistics.likeCount
                };
            });

            console.log(`[YouTube] ${tracks.length} popular tracks retrieved`);
            return tracks;

        } catch (error) {
            console.error('[YouTube] Popular tracks retrieval error:', error.message);
            throw error;
        }
    }

    parseDuration(duration) {
        // Convert PT4M13S to seconds
        const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (!match) return 0;

        const hours = parseInt(match[1] || 0);
        const minutes = parseInt(match[2] || 0);
        const seconds = parseInt(match[3] || 0);

        return hours * 3600 + minutes * 60 + seconds;
    }

    parseTitle(fullTitle) {
        // Try to extract artist and title from YouTube title
        // Common formats: "Artist - Title", "Artist: Title", "Title by Artist"

        const patterns = [
            /^(.+?)\s*[-]\s*(.+)$/,  // "Artist - Title"
            /^(.+?)\s*:\s*(.+)$/,      // "Artist: Title"
            /^(.+?)\s+by\s+(.+)$/i,    // "Title by Artist"
            /^(.+?)\s*\|\s*(.+)$/,     // "Artist | Title"
        ];

        for (const pattern of patterns) {
            const match = fullTitle.match(pattern);
            if (match) {
                return {
                    artist: match[1].trim(),
                    title: match[2].trim()
                };
            }
        }

        // If no pattern matches, use full title
        return {
            artist: 'Unknown Artist',
            title: fullTitle.trim()
        };
    }

    getEmbedUrl(videoId) {
        return `https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=1&controls=0&modestbranding=1&rel=0`;
    }

    isValidVideoId(videoId) {
        return /^[a-zA-Z0-9_-]{11}$/.test(videoId);
    }
}

module.exports = YouTubeService;
