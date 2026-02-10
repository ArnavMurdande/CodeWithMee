const express = require('express');
const router = express.Router();
const axios = require('axios');
const YouTubeCache = require('../models/YouTubeCache'); // Import the new cache model

// --- API Key Rotation Setup ---
const { getYoutubeKeys } = require('../utils/keyManager');

// --- API Key Rotation Setup ---
const apiKeys = getYoutubeKeys();
let currentKeyIndex = 0;

if (apiKeys.length === 0) {
    console.error("FATAL: No YouTube API keys found. Please configure YOUTUBE_API_KEY_1, etc. in .env");
}

const getApiKey = () => {
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
            console.log(`✅ CACHE HIT for "${q}". Video ID: ${cachedResult.videoId}`);
            return res.json({ videoId: cachedResult.videoId });
        }

        console.log(`❌ CACHE MISS for "${q}". Fetching from YouTube API...`);
        
        // --- API Key Rotation Logic (Option 1) ---
        if (apiKeys.length === 0) {
            return res.status(500).json({ error: 'Server is not configured with YouTube API keys.' });
        }

        const url = `https://www.googleapis.com/youtube/v3/search`;
        let attempts = 0;
        let success = false;

        while (attempts < apiKeys.length && !success) {
            const apiKey = getApiKey();
            const keyNumber = apiKeys.indexOf(apiKey) + 1; // logical number for logging
            console.log(`Using YouTube API Key #${keyNumber} (Attempt ${attempts + 1}/${apiKeys.length})`);

            try {
                const response = await axios.get(url, {
                    params: { part: 'snippet', q, type: 'video', maxResults: 1, key: apiKey },
                });

                if (response.data.items && response.data.items.length > 0) {
                    const videoId = response.data.items[0].id.videoId;
                    console.log(`YouTube for "${q}" found video ID: ${videoId}`);

                    // Save the new result to the cache
                    const newCacheEntry = new YouTubeCache({ query: q, videoId: videoId });
                    await newCacheEntry.save();
                    console.log(`💾 Saved to cache: "${q}" -> ${videoId}`);
                    
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

                console.error('--- YouTube API Error ---');
                if(error.response) console.error(`Status: ${status}`, 'Data:', JSON.stringify(error.response.data, null, 2));
                else console.error('Error:', error.message);
                console.error('--- End YouTube API Error ---');

                if (isQuotaError) {
                    attempts++;
                    console.warn(`⚠️ Quota exceeded (403/429) for key #${keyNumber}. Switching to next key...`);
                    // The loop will continue and getApiKey() will provide the next one.
                } else {
                    // Non-quota error, abort
                    return res.status(500).json({ error: 'Failed to fetch video from YouTube API.' });
                }
            }
        }
        
        if (!success) {
             console.error("All YouTube API keys have exceeded their quota or failed.");
             return res.status(429).json({ error: 'All available API keys have exceeded their daily quota.' });
        }

    } catch (dbError) {
        console.error("--- Database Error ---", dbError);
        res.status(500).json({ error: 'A database error occurred.' });
    }
});

module.exports = router;