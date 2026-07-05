const mongoose = require('mongoose');

const MonthlyReportSchema = new mongoose.Schema({
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
  month: {
    type: Date,
    required: true // Store as the 1st of the month, e.g. 2026-07-01
  },
  initialTrialSummary: {
    type: String,
    default: ''
  },
  startingLevelRating: {
    type: Number,
    min: 1,
    max: 5,
    required: true
  },
  currentProgressRating: {
    type: Number,
    min: 1,
    max: 5,
    required: true
  },
  textEvaluation: {
    type: String,
    required: [true, 'Please add text evaluation progress details']
  },
  attendancePercentage: {
    type: Number,
    min: 0,
    max: 100,
    default: 100
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Ensure a single monthly report per student, teacher, and month
MonthlyReportSchema.index({ student: 1, teacher: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('MonthlyReport', MonthlyReportSchema);
