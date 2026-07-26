const mongoose = require('mongoose');

const WeeklyScheduleSchema = new mongoose.Schema({
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  dayOfWeek: {
    type: String,
    enum: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    required: true
  },
  timeSlot: {
    type: String,
    required: true // e.g. "16:00"
  },
  durationMinutes: {
    type: Number,
    default: 60
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  subject: {
    type: String,
    required: false,
    default: 'القرآن الكريم والتجويد'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('WeeklySchedule', WeeklyScheduleSchema);
