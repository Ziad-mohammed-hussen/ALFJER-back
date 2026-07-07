const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema({
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
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  durationMinutes: {
    type: Number,
    required: true,
    default: 60
  },
  status: {
    type: String,
    enum: ['Present', 'Excused', 'Unexcused', 'TeacherAbs', 'Trial'],
    required: true
  },
  // If this session is a makeup for a previous missed session
  isMakeup: {
    type: Boolean,
    default: false
  },
  originalSession: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    default: null
  },
  // Status of the makeup requirement (if this session was a missed one)
  makeupStatus: {
    type: String,
    enum: ['None', 'Pending', 'Scheduled', 'Completed', 'Cancelled'],
    default: 'None' // Will be 'Pending' if status is 'Excused' or 'TeacherAbs'
  },
  makeupSession: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    default: null
  },
  makeupDifficultyNote: {
    type: String,
    default: ''
  },
  isApprovedBySupervisor: {
    type: Boolean,
    default: false
  },
  isLocked: {
    type: Boolean,
    default: false // Locked after the month is closed
  },
  isBilled: {
    type: Boolean,
    default: false
  },
  isPaidToTeacher: {
    type: Boolean,
    default: false
  },
  teacherNote: {
    type: String,
    default: ''
  },
  internalSupervisorNote: {
    type: String,
    default: ''
  },
  consecutiveAbsenceCounter: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Session', SessionSchema);
