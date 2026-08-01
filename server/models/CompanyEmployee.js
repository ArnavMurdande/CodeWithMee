const mongoose = require('mongoose');

const CompanyEmployeeSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  employeeId: { type: String }, // Internal employee ID (optional)
  role: { type: String, enum: ['admin', 'member'], default: 'member' },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  addedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('CompanyEmployee', CompanyEmployeeSchema);
