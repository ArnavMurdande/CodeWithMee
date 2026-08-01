/**
 * Dynamically loads API keys from environment variables based on a prefix.
 * Supports patterns like KEY_1, KEY_2, etc. and legacy single keys or comma-separated lists.
 * @param {string} prefix - The prefix for the env variables (e.g., 'GEMINI_API_KEY')
 * @param {number} maxCount - The maximum number of numbered keys to check.
 * @param {string} legacyListVar - Optional: A legacy env var name that might contain a comma-separated list (e.g. 'YOUTUBE_API_KEYS')
 * @returns {string[]} - Array of loaded keys.
 */
const loadKeys = (environment, prefix, maxCount, legacyListVar = null) => {
  const keys = [];

  // 1. Check for numbered keys (e.g., GEMINI_API_KEY_1, GEMINI_API_KEY_2)
  for (let i = 1; i <= maxCount; i++) {
    const key = environment[`${prefix}_${i}`];
    if (key && key.trim()) {
      keys.push(key.trim());
    }
  }

  // 2. If no numbered keys found, checks for the base key (e.g., GEMINI_API_KEY)
  if (keys.length === 0) {
    const singleKey = environment[prefix];
    if (singleKey && singleKey.trim()) {
      keys.push(singleKey.trim());
    }
  }

  // 3. Fallback for legacy comma-separated list (specifically for YouTube)
  if (keys.length === 0 && legacyListVar && environment[legacyListVar]) {
    const legacyKeys = environment[legacyListVar]
      .split(",")
      .filter((k) => k.trim());
    keys.push(...legacyKeys);
  }

  return keys;
};

const getGeminiKeys = (environment = process.env) =>
  loadKeys(environment, "GEMINI_API_KEY", 8);
const getYoutubeKeys = (environment = process.env) =>
  loadKeys(environment, "YOUTUBE_API_KEY", 6, "YOUTUBE_API_KEYS");

module.exports = { getGeminiKeys, getYoutubeKeys };
