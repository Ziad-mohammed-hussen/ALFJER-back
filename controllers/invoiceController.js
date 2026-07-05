const Invoice = require('../models/Invoice');
const Session = require('../models/Session');
const Student = require('../models/Student');
const Pricing = require('../models/Pricing');
const User = require('../models/User');

// @desc    Generate invoice for a parent for a specific month
// @route   POST /api/invoices/generate
// @access  Private/Admin
const generateInvoice = async (req, res) => {
  const { parentId, monthStr, applyPaypalFee } = req.body;

  try {
    const parent = await User.findById(parentId);
    if (!parent || parent.role !== 'Parent') {
      return res.status(400).json({ message: 'Invalid parent selected' });
    }

    const date = new Date(monthStr); // Month string format: "YYYY-MM"
    const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

    // Get parent's children
    const students = await Student.find({ parent: parentId });
    const studentIds = students.map(s => s._id);

    // Find all billable sessions in this month range
    // Billable: Present, Unexcused (billed, excused/teacherAbs/trials are not directly billed as normal sessions, or excused is resolved on makeup completion)
    const sessions = await Session.find({
      student: { $in: studentIds },
      date: { $gte: startOfMonth, $lte: endOfMonth },
      status: { $in: ['Present', 'Unexcused'] },
      isBilled: false
    });

    if (sessions.length === 0) {
      return res.status(400).json({ message: 'No unbilled sessions found for this parent in the specified month' });
    }

    // Process pricing and group by student
    const items = [];
    let subTotal = 0;

    for (const student of students) {
      const studentSessions = sessions.filter(s => s.student.toString() === student._id.toString());
      if (studentSessions.length === 0) continue;

      // Group by subject to get correct rates
      const subjects = [...new Set(studentSessions.map(s => s.subject))];
      let studentTotalHours = 0;
      let studentTotalAmount = 0;

      for (const subject of subjects) {
        const subjectSessions = studentSessions.filter(s => s.subject === subject);
        const totalHours = subjectSessions.reduce((sum, s) => sum + s.durationHours, 0);

        // Get pricing for this student & subject (use teacher rate info)
        const pricing = await Pricing.findOne({
          student: student._id,
          subject
        });

        const rate = pricing ? pricing.hourlyRate : 15; // default rate
        const total = totalHours * rate;

        studentTotalHours += totalHours;
        studentTotalAmount += total;
      }

      if (studentTotalHours > 0) {
        items.push({
          student: student._id,
          studentName: student.name,
          hours: studentTotalHours,
          rate: studentTotalAmount / studentTotalHours, // Average rate
          total: studentTotalAmount
        });
        subTotal += studentTotalAmount;
      }
    }

    if (items.length === 0) {
      return res.status(400).json({ message: 'Error calculating billing items' });
    }

    // PayPal fees: e.g., 4.4% + $0.30 (we can use 5% as a clean simplified fee)
    const paypalFee = applyPaypalFee ? parseFloat((subTotal * 0.05).toFixed(2)) : 0;
    const totalAmount = subTotal + paypalFee;

    // Generate serial number
    const count = await Invoice.countDocuments();
    const invoiceNumber = `INV-${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}-${(count + 1).toString().padStart(3, '0')}`;

    const invoice = await Invoice.create({
      invoiceNumber,
      parent: parentId,
      month: startOfMonth,
      items,
      subTotal,
      paypalFee,
      totalAmount,
      currency: 'USD'
    });

    // Mark sessions as billed
    const sessionIds = sessions.map(s => s._id);
    await Session.updateMany({ _id: { $in: sessionIds } }, { isBilled: true });

    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get invoices
// @route   GET /api/invoices
// @access  Private/Admin/Parent
const getInvoices = async (req, res) => {
  try {
    let filter = {};

    if (req.user.role === 'Parent') {
      filter.parent = req.user.id;
    } else if (req.user.role !== 'Admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const invoices = await Invoice.find(filter)
      .populate('parent', 'name email')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: invoices.length, data: invoices });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Mark invoice as paid
// @route   PUT /api/invoices/:id/pay
// @access  Private/Admin/Parent
const payInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id).populate('parent');
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // Parent can only pay their own invoices
    if (req.user.role === 'Parent' && invoice.parent._id.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied. You can only pay your own invoices.' });
    }

    invoice.paymentStatus = 'Paid';
    invoice.paidAt = Date.now();
    await invoice.save();

    res.json({ success: true, data: invoice });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Approve/pay all unpaid invoices for a given month
// @route   PUT /api/invoices/approve-all
// @access  Private/Admin
const approveAllInvoices = async (req, res) => {
  const { monthStr } = req.body;
  try {
    const date = new Date(monthStr);
    const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

    const result = await Invoice.updateMany(
      { month: { $gte: startOfMonth, $lte: endOfMonth }, paymentStatus: 'Unpaid' },
      { paymentStatus: 'Paid', paidAt: new Date() }
    );

    res.json({
      success: true,
      message: `Approved ${result.modifiedCount} invoice(s) for ${monthStr}.`
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { generateInvoice, getInvoices, payInvoice, approveAllInvoices };
