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
  sessions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session'
  }],
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

SalarySchema.virtual('monthStr').get(function() {
  if (!this.month) return '';
  const d = new Date(this.month);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
});
SalarySchema.set('toJSON', { virtuals: true });
SalarySchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Salary', SalarySchema);
