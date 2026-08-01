const mongoose = require('mongoose');

const SpaceCommentSchema = new mongoose.Schema();

SpaceCommentSchema.add({
  authorType: { type: String, enum: ['User', 'Company'], required: true },
  author: { type: mongoose.Schema.Types.ObjectId, refPath: 'comments.authorType' },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  likes: [{ type: String }],
  dislikes: [{ type: String }],
  saves: [{ type: String }],
  awards: [{
    user: { type: String },
    type: { type: String, enum: ["star", "fire", "heart", "rocket", "diamond"] },
    createdAt: { type: Date, default: Date.now },
  }],
  replies: [SpaceCommentSchema]
});

const PostSchema = new mongoose.Schema({
  authorType: { type: String, enum: ['User', 'Company'], required: true },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'authorType',
    required: true
  },
  content: {
    type: String,
    required: true
  },
  attachments: [{
    type: { type: String, enum: ['image', 'video', 'audio'] },
    url: { type: String }
  }],
  likes: [{ type: String }],
  dislikes: [{ type: String }],
  saves: [{ type: String }],
  awards: [{
      user: { type: String },
      type: { type: String, enum: ["star", "fire", "heart", "rocket", "diamond"] },
      createdAt: { type: Date, default: Date.now },
  }],
  comments: [SpaceCommentSchema],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Post', PostSchema);
