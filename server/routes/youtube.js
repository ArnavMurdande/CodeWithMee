const express = require('express');
const router = express.Router();
const axios = require('axios');
const YouTubeCache = require('../models/YouTubeCache'); // Import the new cache model
const { createLegacyLogger } = require('../utils/legacyLogger');

const legacyLogger = createLegacyLogger('youtube');

// --- API Key Rotation Setup ---
const { getYoutubeKeys } = require('../utils/keyManager');

let currentKeyIndex = 0;

const getApiKey = (apiKeys) => {
    if (apiKeys.length === 0) return null;
    const key = apiKeys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    return key;
};

// --- Main Search Route ---
router.get('/search', async (req, res) => {
    const { q } = req.query;

    if (!q) {
        return res.status(400).json({ error: 'Search query is required.' });
    }

    try {
        // --- Caching Logic (Option 2) ---
        const cachedResult = await YouTubeCache.findOne({ query: q });

        if (cachedResult) {
            legacyLogger.info('cache_hit');
            return res.json({ videoId: cachedResult.videoId });
        }

        legacyLogger.info('cache_miss');
        
        // --- API Key Rotation Logic (Option 1) ---
        const apiKeys = getYoutubeKeys();
        if (apiKeys.length === 0) {
            return res.status(500).json({ error: 'Server is not configured with YouTube API keys.' });
        }

        const url = `https://www.googleapis.com/youtube/v3/search`;
        let attempts = 0;
        let success = false;

        while (attempts < apiKeys.length && !success) {
            const apiKey = getApiKey(apiKeys);
            legacyLogger.info('provider_attempt', { attempt: attempts + 1, total: apiKeys.length });

            try {
                const response = await axios.get(url, {
                    params: { part: 'snippet', q, type: 'video', maxResults: 1, key: apiKey },
                });

                if (response.data.items && response.data.items.length > 0) {
                    const videoId = response.data.items[0].id.videoId;
                    legacyLogger.info('provider_result_found');

                    // Save the new result to the cache
                    const newCacheEntry = new YouTubeCache({ query: q, videoId: videoId });
                    await newCacheEntry.save();
                    legacyLogger.info('cache_saved');
                    
                    success = true;
                    return res.json({ videoId });
                } else {
                    // Start 404 block
                     // If no video found, it's not a quota error, so we shouldn't necessarily retry with another key unless we suspect the key is "blind" (unlikely).
                     // But strictly speaking, 404 or empty items is a valid response.
                     success = true; 
                     return res.status(404).json({ error: 'No video found.' });
                     // End 404 block
                }

            } catch (error) {
                const status = error.response?.status;
                const reason = error.response?.data?.error?.errors?.[0]?.reason;
                
                const isQuotaError = status === 403 || status === 429 || reason === 'quotaExceeded';

                legacyLogger.error('provider_request_failed', error);

                if (isQuotaError) {
                    attempts++;
                    legacyLogger.warn('provider_quota_exceeded', { code: status });
                    // The loop will continue and getApiKey() will provide the next one.
                } else {
                    // Non-quota error, abort
                    return res.status(500).json({ error: 'Failed to fetch video from YouTube API.' });
                }
            }
        }
        
        if (!success) {
             legacyLogger.error('provider_keys_exhausted', { code: 'quota_exhausted' });
             return res.status(429).json({ error: 'All available API keys have exceeded their daily quota.' });
        }

    } catch (dbError) {
        legacyLogger.error('cache_database_failed', dbError);
        res.status(500).json({ error: 'A database error occurred.' });
    }
});

module.exports = router;
