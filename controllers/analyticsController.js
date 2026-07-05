const Session = require('../models/Session');
const User = require('../models/User');
const StudentPause = require('../models/StudentPause');
const MonthlyReport = require('../models/MonthlyReport');

// @desc    Get teacher performance analytics
// @route   GET /api/analytics/teachers
// @access  Private/Admin/GlobalSup
const getTeacherPerformance = async (req, res) => {
  try {
    const teachers = await User.find({ role: 'Teacher' }).select('name email phone supervisor');

    const stats = await Promise.all(teachers.map(async (teacher) => {
      const sessions = await Session.find({ teacher: teacher._id });
      const teacherAbsences = sessions.filter(s => s.status === 'TeacherAbs').length;
      const studentAbsences = sessions.filter(s => ['Excused', 'Unexcused'].includes(s.status)).length;
      const pendingMakeups = sessions.filter(s => s.makeupStatus === 'Pending').length;
      const totalHours = sessions
        .filter(s => s.status === 'Present')
        .reduce((sum, s) => sum + (s.durationHours || 0), 0);

      const reports = await MonthlyReport.find({ teacher: teacher._id });
      const avgProgress = reports.length > 0
        ? (reports.reduce((sum, r) => sum + (r.currentProgressRating || 0), 0) / reports.length).toFixed(1)
        : 0;

      return {
        teacher: { _id: teacher._id, name: teacher.name, email: teacher.email },
        teacherAbsences,
        studentAbsences,
        pendingMakeups,
        totalHours: parseFloat(totalHours.toFixed(1)),
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
