const axios = require('axios');

class SpotifyService {
    constructor() {
        this.token = process.env.SPOTIFY_API;
        this.baseURL = 'https://api.spotify.com/v1';

        if (!this.token) {
            console.warn('[Spotify] SPOTIFY_API token not found in environment variables');
        }
    }

    get headers() {
        return {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
        };
    }

    async verifyToken() {
        if (!this.token) return false;

        try {
            const response = await axios.get(`${this.baseURL}/me`, {
                headers: this.headers
            });
            return response.status === 200;
        } catch (error) {
            console.error('[Spotify] Invalid token:', error.message);
            return false;
        }
    }

    async searchTracks(query, limit = 20) {
        if (!this.token) {
            throw new Error('Spotify token missing');
        }

        try {
            const response = await axios.get(`${this.baseURL}/search`, {
                headers: this.headers,
                params: {
                    q: query,
                    type: 'track',
                    limit: limit,
                    market: 'FR'
                }
            });

            const tracks = response.data.tracks.items.map(track => ({
                id: track.id,
                title: track.name,
                artist: track.artists.map(a => a.name).join(', '),
                album: track.album.name,
                duration: Math.floor(track.duration_ms / 1000),
                popularity: track.popularity,
                preview_url: track.preview_url,
                external_urls: track.external_urls,
                source: 'spotify',
                cover_image: track.album.images[0]?.url || null
            }));

            console.log(`[Spotify] ${tracks.length} results for "${query}"`);
            return tracks;

        } catch (error) {
            console.error('[Spotify] Search error:', error.message);
            throw error;
        }
    }

    async getTrackDetails(trackId) {
        if (!this.token) {
            throw new Error('Spotify token missing');
        }

        try {
            const response = await axios.get(`${this.baseURL}/tracks/${trackId}`, {
                headers: this.headers
            });

            const track = response.data;
            return {
                id: track.id,
                title: track.name,
                artist: track.artists.map(a => a.name).join(', '),
                album: track.album.name,
                duration: Math.floor(track.duration_ms / 1000),
                popularity: track.popularity,
                preview_url: track.preview_url,
                external_urls: track.external_urls,
                source: 'spotify',
                cover_image: track.album.images[0]?.url || null,
                release_date: track.album.release_date
            };

        } catch (error) {
            console.error(`[Spotify] Track details error for ${trackId}:`, error.message);
            throw error;
        }
    }

    async getUserPlaylists(limit = 50) {
        if (!this.token) {
            throw new Error('Spotify token missing');
        }

        try {
            const response = await axios.get(`${this.baseURL}/me/playlists`, {
                headers: this.headers,
                params: { limit }
            });

            return response.data.items.map(playlist => ({
                id: playlist.id,
                name: playlist.name,
                description: playlist.description,
                tracks_count: playlist.tracks.total,
                public: playlist.public,
                owner: playlist.owner.display_name,
                image: playlist.images[0]?.url || null
            }));

        } catch (error) {
            console.error('[Spotify] Playlists retrieval error:', error.message);
            throw error;
        }
    }

    async getPlaylistTracks(playlistId) {
        if (!this.token) {
            throw new Error('Spotify token missing');
        }

        try {
            let tracks = [];
            let url = `${this.baseURL}/playlists/${playlistId}/tracks`;

            while (url) {
                const response = await axios.get(url, {
                    headers: this.headers,
                    params: {
                        fields: 'items(track(id,name,artists,album,duration_ms,popularity,preview_url,external_urls)),next'
                    }
                });

                const batchTracks = response.data.items
                    .filter(item => item.track && item.track.type === 'track')
                    .map(item => {
                        const track = item.track;
                        return {
                            id: track.id,
                            title: track.name,
                            artist: track.artists.map(a => a.name).join(', '),
                            album: track.album.name,
                            duration: Math.floor(track.duration_ms / 1000),
                            popularity: track.popularity,
                            preview_url: track.preview_url,
                            external_urls: track.external_urls,
                            source: 'spotify',
                            cover_image: track.album.images?.[0]?.url || null
                        };
                    });

                tracks = tracks.concat(batchTracks);
                url = response.data.next;
            }

            console.log(`[Spotify] ${tracks.length} tracks retrieved from playlist`);
            return tracks;

        } catch (error) {
            console.error(`[Spotify] Playlist tracks error for ${playlistId}:`, error.message);
            throw error;
        }
    }
}

module.exports = SpotifyService;
