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
    default: null
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
    required: [true, 'عمر الطالب مطلوب'],
    min: [1, 'عمر الطالب يجب أن يكون سنة واحدة على الأقل'],
    max: [120, 'عمر الطالب غير صالح']
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
  // البرامج المسجل بها (قائمة حرة)
  programs: [{
    type: String
  }],
  // برنامج مخصص (لو اختار "أخرى")
  customProgram: {
    type: String,
    default: ''
  },
  // المستوى لكل برنامج (مخزن كـ JSON string: { "برنامج": "مستوى", ... })
  programLevels: {
    type: String,
    default: '{}'
  },
  // الكتب لكل برنامج (مخزن كـ JSON string: { "برنامج": ["كتاب1", "كتاب2"], ... })
  programBooks: {
    type: String,
    default: '{}'
  },
  // حقول قديمة للتوافقية (backward compat)
  initialLevel: {
    type: String,
    default: ''
  },
  levelPerProgram: {
    type: String,
    default: ''
  },
  booksUsed: [{
    type: String
  }],

  // ─── القسم 3: جدول المواعيد المتعددة ─────────────────────
  // نظام جديد: مواعيد متعددة (يوم + وقت + مدة لكل موعد)
  scheduleSlots: [{
    day: {
      type: String,
      enum: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
    },
    time: { type: String, default: '' },          // HH:MM بتوقيت المعلم
    durationMinutes: { type: Number, default: 60 }
  }],

  // حقول قديمة للتوافقية
  sessionDurationMinutes: {
    type: Number,
    default: 60
  },
  sessionDays: [{
    type: String,
    enum: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  }],
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
