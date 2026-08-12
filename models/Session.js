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
    required: false,
    default: 'القرآن الكريم والتجويد'
  },
  program: {
    type: String,
    default: 'القرآن الكريم والتجويد'
  },
  isCombinedProgram: {
    type: Boolean,
    default: false
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
    enum: ['Present', 'Excused', 'Unexcused', 'TeacherAbs', 'Trial', 'TeacherMakeup', 'StudentMakeup'],
    required: true
  },
  scheduledMakeupDate: {
    type: Date,
    default: null
  },
  scheduledMakeupTimeSlot: {
    type: String,
    default: ''
  },
  latenessRemark: {
    type: String,
    default: ''
  },
  notifiedOnGroup: {
    type: Boolean,
    default: false
  },
  preNotifiedTwoHours: {
    type: Boolean,
    default: false
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
  supervisorChecklist: {
    teacherOnTime: { type: Boolean, default: false },
    teacherLateAskedParents: { type: Boolean, default: false },
    sentSessionReport: { type: Boolean, default: false },
    sentReportAfterRemind: { type: Boolean, default: false },
    evaluatedQuality: { type: Boolean, default: false },
    sentInteractiveActivity: { type: Boolean, default: false }
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
