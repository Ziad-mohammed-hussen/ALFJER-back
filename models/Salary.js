const mongoose = require('mongoose');

const SalarySchema = new mongoose.Schema({
  salaryNumber: {
    type: String,
    required: true,
    unique: true
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  month: {
    type: Date,
    required: true // First day of payroll month
  },
  hoursTaught: {
    type: Number,
    required: true,
    default: 0
  },
  baseSalaryUsd: {
    type: Number,
    default: 0
  },
  baseSalaryEgp: {
    type: Number,
    default: 0
  },
  exchangeRateUsed: {
    type: Number,
    required: true,
    default: 50.0
  },
  finalPayoutEgp: {
    type: Number,
    required: true
  },
  payoutStatus: {
    type: String,
    enum: ['Unpaid', 'Paid'],
    default: 'Unpaid'
  },
  isApprovedByAdmin: {
    type: Boolean,
    default: false
  },
  paidAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Salary', SalarySchema);
