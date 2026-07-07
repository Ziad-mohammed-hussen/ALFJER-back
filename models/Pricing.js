const mongoose = require('mongoose');

const PricingSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  subject: {
    type: String,
    required: [true, 'Please add a subject']
  },
  // Pricing for the parent/student
  hourlyRate: {
    type: Number,
    required: [true, 'Please specify hourly rate for student']
  },
  currency: {
    type: String,
    enum: ['USD', 'EGP', 'EUR', 'GBP'],
    default: 'USD'
  },
  // Pricing/Pay rate for the teacher
  teacherRate: {
    type: Number,
    required: [true, 'Please specify pay rate for teacher']
  },
  teacherCurrency: {
    type: String,
    enum: ['USD', 'EGP', 'EUR', 'GBP'],
    default: 'USD'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Ensure uniqueness of student + teacher + subject combination
PricingSchema.index({ student: 1, teacher: 1, subject: 1 }, { unique: true });

module.exports = mongoose.model('Pricing', PricingSchema);
