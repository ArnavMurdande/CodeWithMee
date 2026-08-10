const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const { getPgPool } = require('../db/postgres');
const { createLegacyLogger } = require('../utils/legacyLogger');

const legacyLogger = createLegacyLogger('youtube');

function getCacheHash(q) {
  return crypto.createHash('sha256').update(String(q || '').toLowerCase()).digest('hex');
}

async function getCachedVideoIdPg(q) {
  const pool = getPgPool();
  if (!pool) return null;
  try {
    const hash = getCacheHash(q);
    const res = await pool.query(
      `SELECT value FROM integration_cache WHERE provider = 'youtube' AND key_hash = $1 AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
      [hash]
    );
    if (res.rows[0]?.value?.videoId) {
      return res.rows[0].value.videoId;
    }
  } catch (err) {
    legacyLogger.warn('postgres_cache_read_failed', err);
  }
  return null;
}

async function saveCachedVideoIdPg(q, videoId) {
  const pool = getPgPool();
  if (!pool) return false;
  try {
    const hash = getCacheHash(q);
    const id = 'cache_' + hash.substring(0, 16);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO integration_cache (id, provider, key_hash, value, expires_at, created_at)
       VALUES ($1, 'youtube', $2, $3::jsonb, $4, NOW())
       ON CONFLICT (provider, key_hash) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`,
      [id, hash, JSON.stringify({ videoId }), expiresAt]
    );
    return true;
  } catch (err) {
    legacyLogger.warn('postgres_cache_save_failed', err);
    return false;
  }
}

// --- API Key Rotation Setup ---
const { getYoutubeKeys } = require('../utils/keyManager');

let currentKeyIndex = 0;

const getApiKey = (apiKeys) => {
    if (apiKeys.length === 0) return null;
    const key = apiKeys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    return key;
};

const fallbackVideoMap = [
  { keywords: ['javascript', 'js', 'react', 'node', 'express'], videoId: 'W6NZfCO5SIk' },
  { keywords: ['java', 'jdk', 'spring'], videoId: 'eIrMbAQSU34' },
  { keywords: ['c++', 'cpp'], videoId: 'vLnPwxZdW4Y' },
  { keywords: ['python', 'py', 'django', 'flask', 'pandas'], videoId: 'rfscVS0vtbw' },
  { keywords: ['sql', 'database', 'queries', 'postgres', 'mysql', 'sqlite'], videoId: 'HXV3zeQKqGY' },
  { keywords: ['html', 'css', 'web'], videoId: 'mU6anWqZJcc' },
  { keywords: ['rust', 'cargo'], videoId: 'zF34dRivLOw' },
  { keywords: ['go', 'golang'], videoId: 'YS4e4q9oBaU' },
];

function getFallbackVideoId(query) {
  const qLower = (query || '').toLowerCase();
  for (const item of fallbackVideoMap) {
    if (item.keywords.some((kw) => {
      const regex = new RegExp(`\\b${kw.replace('+', '\\+')}\\b`, 'i');
      return regex.test(qLower);
    })) {
      return item.videoId;
    }
  }
  return 'rfscVS0vtbw'; // Default programming tutorial fallback
}

// --- Main Search Route ---
router.get('/search', async (req, res) => {
    const { q } = req.query;

    if (!q) {
        return res.status(400).json({ error: 'Search query is required.' });
    }

    try {
        // --- PostgreSQL Caching Logic ---
        try {
            const pgVid = await getCachedVideoIdPg(q);
            if (pgVid) {
                legacyLogger.info('cache_hit');
                return res.json({ videoId: pgVid });
            }

        } catch (dbError) {
            legacyLogger.warn('cache_read_failed', dbError);
        }

        legacyLogger.info('cache_miss');
        
        // --- API Key Rotation Logic ---
        const apiKeys = getYoutubeKeys();
        if (apiKeys.length === 0) {
            const fallbackId = getFallbackVideoId(q);
            return res.json({ videoId: fallbackId, fallback: true });
        }

        const hasSpecificLanguage = /\b(hindi|spanish|french|german|tamil|telugu|marathi|bengali|portuguese|russian|japanese|chinese|korean)\b/i.test(q);
        const searchQuery = hasSpecificLanguage || /\bin english\b/i.test(q) ? q : `${q} in English`;

        const url = `https://www.googleapis.com/youtube/v3/search`;
        let attempts = 0;
        let success = false;

        while (attempts < apiKeys.length && !success) {
            const apiKey = getApiKey(apiKeys);
            legacyLogger.info('provider_attempt', { attempt: attempts + 1, total: apiKeys.length });

            try {
                const searchParams = {
                    part: 'snippet',
                    q: searchQuery,
                    type: 'video',
                    maxResults: 1,
                    key: apiKey,
                };
                if (!hasSpecificLanguage) {
                    searchParams.relevanceLanguage = 'en';
                }

                const response = await axios.get(url, { params: searchParams });

                if (response.data.items && response.data.items.length > 0) {
                    const videoId = response.data.items[0].id.videoId;
                    legacyLogger.info('provider_result_found');

                    // Save the new result to cache
                    try {
                        await saveCachedVideoIdPg(q, videoId);
                        legacyLogger.info('cache_saved');
                    } catch (cacheErr) {
                        legacyLogger.warn('cache_save_failed', cacheErr);
                    }
                    
                    success = true;
                    return res.json({ videoId });
                } else {
                    const fallbackId = getFallbackVideoId(q);
                    success = true;
                    return res.json({ videoId: fallbackId, fallback: true });
                }

            } catch (error) {
                const status = error.response?.status;
                const reason = error.response?.data?.error?.errors?.[0]?.reason;
                const isQuotaError = status === 403 || status === 429 || reason === 'quotaExceeded';

                legacyLogger.error('provider_request_failed', error);

                if (isQuotaError) {
                    attempts++;
                    legacyLogger.warn('provider_quota_exceeded', { code: status });
                } else {
                    // Non-quota error, use fallback video
                    const fallbackId = getFallbackVideoId(q);
                    return res.json({ videoId: fallbackId, fallback: true });
                }
            }
        }
        
        if (!success) {
             legacyLogger.error('provider_keys_exhausted', { code: 'quota_exhausted' });
             const fallbackId = getFallbackVideoId(q);
             return res.json({ videoId: fallbackId, fallback: true });
        }

    } catch (dbError) {
        legacyLogger.error('cache_database_failed', dbError);
        const fallbackId = getFallbackVideoId(q);
        res.json({ videoId: fallbackId, fallback: true });
    }
});

module.exports = router;
