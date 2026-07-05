const MonthlyReport = require('../models/MonthlyReport');
const Student = require('../models/Student');
const User = require('../models/User');
const LeadSource = require('../models/LeadSource');

// @desc    Create or update monthly progress report for a student
// @route   POST /api/reports
// @access  Private/Teacher
const saveReport = async (req, res) => {
  const {
    studentId,
    monthStr,
    initialTrialSummary,
    startingLevelRating,
    currentProgressRating,
    textEvaluation,
    attendancePercentage
  } = req.body;
  
  const teacherId = req.user.id;

  try {
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const monthDate = new Date(monthStr); // Format: "YYYY-MM"
    const reportMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);

    const report = await MonthlyReport.findOneAndUpdate(
      { student: studentId, teacher: teacherId, month: reportMonth },
      {
        initialTrialSummary,
        startingLevelRating,
        currentProgressRating,
        textEvaluation,
        attendancePercentage
      },
      { new: true, upsert: true }
    );

    res.status(200).json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get monthly reports (filtered by role)
// @route   GET /api/reports
// @access  Private
const getReports = async (req, res) => {
  try {
    let filter = {};

    if (req.user.role === 'Parent') {
      const students = await Student.find({ parent: req.user.id });
      const studentIds = students.map(s => s._id);
      filter.student = { $in: studentIds };
    } else if (req.user.role === 'Teacher') {
      filter.teacher = req.user.id;
    } else if (req.user.role === 'Supervisor') {
      const supervisedTeachers = await User.find({ supervisor: req.user.id, role: 'Teacher' });
      const teacherIds = supervisedTeachers.map(t => t._id);
      filter.teacher = { $in: teacherIds };
    }

    const reports = await MonthlyReport.find(filter)
      .populate('student', 'name')
      .populate('teacher', 'name')
      .sort({ month: -1 });

    res.json({ success: true, count: reports.length, data: reports });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create/Update lead source (Admin only)
// @route   POST /api/reports/leads
// @access  Private/Admin
const saveLeadSource = async (req, res) => {
  const { studentId, sourceType, referrerParentId, notes } = req.body;

  try {
    const lead = await LeadSource.findOneAndUpdate(
      { student: studentId },
      {
        sourceType,
        referrerParent: referrerParentId || null,
        notes
      },
      { new: true, upsert: true }
    );

    res.status(200).json({ success: true, data: lead });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all lead sources (Admin only)
// @route   GET /api/reports/leads
// @access  Private/Admin
const getLeadSources = async (req, res) => {
  try {
    const leads = await LeadSource.find()
      .populate('student', 'name')
      .populate('referrerParent', 'name email');

    res.json({ success: true, data: leads });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { saveReport, getReports, saveLeadSource, getLeadSources };
