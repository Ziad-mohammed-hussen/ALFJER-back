const mongoose = require('mongoose');

const LeadSourceSchema = new mongoose.Schema({
  leadName: {
    type: String,
    required: true
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    default: null
  },
  sourceType: {
    type: String,
    enum: ['parent_referral', 'ad', 'organic', 'other'],
    required: true
  },
  referrerParent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  notes: {
    type: String,
    default: ''
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('LeadSource', LeadSourceSchema);
