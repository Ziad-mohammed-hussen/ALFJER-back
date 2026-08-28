const mongoose = require('mongoose');

const InvoiceItemSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  studentName: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  minutes: {
    type: Number,
    default: 0
  },
  hours: {
    type: Number,
    required: true
  },
  rate: {
    type: Number,
    required: true
  },
  total: {
    type: Number,
    required: true
  }
});

const InvoiceSchema = new mongoose.Schema({
  invoiceNumber: {
    type: String,
    required: true,
    unique: true
  },
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  month: {
    type: Date,
    required: true // First day of the invoice month, e.g. 2026-07-01
  },
  items: [InvoiceItemSchema],
  subTotal: {
    type: Number,
    required: true
  },
  paypalFee: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    enum: ['USD', 'EGP', 'EUR', 'GBP'],
    default: 'USD'
  },
  paymentStatus: {
    type: String,
    enum: ['Unpaid', 'Paid', 'PartiallyPaid'],
    default: 'Unpaid'
  },
  paymentMethod: {
    type: String,
    enum: ['PayPal', 'BankTransfer', 'VodafoneCash', 'Cash', 'Other'],
    default: 'PayPal'
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

InvoiceSchema.virtual('monthStr').get(function() {
  if (!this.month) return '';
  const d = new Date(this.month);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
});
InvoiceSchema.set('toJSON', { virtuals: true });
InvoiceSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Invoice', InvoiceSchema);
