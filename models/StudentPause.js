const mongoose = require('mongoose');

const StudentPauseSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  supervisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['temporary', 'permanent'],
    required: true
  },
  reason: {
    type: String,
    required: true
  },
  pausedAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  expectedReturnAt: {
    type: Date
  },
  actualReturnAt: {
    type: Date,
    default: null
  },
  isResolved: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('StudentPause', StudentPauseSchema);
