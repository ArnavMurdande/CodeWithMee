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

// Schema for storing sandbox AI conversations (per pathway/chapter)
const SandboxConversationSchema = new mongoose.Schema({
  pathway: { type: String, default: 'General' },
  chapter: { type: String, default: 'General' },
  prompt: { type: String, required: true },
  response: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

// Schema for storing video playback progress (Active Recall Checkpoints)
const VideoProgressSchema = new mongoose.Schema({
  videoId: { type: String, required: true },
  timestamp: { type: Number, default: 0 }, // seconds into the video
  duration: { type: Number, default: 0 }, // total video duration
  topic: { type: String, default: '' },
  pathway: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now }
});

// Schema for storing rich notes (Floating Notes Widget)
const NoteAttachmentSchema = new mongoose.Schema({
  fileType: { type: String, enum: ['image', 'audio', 'video'], required: true },
  url: { type: String, required: true },
  name: { type: String, default: '' },
  uploadedAt: { type: Date, default: Date.now }
});

const NoteSchema = new mongoose.Schema({
  title: { type: String, default: 'Untitled Note' },
  content: { type: String, default: '' },
  attachments: [NoteAttachmentSchema],
  formatting: {
    fontSize: { type: Number, default: 14 },
    fontWeight: { type: String, default: 'normal' },
    color: { type: String, default: '#e0e0e0' },
  },
  canvasData: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
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
    index: true
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
  conversations: [ConversationSchema],
  sandboxConversations: [SandboxConversationSchema],
  videoProgress: [VideoProgressSchema],
  jobSims: [{
    title: String,
    progress: { type: Number, default: 0 }
  }],
  notes: [NoteSchema],
  solvedChallenges: [{
    challenge: { type: mongoose.Schema.Types.ObjectId, ref: 'Challenge' },
    solvedAt: { type: Date, default: Date.now }
  }],
  score: {
    type: Number,
    default: 0
  },
  savedChallenges: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Challenge' }],
  themePreferences: {
    preset: { type: String, default: 'ocean' },
    color1: { type: String, default: '#149ecc' },
    color2: { type: String, default: '#412ecc' },
    color3: { type: String, default: '#44cf87' },
    customColors: { type: Boolean, default: false },
  }
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