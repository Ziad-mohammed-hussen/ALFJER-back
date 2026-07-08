const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema({
  // ─── الأساسيات ────────────────────────────────────────────
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
  // Student photo (Cloudinary URL)
  photoUrl: {
    type: String,
    default: ''
  },
  // Parent consent for social media
  parentSocialMediaConsent: {
    type: Boolean,
    default: false
  },

  // ─── القسم 1: البيانات الإحصائية ─────────────────────────
  age: {
    type: Number,
    default: null
  },
  language: {
    type: String,
    enum: ['', 'عربي', 'إنجليزي', 'فرنسي', 'أخرى'],
    default: ''
  },
  country: {
    type: String,
    default: ''
  },
  timezone: {
    type: String,
    default: 'Africa/Cairo'
  },

  // ─── القسم 2: البيانات الكمية ─────────────────────────────
  startDate: {
    type: Date,
    default: null
  },
  programs: [{
    type: String
  }],
  initialLevel: {
    type: String,
    enum: ['', 'مبتدئ تماماً', 'يعرف الحروف', 'يقرأ ببطء', 'قارئ متوسط', 'قارئ جيد', 'حافظ جزء', 'حافظ أجزاء'],
    default: ''
  },
  levelPerProgram: {
    type: String,
    default: ''
  },
  booksUsed: [{
    type: String
  }],

  // ─── القسم 3: جدول المعلم ────────────────────────────────
  sessionDurationMinutes: {
    type: Number,
    default: 60
  },
  sessionDays: [{
    type: String,
    enum: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  }],
  // توقيت الحصة بتوقيت المعلم (HH:MM)
  sessionTimeTeacher: {
    type: String,
    default: ''
  },

  joinedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Student', StudentSchema);
