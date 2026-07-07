const Session = require('../models/Session');
const User = require('../models/User');
const StudentPause = require('../models/StudentPause');
const MonthlyReport = require('../models/MonthlyReport');

// @desc    Get teacher performance analytics (with optional month filter)
// @route   GET /api/analytics/teachers?monthStr=YYYY-MM
// @access  Private/Admin/GlobalSup
const getTeacherPerformance = async (req, res) => {
  try {
    const { monthStr } = req.query;
    let dateFilter = {};

    if (monthStr) {
      const d = new Date(monthStr);
      const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      dateFilter = { date: { $gte: startOfMonth, $lte: endOfMonth } };
    }

    let teacherFilter = { role: 'Teacher' };
    if (req.user.role === 'Supervisor') {
      teacherFilter.supervisor = req.user.id;
    }

    const teachers = await User.find(teacherFilter).select('name email phone supervisor');

    const stats = await Promise.all(teachers.map(async (teacher) => {
      const sessions = await Session.find({ teacher: teacher._id, ...dateFilter });

      const teacherAbsences = sessions.filter(s => s.status === 'TeacherAbs').length;
      const studentAbsences = sessions.filter(s => ['Excused', 'Unexcused'].includes(s.status)).length;
      const pendingMakeups = sessions.filter(s => s.makeupStatus === 'Pending').length;
      const compensatedMakeups = sessions.filter(s => s.makeupStatus === 'Completed').length;
      const cancelledMakeups = sessions.filter(s => s.makeupStatus === 'Cancelled').length;

      const presentHours = sessions
        .filter(s => s.status === 'Present')
        .reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / 60;

      // Hour deficit: absences requiring makeup that are still Pending or Cancelled
      const deficitHours = sessions
        .filter(s => ['TeacherAbs', 'Excused'].includes(s.status) && s.makeupStatus !== 'Completed')
        .reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / 60;

      const compensatedHours = sessions
        .filter(s => s.makeupStatus === 'Completed')
        .reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / 60;

      let reportFilter = { teacher: teacher._id };
      if (monthStr) {
        const d = new Date(monthStr);
        const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
        const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
        reportFilter.month = { $gte: startOfMonth, $lte: endOfMonth };
      }

      const reports = await MonthlyReport.find(reportFilter);
      const avgProgress = reports.length > 0
        ? (reports.reduce((sum, r) => sum + (r.currentProgressRating || 0), 0) / reports.length).toFixed(1)
        : 0;

      return {
        teacher: { _id: teacher._id, name: teacher.name, email: teacher.email },
        teacherAbsences,
        studentAbsences,
        pendingMakeups,
        compensatedMakeups,
        cancelledMakeups,
        totalHours: parseFloat(presentHours.toFixed(1)),
        compensatedHours: parseFloat(compensatedHours.toFixed(1)),
        deficitHours: parseFloat(deficitHours.toFixed(1)),
        avgStudentProgress: parseFloat(avgProgress)
      };
    }));

    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get seasonal analytics (monthly session counts)
// @route   GET /api/analytics/seasonal
// @access  Private/Admin
const getSeasonalAnalytics = async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const monthlyData = [];

    for (let m = 0; m < 12; m++) {
      const start = new Date(year, m, 1);
      const end = new Date(year, m + 1, 0, 23, 59, 59);

      const [sessions, pauses] = await Promise.all([
        Session.countDocuments({ date: { $gte: start, $lte: end }, status: 'Present' }),
        StudentPause.countDocuments({ createdAt: { $gte: start, $lte: end } })
      ]);

      monthlyData.push({ month: m + 1, sessions, newPauses: pauses });
    }

    res.json({ success: true, year, data: monthlyData });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getTeacherPerformance, getSeasonalAnalytics };
