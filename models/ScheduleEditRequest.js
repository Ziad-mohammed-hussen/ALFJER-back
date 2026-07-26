const mongoose = require('mongoose');

const ScheduleEditRequestSchema = new mongoose.Schema({
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
  supervisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  oldScheduleSlots: [{
    dayOfWeek: String,
    timeSlot: String,
    durationMinutes: Number
  }],
  newScheduleSlots: [{
    dayOfWeek: String,
    timeSlot: String,
    durationMinutes: Number
  }],
  newStudentTimezone: {
    type: String,
    default: ''
  },
  newStudentCountry: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending'
  },
  rejectionReason: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  resolvedAt: {
    type: Date,
    default: null
  }
});

module.exports = mongoose.model('ScheduleEditRequest', ScheduleEditRequestSchema);
