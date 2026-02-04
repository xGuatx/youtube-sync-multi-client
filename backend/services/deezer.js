const axios = require('axios');

class DeezerService {
    constructor() {
        this.baseURL = 'https://api.deezer.com';
    }

    async searchTracks(query, limit = 20) {
        try {
            const response = await axios.get(`${this.baseURL}/search`, {
                params: {
                    q: query,
                    limit: limit
                }
            });

            const tracks = response.data.data.map(track => ({
                id: track.id.toString(),
                title: track.title,
                artist: track.artist.name,
                album: track.album.title,
                duration: track.duration,
                preview_url: track.preview,
                source: 'deezer',
                cover_image: track.album.cover_medium || track.album.cover_small,
                external_urls: {
                    deezer: track.link
                }
            }));

            console.log(`[Deezer] ${tracks.length} results for "${query}"`);
            return tracks;

        } catch (error) {
            console.error('[Deezer] Search error:', error.message);
            throw error;
        }
    }

    async getTrackDetails(trackId) {
        try {
            const response = await axios.get(`${this.baseURL}/track/${trackId}`);
            const track = response.data;

            return {
                id: track.id.toString(),
                title: track.title,
                artist: track.artist.name,
                album: track.album.title,
                duration: track.duration,
                preview_url: track.preview,
                source: 'deezer',
                cover_image: track.album.cover_medium || track.album.cover_small,
                external_urls: {
                    deezer: track.link
                },
                release_date: track.release_date,
                bpm: track.bpm,
                rank: track.rank
            };

        } catch (error) {
            console.error(`[Deezer] Track details error for ${trackId}:`, error.message);
            throw error;
        }
    }

    async getArtistTopTracks(artistId, limit = 20) {
        try {
            const response = await axios.get(`${this.baseURL}/artist/${artistId}/top`, {
                params: { limit }
            });

            return response.data.data.map(track => ({
                id: track.id.toString(),
                title: track.title,
                artist: track.artist.name,
                album: track.album.title,
                duration: track.duration,
                preview_url: track.preview,
                source: 'deezer',
                cover_image: track.album.cover_medium,
                external_urls: {
                    deezer: track.link
                }
            }));

        } catch (error) {
            console.error(`[Deezer] Artist top tracks error for ${artistId}:`, error.message);
            throw error;
        }
    }

    async searchArtists(query, limit = 10) {
        try {
            const response = await axios.get(`${this.baseURL}/search/artist`, {
                params: {
                    q: query,
                    limit: limit
                }
            });

            return response.data.data.map(artist => ({
                id: artist.id.toString(),
                name: artist.name,
                picture: artist.picture_medium,
                fans: artist.nb_fan,
                external_urls: {
                    deezer: artist.link
                }
            }));

        } catch (error) {
            console.error('[Deezer] Artist search error:', error.message);
            throw error;
        }
    }

    async searchAlbums(query, limit = 20) {
        try {
            const response = await axios.get(`${this.baseURL}/search/album`, {
                params: {
                    q: query,
                    limit: limit
                }
            });

            return response.data.data.map(album => ({
                id: album.id.toString(),
                title: album.title,
                artist: album.artist.name,
                cover: album.cover_medium,
                release_date: album.release_date,
                tracks_count: album.nb_tracks,
                external_urls: {
                    deezer: album.link
                }
            }));

        } catch (error) {
            console.error('[Deezer] Album search error:', error.message);
            throw error;
        }
    }

    async getAlbumTracks(albumId) {
        try {
            const response = await axios.get(`${this.baseURL}/album/${albumId}/tracks`);

            return response.data.data.map(track => ({
                id: track.id.toString(),
                title: track.title,
                artist: track.artist.name,
                duration: track.duration,
                preview_url: track.preview,
                source: 'deezer',
                external_urls: {
                    deezer: track.link
                },
                track_position: track.track_position
            }));

        } catch (error) {
            console.error(`[Deezer] Album tracks error for ${albumId}:`, error.message);
            throw error;
        }
    }

    async getChart(limit = 20) {
        try {
            const response = await axios.get(`${this.baseURL}/chart/0/tracks`, {
                params: { limit }
            });

            return response.data.data.map(track => ({
                id: track.id.toString(),
                title: track.title,
                artist: track.artist.name,
                album: track.album.title,
                duration: track.duration,
                preview_url: track.preview,
                source: 'deezer',
                cover_image: track.album.cover_medium,
                external_urls: {
                    deezer: track.link
                },
                position: track.position
            }));

        } catch (error) {
            console.error('[Deezer] Chart error:', error.message);
            throw error;
        }
    }
}

module.exports = DeezerService;
