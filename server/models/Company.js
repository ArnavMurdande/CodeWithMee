const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const CompanySchema = new mongoose.Schema({
  companyName: { type: String, required: true },
  companyId: { type: String, required: true, unique: true }, // Unique string for employees to use to join
  adminEmail: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  logo: { type: String, default: null },
  description: { type: String, default: '' },
  industry: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'approved'], default: 'pending' },
  themePreferences: {
    preset: { type: String, default: 'ocean' },
    color1: { type: String, default: '#149ecc' },
    color2: { type: String, default: '#412ecc' },
    color3: { type: String, default: '#44cf87' },
    customColors: { type: Boolean, default: false }
  },
  createdAt: { type: Date, default: Date.now }
});

// Middleware to hash password before saving
CompanySchema.pre('save', async function (next) {
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

module.exports = mongoose.model('Company', CompanySchema);
