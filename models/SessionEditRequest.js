const mongoose = require('mongoose');

const SessionEditRequestSchema = new mongoose.Schema({
  session: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    required: true
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reason: {
    type: String,
    required: true
  },
  proposedChanges: {
    status: {
      type: String,
      enum: ['Present', 'Excused', 'Unexcused', 'TeacherAbs', 'Trial']
    },
    durationHours: Number,
    date: Date,
    subject: String,
    teacherNote: String
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('SessionEditRequest', SessionEditRequestSchema);
