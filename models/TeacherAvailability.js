const mongoose = require('mongoose');

const TeacherAvailabilitySchema = new mongoose.Schema({
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
    type: String, // e.g. "17:00" or "05:00 PM" (Egypt Teacher Time)
    required: true
  },
  durationMinutes: {
    type: Number,
    default: 60
  },
  isPermanent: {
    type: Boolean,
    default: true // true = weekly recurring, false = specific week only
  },
  specificDate: {
    type: Date,
    default: null // Used if isPermanent = false
  },
  notes: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('TeacherAvailability', TeacherAvailabilitySchema);
