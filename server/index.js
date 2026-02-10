const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const { getGeminiKeys, getYoutubeKeys } = require('./utils/keyManager');

// --- Log Loaded Keys ---
const geminiKeys = getGeminiKeys();
const youtubeKeys = getYoutubeKeys();
console.log(`🚀 Loaded ${geminiKeys.length} Gemini Keys`);
console.log(`🚀 Loaded ${youtubeKeys.length} YouTube Keys`);

// Initialize the app
const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from the 'uploads' directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- Database Connection ---
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected successfully! Ready to code! 🚀');
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    // Exit process with failure
    process.exit(1);
  }
};

connectDB();

// --- API Routes ---
app.use('/api/auth', require('./routes/auth'));
app.use('/api/code', require('./routes/code'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/youtube', require('./routes/youtube'));
app.use('/api/roadmap', require('./routes/roadmap'));
app.use('/api/user', require('./routes/user'));
app.use('/api/challenges', require('./routes/challenges'));

// A simple test route to check if the server is working
app.get('/api/test', (req, res) => {
  res.json({ message: 'Hello from the server! 👋' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}. Let the coding adventure begin! ✨`);
});
