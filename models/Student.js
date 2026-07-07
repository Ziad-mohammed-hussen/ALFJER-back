const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add student name']
  },
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Please associate this student with a parent']
  },
  teachers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  status: {
    type: String,
    enum: ['Active', 'Paused', 'Inactive'],
    default: 'Active'
  },
  timezone: {
    type: String,
    default: 'Africa/Cairo'
  },
  // Student photo (base64 or Cloudinary URL)
  photoUrl: {
    type: String,
    default: ''
  },
  // Initial level assessed at free trial session
  initialLevel: {
    type: String,
    enum: ['', 'مبتدئ تماماً', 'يعرف الحروف', 'يقرأ ببطء', 'قارئ متوسط', 'قارئ جيد', 'حافظ جزء', 'حافظ أجزاء'],
    default: ''
  },
  // Parent consent for using student photos on social media
  parentSocialMediaConsent: {
    type: Boolean,
    default: false
  },
  joinedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Student', StudentSchema);
