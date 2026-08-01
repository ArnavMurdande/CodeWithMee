const mongoose = require('mongoose');

const ModuleContentSchema = new mongoose.Schema({
  type: { type: String, enum: ['video', 'note', 'link', 'resource', 'practice', 'test'], required: true },
  title: { type: String, required: true },
  url: { type: String },
  content: { type: String }, // For markdown notes or rich text
  allowDownload: { type: Boolean, default: false },
  order: { type: Number, default: 0 }
});

const CourseModuleSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  order: { type: Number, default: 0 },
  contents: [ModuleContentSchema]
});

const CourseSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  title: { type: String, required: true },
  description: { type: String },
  thumbnail: { type: String },
  visibility: { type: String, enum: ['public', 'private'], default: 'public' },
  pricing: { type: String, enum: ['free', 'paid'], default: 'free' },
  price: { type: Number, default: 0 },
  category: { type: String },
  tags: [String],
  isActive: { type: Boolean, default: true },
  certificateTemplateUrl: { type: String },
  certificateDesignCoordinates: {
    nameX: { type: Number, default: 0 },
    nameY: { type: Number, default: 0 },
    dateX: { type: Number, default: 0 },
    dateY: { type: Number, default: 0 }
  },
  modules: [CourseModuleSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Course', CourseSchema);
