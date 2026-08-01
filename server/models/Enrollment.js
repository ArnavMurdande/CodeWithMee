const mongoose = require('mongoose');

const EnrollmentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  status: { type: String, enum: ['enrolled', 'in_progress', 'completed', 'pending_payment'], default: 'enrolled' },
  progressPercent: { type: Number, default: 0 },
  completedContents: [{ type: mongoose.Schema.Types.ObjectId }], // track completed ModuleContent IDs
  employeeId: { type: String },
  enrolledAt: { type: Date, default: Date.now },
  completedAt: { type: Date }
});

module.exports = mongoose.model('Enrollment', EnrollmentSchema);
