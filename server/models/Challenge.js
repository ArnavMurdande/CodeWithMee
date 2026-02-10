const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TestCaseSchema = new Schema({
  input: { type: String, required: true },
  output: { type: String, required: true },
  isExample: { type: Boolean, default: false }
});

// Using a forward declaration for recursive schema
const CommentSchema = new Schema();

CommentSchema.add({
  text: { type: String, required: true },
  author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  dislikes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  replies: [CommentSchema] // Nested replies
});

const ChallengeSchema = new Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    unique: true,
  },
  description: {
    type: String,
    required: true,
  },
  constraints: {
    type: String,
    required: false,
  },
  difficulty: {
    type: String,
    enum: ['Easy', 'Medium', 'Hard'],
    required: true,
    index: true // Index added for faster filtering
  },
  tags: {
    type: [String],
    index: true // Index added for faster searching by tag
  },
  score: {
    type: Number,
    required: true,
    min: 1,
    max: 10,
  },
  author: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  solution: {
    type: String,
    required: true,
  },
  testCases: [TestCaseSchema],
  comments: [CommentSchema],
  likes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  dislikes: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  successfulAttempts: { type: Number, default: 0 },
  totalAttempts: { type: Number, default: 0 },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Challenge', ChallengeSchema);
