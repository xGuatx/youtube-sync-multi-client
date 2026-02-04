const { spotifyAuth } = require('../routes/auth');

class SpotifyPlayerService {
    constructor() {
        this.deviceId = null;
        this.isPlaying = false;
        this.currentTrack = null;
        this.position = 0;
        this.volume = 0.7;
    }

    async makeSpotifyRequest(endpoint, method = 'GET', body = null) {
        try {
            const token = await spotifyAuth.getValidToken();
            const options = {
                method,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            };

            if (body) {
                options.body = JSON.stringify(body);
            }

            const response = await fetch(`https://api.spotify.com/v1${endpoint}`, options);

            if (!response.ok) {
                throw new Error(`Spotify API error: ${response.status} ${response.statusText}`);
            }

            return response.json();
        } catch (error) {
            console.error('[SpotifyPlayer] Request error:', error);
            throw error;
        }
    }

    async getDevices() {
        try {
            const data = await this.makeSpotifyRequest('/me/player/devices');
            return data.devices || [];
        } catch (error) {
            console.error('[SpotifyPlayer] Get devices error:', error);
            return [];
        }
    }

    async transferPlayback(deviceId) {
        try {
            await this.makeSpotifyRequest('/me/player', 'PUT', {
                device_ids: [deviceId],
                play: false
            });
            this.deviceId = deviceId;
            console.log('[SpotifyPlayer] Playback transferred to device:', deviceId);
            return true;
        } catch (error) {
            console.error('[SpotifyPlayer] Transfer playback error:', error);
            return false;
        }
    }

    async play(trackUri = null, position = 0) {
        try {
            const body = {};

            if (trackUri) {
                body.uris = [trackUri];
            }

            if (position > 0) {
                body.position_ms = Math.floor(position * 1000);
            }

            await this.makeSpotifyRequest('/me/player/play', 'PUT', Object.keys(body).length > 0 ? body : null);
            this.isPlaying = true;
            console.log('[SpotifyPlayer] Playback started');
            return true;
        } catch (error) {
            console.error('[SpotifyPlayer] Play error:', error);
            return false;
        }
    }

    async pause() {
        try {
            await this.makeSpotifyRequest('/me/player/pause', 'PUT');
            this.isPlaying = false;
            console.log('[SpotifyPlayer] Playback paused');
            return true;
        } catch (error) {
            console.error('[SpotifyPlayer] Pause error:', error);
            return false;
        }
    }

    async skip() {
        try {
            await this.makeSpotifyRequest('/me/player/next', 'POST');
            console.log('[SpotifyPlayer] Next track');
            return true;
        } catch (error) {
            console.error('[SpotifyPlayer] Skip error:', error);
            return false;
        }
    }

    async previous() {
        try {
            await this.makeSpotifyRequest('/me/player/previous', 'POST');
            console.log('[SpotifyPlayer] Previous track');
            return true;
        } catch (error) {
            console.error('[SpotifyPlayer] Previous error:', error);
            return false;
        }
    }

    async seek(position) {
        try {
            const positionMs = Math.floor(position * 1000);
            await this.makeSpotifyRequest(`/me/player/seek?position_ms=${positionMs}`, 'PUT');
            this.position = position;
            console.log('[SpotifyPlayer] Position changed:', position);
            return true;
        } catch (error) {
            console.error('[SpotifyPlayer] Seek error:', error);
            return false;
        }
    }

    async setVolume(volume) {
        try {
            const volumePercent = Math.floor(volume * 100);
            await this.makeSpotifyRequest(`/me/player/volume?volume_percent=${volumePercent}`, 'PUT');
            this.volume = volume;
            console.log('[SpotifyPlayer] Volume changed:', volumePercent + '%');
            return true;
        } catch (error) {
            console.error('[SpotifyPlayer] Volume error:', error);
            return false;
        }
    }

    async getCurrentState() {
        try {
            const data = await this.makeSpotifyRequest('/me/player');

            if (data && data.device) {
                this.deviceId = data.device.id;
                this.isPlaying = data.is_playing;
                this.position = (data.progress_ms || 0) / 1000;
                this.volume = (data.device.volume_percent || 70) / 100;

                if (data.item) {
                    this.currentTrack = {
                        id: data.item.id,
                        title: data.item.name,
                        artist: data.item.artists.map(a => a.name).join(', '),
                        album: data.item.album.name,
                        duration: Math.floor(data.item.duration_ms / 1000),
                        uri: data.item.uri,
                        cover_image: data.item.album.images[0]?.url
                    };
                }

                return {
                    isPlaying: this.isPlaying,
                    currentTrack: this.currentTrack,
                    position: this.position,
                    volume: this.volume,
                    device: data.device
                };
            }

            return null;
        } catch (error) {
            console.error('[SpotifyPlayer] Get current state error:', error);
            return null;
        }
    }

    async addToQueue(trackUri) {
        try {
            await this.makeSpotifyRequest(`/me/player/queue?uri=${encodeURIComponent(trackUri)}`, 'POST');
            console.log('[SpotifyPlayer] Added to queue:', trackUri);
            return true;
        } catch (error) {
            console.error('[SpotifyPlayer] Add to queue error:', error);
            return false;
        }
    }

    convertTrackToSpotifyFormat(track) {
        return {
            id: track.id,
            title: track.title || track.name,
            artist: track.artist,
            album: track.album,
            duration: track.duration,
            uri: `spotify:track:${track.id}`,
            cover_image: track.cover_image,
            source: 'spotify'
        };
    }

    isAuthenticated() {
        return spotifyAuth.isAuthenticated();
    }
}

module.exports = SpotifyPlayerService;
