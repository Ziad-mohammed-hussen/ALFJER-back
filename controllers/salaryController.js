const Salary = require('../models/Salary');
const Session = require('../models/Session');
const Pricing = require('../models/Pricing');
const User = require('../models/User');

// @desc    Generate teacher monthly salary payout sheet
// @route   POST /api/salaries/generate
// @access  Private/Admin
const generateSalary = async (req, res) => {
  const { teacherId, monthStr, exchangeRate } = req.body;

  try {
    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== 'Teacher') {
      return res.status(400).json({ message: 'Invalid teacher selected' });
    }

    const date = new Date(monthStr); // Format: "YYYY-MM"
    const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

    // Paid sessions for teacher: Present, Unexcused, Trial (تنزل لمعلم فقط), TeacherMakeup, StudentMakeup (تعويضات الشهر الماضي)
    const sessions = await Session.find({
      teacher: teacherId,
      date: { $gte: startOfMonth, $lte: endOfMonth },
      status: { $in: ['Present', 'Unexcused', 'Trial', 'TeacherMakeup', 'StudentMakeup'] },
      isPaidToTeacher: false
    });

    if (sessions.length === 0) {
      return res.status(400).json({ message: 'لا توجد حصص غير مدفوعة للمعلم في هذا الشهر.' });
    }

    let baseSalaryUsd = 0;
    let baseSalaryEgp = 0;
    let totalHours = 0;

    for (const session of sessions) {
      // Find teacher rate in pricing
      const pricing = await Pricing.findOne({
        student: session.student,
        teacher: teacherId,
        subject: session.subject
      });

      const rate = pricing && pricing.teacherRate !== undefined && pricing.teacherRate !== null ? Number(pricing.teacherRate) : 0;
      const currency = pricing ? (pricing.teacherCurrency || 'EGP') : 'EGP';

      const total = ((session.durationMinutes || 0) / 60) * rate;
      totalHours += ((session.durationMinutes || 0) / 60);

      if (currency === 'USD' || currency === 'EUR' || currency === 'GBP') {
        baseSalaryUsd += total;
      } else {
        baseSalaryEgp += total;
      }
    }

    // Convert USD/EUR/GBP to EGP
    const rateUsed = exchangeRate || 50.0;
    const finalPayoutEgp = baseSalaryEgp + (baseSalaryUsd * rateUsed);

    // Generate serial number
    const count = await Salary.countDocuments();
    const salaryNumber = `SAL-${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}-${(count + 1).toString().padStart(3, '0')}`;

    const sessionIds = sessions.map(s => s._id);

    const salary = await Salary.create({
      salaryNumber,
      teacher: teacherId,
      month: startOfMonth,
      sessions: sessionIds,
      hoursTaught: totalHours,
      baseSalaryUsd,
      baseSalaryEgp,
      exchangeRateUsed: rateUsed,
      finalPayoutEgp,
      payoutStatus: 'Unpaid'
    });

    res.status(201).json({ success: true, data: salary });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get salaries
// @route   GET /api/salaries
// @access  Private/Admin/Teacher
const getSalaries = async (req, res) => {
  try {
    let filter = {};

    if (req.user.role === 'Teacher') {
      filter.teacher = req.user.id;
    } else if (req.user.role !== 'Admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const salaries = await Salary.find(filter)
      .populate('teacher', 'name email')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: salaries.length, data: salaries });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Mark salary as paid (صرف الراتب وخصم ساعاته ومستحقاته من عداد المعلم)
// @route   PUT /api/salaries/:id/pay
// @access  Private/Admin
const paySalary = async (req, res) => {
  try {
    const salary = await Salary.findById(req.params.id);
    if (!salary) {
      return res.status(404).json({ message: 'مسير الراتب غير موجود' });
    }

    salary.payoutStatus = 'Paid';
    salary.paidAt = Date.now();
    await salary.save();

    // Mark sessions as paid to teacher so they are deducted from the teacher's pending counter
    if (salary.sessions && salary.sessions.length > 0) {
      await Session.updateMany({ _id: { $in: salary.sessions } }, { isPaidToTeacher: true });
    } else {
      // Fallback for older salary records
      const date = new Date(salary.month);
      const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
      await Session.updateMany(
        {
          teacher: salary.teacher,
          date: { $gte: startOfMonth, $lte: endOfMonth },
          status: { $in: ['Present', 'Unexcused', 'Trial', 'TeacherMakeup', 'StudentMakeup'] },
          isPaidToTeacher: false
        },
        { isPaidToTeacher: true }
      );
    }

    res.json({ success: true, message: 'تم صرف الراتب وخصمه من مستحقات المعلم المعلقة بنجاح', data: salary });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get real-time dynamic salary & hours estimate for current month
// @route   GET /api/salaries/estimate
// @access  Private/Admin/Teacher
const getSalaryEstimate = async (req, res) => {
  try {
    const monthStr = req.query.monthStr || new Date().toISOString().substring(0, 7);
    const exchangeRate = parseFloat(req.query.exchangeRate) || 50.0;

    let teacherId = req.query.teacherId;
    if (req.user.role === 'Teacher') {
      teacherId = req.user.id;
    }

    const date = new Date(monthStr + '-01');
    const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

    const filter = {
      date: { $gte: startOfMonth, $lte: endOfMonth },
      status: { $in: ['Present', 'Unexcused', 'Trial', 'TeacherMakeup', 'StudentMakeup'] },
      isPaidToTeacher: false
    };

    if (teacherId) {
      filter.teacher = teacherId;
    }

    const sessions = await Session.find(filter)
      .populate('teacher', 'name email defaultHourlyRate')
      .populate('student', 'name');

    const teacherStats = {};

    for (const session of sessions) {
      const tId = session.teacher?._id?.toString() || session.teacher?.toString();
      if (!tId) continue;

      if (!teacherStats[tId]) {
        teacherStats[tId] = {
          teacherId: tId,
          teacherName: session.teacher?.name || 'معلم',
          totalMinutes: 0,
          baseSalaryUsd: 0,
          baseSalaryEgp: 0,
          sessionCount: 0,
          studentMap: {}
        };
      }

      const mins = session.durationMinutes || 60;
      teacherStats[tId].totalMinutes += mins;
      teacherStats[tId].sessionCount += 1;

      const pricing = await Pricing.findOne({
        student: session.student?._id || session.student,
        teacher: tId,
        subject: session.subject
      });

      const hasPricing = !!pricing && pricing.teacherRate !== undefined && pricing.teacherRate !== null;
      const rate = hasPricing
        ? Number(pricing.teacherRate)
        : (session.teacher?.defaultHourlyRate ? Number(session.teacher.defaultHourlyRate) : 0);
      const currency = pricing ? (pricing.teacherCurrency || 'EGP') : 'EGP';
      const hours = mins / 60;
      const totalPay = hours * rate;

      if (currency === 'USD' || currency === 'EUR' || currency === 'GBP') {
        teacherStats[tId].baseSalaryUsd += totalPay;
      } else {
        teacherStats[tId].baseSalaryEgp += totalPay;
      }

      // Group student breakdown
      const studentId = session.student?._id?.toString() || session.student?.toString() || 'unknown';
      const studentName = session.student?.name || 'طالب';
      const key = `${studentId}_${session.subject}`;

      if (!teacherStats[tId].studentMap[key]) {
        teacherStats[tId].studentMap[key] = {
          studentId,
          studentName,
          subject: session.subject,
          sessionCount: 0,
          totalMinutes: 0,
          rate,
          currency,
          hasPricing,
          totalPay: 0,
          totalPayEgp: 0
        };
      }

      teacherStats[tId].studentMap[key].sessionCount += 1;
      teacherStats[tId].studentMap[key].totalMinutes += mins;
      teacherStats[tId].studentMap[key].totalPay += totalPay;

      const payEgp = (currency === 'USD' || currency === 'EUR' || currency === 'GBP') ? (totalPay * exchangeRate) : totalPay;
      teacherStats[tId].studentMap[key].totalPayEgp += payEgp;
    }

    const results = Object.values(teacherStats).map(t => {
      const hoursTaught = parseFloat((t.totalMinutes / 60).toFixed(2));
      const estimatedPayoutEgp = parseFloat((t.baseSalaryEgp + (t.baseSalaryUsd * exchangeRate)).toFixed(2));

      const studentBreakdown = Object.values(t.studentMap).map(sb => ({
        studentId: sb.studentId,
        studentName: sb.studentName,
        subject: sb.subject,
        sessionCount: sb.sessionCount,
        totalMinutes: sb.totalMinutes,
        hoursTaught: parseFloat((sb.totalMinutes / 60).toFixed(2)),
        rate: sb.rate,
        currency: sb.currency,
        hasPricing: sb.hasPricing,
        totalPay: parseFloat(sb.totalPay.toFixed(2)),
        totalPayEgp: parseFloat(sb.totalPayEgp.toFixed(2))
      }));

      return {
        teacherId: t.teacherId,
        teacherName: t.teacherName,
        totalMinutes: t.totalMinutes,
        hoursTaught,
        sessionCount: t.sessionCount,
        baseSalaryUsd: parseFloat(t.baseSalaryUsd.toFixed(2)),
        baseSalaryEgp: parseFloat(t.baseSalaryEgp.toFixed(2)),
        estimatedPayoutEgp,
        studentBreakdown
      };
    });

    if (teacherId) {
      const single = results.find(r => r.teacherId === teacherId.toString()) || {
        teacherId,
        totalMinutes: 0,
        hoursTaught: 0,
        sessionCount: 0,
        baseSalaryUsd: 0,
        baseSalaryEgp: 0,
        estimatedPayoutEgp: 0,
        studentBreakdown: []
      };

      // Check if any official generated Salary sheets exist for this teacher & month
      const issuedSalaries = await Salary.find({
        teacher: teacherId,
        month: startOfMonth
      });

      single.issuedSalaries = issuedSalaries;
      single.isIssued = issuedSalaries.length > 0;
      single.hasUnpaidSalarySheet = issuedSalaries.some(s => s.payoutStatus === 'Unpaid');
      single.hasPaidSalarySheet = issuedSalaries.some(s => s.payoutStatus === 'Paid');

      return res.json({ success: true, monthStr, data: single });
    }

    res.json({ success: true, monthStr, count: results.length, data: results });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { generateSalary, getSalaries, paySalary, getSalaryEstimate };
