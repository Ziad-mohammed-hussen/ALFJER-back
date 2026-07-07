const MonthlyReport = require('../models/MonthlyReport');
const Student = require('../models/Student');
const User = require('../models/User');
const LeadSource = require('../models/LeadSource');
const Session = require('../models/Session');

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

// @desc    Get full monthly timeline for a specific student (all reports sorted oldest -> newest)
// @route   GET /api/reports/student/:studentId/timeline
// @access  Private (Teacher/Supervisor/GlobalSup/Admin/Parent)
const getStudentTimeline = async (req, res) => {
  const { studentId } = req.params;

  try {
    // Role-based access check
    if (req.user.role === 'Parent') {
      const student = await Student.findById(studentId);
      if (!student) return res.status(404).json({ message: 'Student not found' });
      const isParent = student.parent && student.parent.toString() === req.user.id;
      if (!isParent) return res.status(403).json({ message: 'Access denied' });
    } else if (req.user.role === 'Teacher') {
      // Teacher can only see timelines of their own students
      const hasStudent = await Session.findOne({ teacher: req.user.id, student: studentId });
      if (!hasStudent) return res.status(403).json({ message: 'Access denied' });
    }

    // Fetch all monthly reports for this student
    const reports = await MonthlyReport.find({ student: studentId })
      .populate('teacher', 'name')
      .populate('student', 'name')
      .sort({ month: 1 }); // oldest first for timeline

    // For each month, also fetch session summary (absences, makeups, hours)
    const enriched = await Promise.all(reports.map(async (report) => {
      const monthDate = new Date(report.month);
      const startOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
      const endOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59);

      const sessions = await Session.find({
        student: studentId,
        teacher: report.teacher._id,
        date: { $gte: startOfMonth, $lte: endOfMonth }
      });

      const presentSessions = sessions.filter(s => s.status === 'Present' || s.status === 'Trial');
      const teacherAbsSessions = sessions.filter(s => s.status === 'TeacherAbs');
      const studentAbsSessions = sessions.filter(s => ['Excused', 'Unexcused'].includes(s.status));
      const compensatedSessions = sessions.filter(s => s.makeupStatus === 'Completed');
      const pendingMakeups = sessions.filter(s => s.makeupStatus === 'Pending');

      const totalHours = sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / 60;
      const presentHours = presentSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / 60;
      const absHours = [...teacherAbsSessions, ...studentAbsSessions].reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / 60;
      const compensatedHours = compensatedSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / 60;
      const pendingHours = pendingMakeups.reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / 60;

      return {
        ...report.toObject(),
        sessionStats: {
          totalSessions: sessions.length,
          presentSessions: presentSessions.length,
          teacherAbsences: teacherAbsSessions.length,
          studentAbsences: studentAbsSessions.length,
          compensated: compensatedSessions.length,
          pendingMakeups: pendingMakeups.length,
          totalHours: parseFloat(totalHours.toFixed(1)),
          presentHours: parseFloat(presentHours.toFixed(1)),
          absHours: parseFloat(absHours.toFixed(1)),
          compensatedHours: parseFloat(compensatedHours.toFixed(1)),
          pendingHours: parseFloat(pendingHours.toFixed(1))
        }
      };
    }));

    res.json({ success: true, count: enriched.length, data: enriched });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get monthly performance stats for a teacher (self or admin/supervisor view)
// @route   GET /api/reports/teacher-performance?monthStr=YYYY-MM&teacherId=...
// @access  Private (Teacher sees self; Supervisor/Admin/GlobalSup can pass teacherId)
const getTeacherMonthlyPerformance = async (req, res) => {
  try {
    let targetTeacherId;

    if (req.user.role === 'Teacher') {
      targetTeacherId = req.user.id;
    } else if (['Admin', 'GlobalSup', 'Supervisor'].includes(req.user.role)) {
      targetTeacherId = req.query.teacherId;
      if (!targetTeacherId) {
        return res.status(400).json({ message: 'teacherId is required' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { monthStr } = req.query;
    let dateFilter = {};

    if (monthStr) {
      const d = new Date(monthStr);
      const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      dateFilter = { date: { $gte: startOfMonth, $lte: endOfMonth } };
    }

    const sessions = await Session.find({
      teacher: targetTeacherId,
      ...dateFilter
    }).populate('student', 'name');

    const teacher = await User.findById(targetTeacherId).select('name email');

    // Session breakdown
    const teacherAbsSessions = sessions.filter(s => s.status === 'TeacherAbs');
    const studentExcusedSessions = sessions.filter(s => s.status === 'Excused');
    const studentUnexcusedSessions = sessions.filter(s => s.status === 'Unexcused');
    const presentSessions = sessions.filter(s => s.status === 'Present');
    const trialSessions = sessions.filter(s => s.status === 'Trial');
    const compensatedSessions = sessions.filter(s => s.makeupStatus === 'Completed');
    const pendingMakeups = sessions.filter(s => s.makeupStatus === 'Pending');
    const cancelledMakeups = sessions.filter(s => s.makeupStatus === 'Cancelled');

    // Hour calculations
    const totalScheduledHours = sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / 60;
    const presentHours = presentSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / 60;
    const teacherAbsHours = teacherAbsSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / 60;
    const studentAbsHours = [...studentExcusedSessions, ...studentUnexcusedSessions].reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / 60;
    const compensatedHours = compensatedSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / 60;
    const pendingHours = pendingMakeups.reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / 60;
    // Hour deficit = absences that were NOT compensated (Pending or Cancelled)
    const uncompensatedAbsHours = [...teacherAbsSessions, ...studentExcusedSessions]
      .filter(s => s.makeupStatus !== 'Completed')
      .reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / 60;

    // Monthly reports for student progress & lesson quality
    let reportFilter = { teacher: targetTeacherId };
    if (monthStr) {
      const d = new Date(monthStr);
      const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      reportFilter.month = { $gte: startOfMonth, $lte: endOfMonth };
    }
    const reports = await MonthlyReport.find(reportFilter).populate('student', 'name');

    const avgProgress = reports.length > 0
      ? parseFloat((reports.reduce((sum, r) => sum + (r.currentProgressRating || 0), 0) / reports.length).toFixed(1))
      : null;
    const avgStartingLevel = reports.length > 0
      ? parseFloat((reports.reduce((sum, r) => sum + (r.startingLevelRating || 0), 0) / reports.length).toFixed(1))
      : null;

    res.json({
      success: true,
      data: {
        teacher,
        monthStr: monthStr || 'all-time',
        sessions: {
          total: sessions.length,
          present: presentSessions.length,
          trial: trialSessions.length,
          teacherAbsences: teacherAbsSessions.length,
          studentExcused: studentExcusedSessions.length,
          studentUnexcused: studentUnexcusedSessions.length,
          compensated: compensatedSessions.length,
          pendingMakeups: pendingMakeups.length,
          cancelledMakeups: cancelledMakeups.length
        },
        hours: {
          totalScheduled: parseFloat(totalScheduledHours.toFixed(1)),
          present: parseFloat(presentHours.toFixed(1)),
          teacherAbsence: parseFloat(teacherAbsHours.toFixed(1)),
          studentAbsence: parseFloat(studentAbsHours.toFixed(1)),
          compensated: parseFloat(compensatedHours.toFixed(1)),
          pending: parseFloat(pendingHours.toFixed(1)),
          deficit: parseFloat(uncompensatedAbsHours.toFixed(1))
        },
        studentProgress: {
          reportsCount: reports.length,
          avgStartingLevel,
          avgCurrentProgress: avgProgress,
          reports: reports.map(r => ({
            studentName: r.student?.name,
            month: r.month,
            startingLevelRating: r.startingLevelRating,
            currentProgressRating: r.currentProgressRating,
            attendancePercentage: r.attendancePercentage,
            textEvaluation: r.textEvaluation
          }))
        }
      }
    });
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

module.exports = {
  saveReport,
  getReports,
  getStudentTimeline,
  getTeacherMonthlyPerformance,
  saveLeadSource,
  getLeadSources
};
