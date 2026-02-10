const mongoose = require('mongoose');

const YouTubeCacheSchema = new mongoose.Schema({
  query: {
    type: String,
    required: true,
    unique: true, // Each search query is unique
    index: true,    // Index for faster lookups
  },
  videoId: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: '30d', // Automatically delete cache entries after 30 days
  },
});

module.exports = mongoose.model('YouTubeCache', YouTubeCacheSchema);