const express = require('express');
const YouTubeService = require('../services/youtube');

const router = express.Router();
const youtubeService = new YouTubeService();

router.get('/', async (req, res) => {
    const { q: query, limit = 20, source = 'all' } = req.query;

    if (!query || query.trim() === '') {
        return res.status(400).json({
            error: 'Search parameter "q" required'
        });
    }

    try {
        let results = [];

        // Use YouTube exclusively as main source
        try {
            const youtubeResults = await youtubeService.searchTracks(query, limit);
            results = youtubeResults;
        } catch (error) {
            console.error('[Search] YouTube search error:', error.message);
            throw new Error('YouTube API not configured or service error');
        }

        res.json({
            query,
            total: results.length,
            results
        });

    } catch (error) {
        console.error('[Search] Global search error:', error.message);
        res.status(500).json({
            error: 'Search error',
            message: error.message
        });
    }
});


router.get('/youtube', async (req, res) => {
    const { q: query, limit = 20 } = req.query;

    if (!query || query.trim() === '') {
        return res.status(400).json({
            error: 'Search parameter "q" required'
        });
    }

    try {
        const results = await youtubeService.searchTracks(query, limit);
        res.json({
            query,
            source: 'youtube',
            total: results.length,
            results
        });
    } catch (error) {
        console.error('[Search] YouTube search error:', error.message);
        res.status(500).json({
            error: 'YouTube search error',
            message: error.message
        });
    }
});

router.get('/youtube/popular', async (req, res) => {
    const { limit = 20 } = req.query;

    try {
        const results = await youtubeService.getPopularMusic(limit);
        res.json({
            source: 'youtube',
            total: results.length,
            results
        });
    } catch (error) {
        console.error('[Search] YouTube popular tracks error:', error.message);
        res.status(500).json({
            error: 'Error fetching popular tracks',
            message: error.message
        });
    }
});

module.exports = router;
