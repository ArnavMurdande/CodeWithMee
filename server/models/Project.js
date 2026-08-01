const mongoose = require('mongoose');

const MilestoneSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, default: '' },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date, default: null }
});

const ProjectSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    techStack: [{ type: String }],
    visibility: { type: String, enum: ['public', 'private'], default: 'public' },
    authorType: { type: String, enum: ['User', 'Company'], default: 'User' },
    author: { type: mongoose.Schema.Types.ObjectId, refPath: 'authorType', required: true },
    milestones: [MilestoneSchema],
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Project', ProjectSchema);
