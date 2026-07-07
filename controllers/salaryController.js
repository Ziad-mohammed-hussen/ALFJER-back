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

    // Paid sessions: Present, Unexcused, Trial
    const sessions = await Session.find({
      teacher: teacherId,
      date: { $gte: startOfMonth, $lte: endOfMonth },
      status: { $in: ['Present', 'Unexcused', 'Trial'] },
      isPaidToTeacher: false
    });

    if (sessions.length === 0) {
      return res.status(400).json({ message: 'No unpaid teaching sessions found for this teacher in the specified month' });
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

      const rate = pricing ? pricing.teacherRate : 5; // Default rate
      const currency = pricing ? pricing.teacherCurrency : 'USD';

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

    const salary = await Salary.create({
      salaryNumber,
      teacher: teacherId,
      month: startOfMonth,
      hoursTaught: totalHours,
      baseSalaryUsd,
      baseSalaryEgp,
      exchangeRateUsed: rateUsed,
      finalPayoutEgp
    });

    // Mark sessions as paid to teacher
    const sessionIds = sessions.map(s => s._id);
    await Session.updateMany({ _id: { $in: sessionIds } }, { isPaidToTeacher: true });

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

// @desc    Mark salary as paid
// @route   PUT /api/salaries/:id/pay
// @access  Private/Admin
const paySalary = async (req, res) => {
  try {
    const salary = await Salary.findById(req.params.id);
    if (!salary) {
      return res.status(404).json({ message: 'Salary sheet not found' });
    }

    salary.payoutStatus = 'Paid';
    salary.paidAt = Date.now();
    await salary.save();

    res.json({ success: true, data: salary });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { generateSalary, getSalaries, paySalary };
