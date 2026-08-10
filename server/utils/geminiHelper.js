const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getGeminiKeys } = require("./keyManager");
const { createLegacyLogger } = require("./legacyLogger");

const legacyLogger = createLegacyLogger("gemini");

/**

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

    const candidateModels = Array.isArray(modelName)
        ? modelName
        : [modelName, 'gemini-flash-latest', 'gemini-2.0-flash', 'gemini-1.5-pro-latest'].filter((m, idx, self) => m && self.indexOf(m) === idx);

    let lastError = null;

    for (const targetModel of candidateModels) {
        // Shuffle keys for load balancing
        const shuffledKeys = [...keys].sort(() => 0.5 - Math.random());
        
        for (let i = 0; i < shuffledKeys.length; i++) {
            const key = shuffledKeys[i];
            
            try {
                const genAI = new GoogleGenerativeAI(key);
                const model = genAI.getGenerativeModel({ model: targetModel });
                
                legacyLogger.info("provider_attempt", { model: targetModel, attempt: i + 1, total: shuffledKeys.length });
                
                const result = await model.generateContent(prompt);
                if (result && result.response) {
                    return result; // Success!
                }
            } catch (error) {
                lastError = error;
                const status = error.status || error.response?.status;
                legacyLogger.warn("provider_retry", { model: targetModel, code: status || error.message || 'non_200' });
            }
        }
    }

    legacyLogger.error("provider_keys_exhausted", lastError);
    throw lastError || new Error("All Gemini API keys and model candidates failed.");
};

module.exports = { generateContentWithRetry };
