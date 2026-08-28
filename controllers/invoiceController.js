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

    // 1. Normal billable sessions in Month M (Present, Unexcused) - Excludes Trial & Excused!
    const billableSessions = await Session.find({
      student: { $in: studentIds },
      date: { $gte: startOfMonth, $lte: endOfMonth },
      status: { $in: ['Present', 'Unexcused'] },
      isBilled: false
    });

    // 2. Completed makeup sessions delivered in Month M (TeacherMakeup, StudentMakeup) - "تعويض حصة عن شهر سابق"
    const makeupSessions = await Session.find({
      student: { $in: studentIds },
      date: { $gte: startOfMonth, $lte: endOfMonth },
      status: { $in: ['TeacherMakeup', 'StudentMakeup'] },
      isBilled: false
    });

    // 3. Uncompensated TeacherAbs & Excused sessions in Month M (Deducted from parent invoice as credit debt)
    const uncompensatedDeductions = await Session.find({
      student: { $in: studentIds },
      date: { $gte: startOfMonth, $lte: endOfMonth },
      status: { $in: ['TeacherAbs', 'Excused'] },
      makeupStatus: { $ne: 'Completed' },
      isBilled: false
    });

    const allCandidateSessions = [...billableSessions, ...makeupSessions, ...uncompensatedDeductions];
    if (allCandidateSessions.length === 0) {
      return res.status(400).json({ message: 'لا توجد حصص مستحقة أو خصومات غير مفوترة لهذا الشهر لولي الأمر.' });
    }

    const items = [];
    let subTotal = 0;
    let invoiceCurrency = 'USD';

    for (const student of students) {
      const studentNormals = billableSessions.filter(s => s.student.toString() === student._id.toString());
      const studentMakeups = makeupSessions.filter(s => s.student.toString() === student._id.toString());
      const studentTeacherAbs = uncompensatedDeductions.filter(s => s.student.toString() === student._id.toString() && s.status === 'TeacherAbs');
      const studentExcusedAbs = uncompensatedDeductions.filter(s => s.student.toString() === student._id.toString() && s.status === 'Excused');

      if (studentNormals.length === 0 && studentMakeups.length === 0 && studentTeacherAbs.length === 0 && studentExcusedAbs.length === 0) continue;

      const pricing = await Pricing.findOne({ student: student._id });
      let rate = 15;
      if (pricing) {
        rate = pricing.hourlyRate;
        if (pricing.currency) invoiceCurrency = pricing.currency;
      } else if (parent.defaultHourlyRate) {
        rate = parent.defaultHourlyRate;
        if (parent.defaultCurrency) invoiceCurrency = parent.defaultCurrency;
      }

      // 1. Normal sessions item line (حضور الطالب أو غياب بدون عذر)
      if (studentNormals.length > 0) {
        const totalMins = studentNormals.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
        const hours = parseFloat((totalMins / 60).toFixed(2));
        const total = parseFloat((hours * rate).toFixed(2));

        items.push({
          student: student._id,
          studentName: student.name,
          description: `حضور حصص شهري وحالات عدم العذر (${studentNormals.length} حصص | إجمالي ${totalMins} دقيقة / ${hours} ساعة)`,
          minutes: totalMins,
          hours,
          rate,
          total
        });
        subTotal += total;
      }

      // 2. Completed makeup sessions item line ("تعويض حصة من الشهر الماضي")
      if (studentMakeups.length > 0) {
        const totalMins = studentMakeups.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
        const hours = parseFloat((totalMins / 60).toFixed(2));
        const total = parseFloat((hours * rate).toFixed(2));

        items.push({
          student: student._id,
          studentName: student.name,
          description: `تعويض حصة عن شهر سابق (${studentMakeups.length} حصص تعويضية | إجمالي ${totalMins} دقيقة / ${hours} ساعة)`,
          minutes: totalMins,
          hours,
          rate,
          total
        });
        subTotal += total;
      }

      // 3. Uncompensated Teacher Absence deduction item line (خصم دَيْن غياب معلم غير معوض بالسالب)
      if (studentTeacherAbs.length > 0) {
        const totalMins = studentTeacherAbs.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
        const hours = parseFloat((totalMins / 60).toFixed(2));
        const totalDeduction = -parseFloat((hours * rate).toFixed(2));

        items.push({
          student: student._id,
          studentName: student.name,
          description: `خصم دَيْن غياب معلم غير معوض عن هذا الشهر (${studentTeacherAbs.length} حصص ملغاة | ${totalMins} دقيقة)`,
          minutes: totalMins,
          hours: -hours,
          rate,
          total: totalDeduction
        });
        subTotal += totalDeduction;
      }

      // 4. Uncompensated Excused Absence deduction item line (خصم دَيْن غياب طالب بعذر غير معوض بالسالب)
      if (studentExcusedAbs.length > 0) {
        const totalMins = studentExcusedAbs.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
        const hours = parseFloat((totalMins / 60).toFixed(2));
        const totalDeduction = -parseFloat((hours * rate).toFixed(2));

        items.push({
          student: student._id,
          studentName: student.name,
          description: `خصم دَيْن غياب طالب بعذر غير معوض عن هذا الشهر (${studentExcusedAbs.length} حصص ملغاة | ${totalMins} دقيقة)`,
          minutes: totalMins,
          hours: -hours,
          rate,
          total: totalDeduction
        });
        subTotal += totalDeduction;
      }
    }

    if (items.length === 0) {
      return res.status(400).json({ message: 'خطأ أثناء حساب بنود الفاتورة' });
    }

    // Protect subtotal from negative
    if (subTotal < 0) subTotal = 0;

    const paypalFee = applyPaypalFee ? parseFloat((subTotal * 0.05).toFixed(2)) : 0;
    const totalAmount = parseFloat((subTotal + paypalFee).toFixed(2));

    const count = await Invoice.countDocuments();
    const invoiceNumber = `INV-${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}-${(count + 1).toString().padStart(3, '0')}`;

    const invoice = await Invoice.create({
      invoiceNumber,
      parent: parentId,
      month: startOfMonth,
      items,
      subTotal: parseFloat(subTotal.toFixed(2)),
      paypalFee,
      totalAmount,
      currency: invoiceCurrency
    });

    // Mark candidate sessions as billed
    const sessionIds = allCandidateSessions.map(s => s._id);
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

// @desc    Admin update invoice payment status & method
// @route   PUT /api/invoices/:id/admin-update
// @access  Private/Admin
const updateInvoiceAdmin = async (req, res) => {
  const { paymentStatus, paymentMethod } = req.body;
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    if (paymentStatus) {
      invoice.paymentStatus = paymentStatus;
      if (paymentStatus === 'Paid') {
        invoice.paidAt = invoice.paidAt || Date.now();
      } else if (paymentStatus === 'Unpaid') {
        invoice.paidAt = undefined;
      }
    }
    if (paymentMethod) {
      invoice.paymentMethod = paymentMethod;
    }

    await invoice.save();
    res.json({ success: true, data: invoice });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { generateInvoice, getInvoices, payInvoice, approveAllInvoices, updateInvoiceAdmin };
