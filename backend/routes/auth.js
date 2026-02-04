const express = require('express');
const router = express.Router();

class SpotifyAuth {
    constructor() {
        this.clientId = process.env.SPOTIFY_CLIENT_ID;
        this.clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
        this.redirectUri = process.env.SPOTIFY_REDIRECT_URI || 'https://prosec.xguat.com/auth/spotify/callback';
        this.scopes = [
            'streaming',
            'user-read-email',
            'user-read-private',
            'user-read-playback-state',
            'user-modify-playback-state',
            'user-read-currently-playing',
            'playlist-read-private',
            'playlist-read-collaborative'
        ].join(' ');
        
        this.accessToken = null;
        this.refreshToken = null;
        this.tokenExpiry = null;
    }

    getAuthUrl() {
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: this.clientId,
            scope: this.scopes,
            redirect_uri: this.redirectUri,
            state: this.generateRandomString(16)
        });

        return `https://accounts.spotify.com/authorize?${params.toString()}`;
    }

    async exchangeCodeForTokens(code) {
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: this.redirectUri
            })
        });

        const data = await response.json();
        
        if (data.access_token) {
            this.accessToken = data.access_token;
            this.refreshToken = data.refresh_token;
            this.tokenExpiry = Date.now() + (data.expires_in * 1000);
            return data;
        } else {
            throw new Error('Failed to exchange code for tokens');
        }
    }

    async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new Error('No refresh token available');
        }

        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: this.refreshToken
            })
        });

        const data = await response.json();
        
        if (data.access_token) {
            this.accessToken = data.access_token;
            this.tokenExpiry = Date.now() + (data.expires_in * 1000);
            if (data.refresh_token) {
                this.refreshToken = data.refresh_token;
            }
            return data;
        } else {
            throw new Error('Failed to refresh access token');
        }
    }

    async getValidToken() {
        if (!this.accessToken) {
            throw new Error('No access token available. Please authenticate first.');
        }

        // Refresh token if it expires in the next 5 minutes
        if (this.tokenExpiry && (this.tokenExpiry - Date.now()) < 300000) {
            console.log('Token expires soon, refreshing...');
            await this.refreshAccessToken();
        }

        return this.accessToken;
    }

    generateRandomString(length) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    isAuthenticated() {
        return this.accessToken && this.tokenExpiry && this.tokenExpiry > Date.now();
    }
}

const spotifyAuth = new SpotifyAuth();

// Route to initiate authentication
router.get('/login', (req, res) => {
    const authUrl = spotifyAuth.getAuthUrl();
    res.redirect(authUrl);
});

// Authentication callback route
router.get('/callback', async (req, res) => {
    const { code, error } = req.query;

    if (error) {
        return res.status(400).json({ error: 'Authentication failed', details: error });
    }

    if (!code) {
        return res.status(400).json({ error: 'No authorization code provided' });
    }

    try {
        const tokens = await spotifyAuth.exchangeCodeForTokens(code);
        console.log(' Spotify authentication successful');
        
        // Redirect to application on success
        res.redirect('/?auth=success');
    } catch (error) {
        console.error(' Authentication error:', error);
        res.status(500).json({ error: 'Failed to authenticate', details: error.message });
    }
});

// Route to check authentication status
router.get('/status', (req, res) => {
    res.json({
        authenticated: spotifyAuth.isAuthenticated(),
        hasRefreshToken: !!spotifyAuth.refreshToken
    });
});

// Route to manually refresh the token
router.post('/refresh', async (req, res) => {
    try {
        const tokens = await spotifyAuth.refreshAccessToken();
        res.json({ success: true, expires_in: tokens.expires_in });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = { router, spotifyAuth };