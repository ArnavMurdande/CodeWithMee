const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getGeminiKeys } = require("./keyManager");
const { createLegacyLogger } = require("./legacyLogger");

const legacyLogger = createLegacyLogger("gemini");

/**
 * Generates content using Google Gemini with automatic load balancing and failover.
 * 
 * @param {string} modelName - The model to use (e.g., 'gemini-pro').
 * @param {string} prompt - The prompt to send to the AI.
 * @returns {Promise<object>} - The generation result object.
 */
const generateContentWithRetry = async (modelName, prompt) => {
    const keys = getGeminiKeys();
    
    if (keys.length === 0) {
        throw new Error("FATAL: No Gemini API keys found. Please configure GEMINI_API_KEY_1 in .env");
    }

    // Shuffle keys for load balancing
    const shuffledKeys = [...keys].sort(() => 0.5 - Math.random());
    
    let lastError = null;

    for (let i = 0; i < shuffledKeys.length; i++) {
        const key = shuffledKeys[i];
        
        try {
            // Re-instantiate client for each attempt as requested
            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({ model: modelName });
            
            legacyLogger.info("provider_attempt", { attempt: i + 1, total: shuffledKeys.length });
            
            const result = await model.generateContent(prompt);
            return result; // Success!

        } catch (error) {
            lastError = error;
            
            // Check for retryable errors (429: Too Many Requests, 503: Service Unavailable)
            // Note: GoogleGenerativeAIError might wrap the status. 
            // We check status property or message content.
            const status = error.status || error.response?.status;
            const isRetryable = status === 429 || status === 503 || 
                                (error.message && (error.message.includes('429') || error.message.includes('503')));

            if (isRetryable) {
                legacyLogger.warn("provider_retry", { code: status });
                continue; // Try next key
            } else {
                // Non-retryable error (e.g., 400 Bad Request, blocked content)
                legacyLogger.error("provider_non_retryable", error);
                throw error;
            }
        }
    }

    legacyLogger.error("provider_keys_exhausted", lastError);
    throw lastError;
};

module.exports = { generateContentWithRetry };
