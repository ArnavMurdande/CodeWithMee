const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const TopicSchema = new mongoose.Schema({
  topic: String,
  description: String,
  youtube_query: String,
  completed: { type: Boolean, default: false }
});

const RoadmapSchema = new mongoose.Schema({
  title: String,
  topics: [TopicSchema]
});

// Schema for storing AI conversations
const ConversationSchema = new mongoose.Schema({
  prompt: { type: String, required: true },
  response: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

// Defines the structure for user documents in the MongoDB database.
const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    index: true // Index added for faster email lookups
  },
  password: {
    type: String,
    required: true,
  },
  profilePictureUrl: {
    type: String,
    default: null,
  },
  authMethod: {
    type: String,
    enum: ['google', 'local'],
    default: 'local',
  },
  roadmaps: [RoadmapSchema],
  conversations: [ConversationSchema], // Added for Sandbox chat history
  jobSims: [{
    title: String,
    progress: { type: Number, default: 0 }
  }],
  notes: [{
    title: String,
    content: String,
    createdAt: { type: Date, default: Date.now }
  }],
  solvedChallenges: [{
    challenge: { type: mongoose.Schema.Types.ObjectId, ref: 'Challenge' },
    solvedAt: { type: Date, default: Date.now }
  }],
  score: {
    type: Number,
    default: 0
  },
  savedChallenges: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Challenge' }]
});

// Middleware to hash password before saving
UserSchema.pre('save', async function (next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) {
    return next();
  }
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('User', UserSchema);