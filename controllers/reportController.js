const MonthlyReport = require('../models/MonthlyReport');
const Student = require('../models/Student');
const User = require('../models/User');
const LeadSource = require('../models/LeadSource');
const Session = require('../models/Session');
const StudentPause = require('../models/StudentPause');
const WeeklySchedule = require('../models/WeeklySchedule');

// Helper to resolve student timezone based on country / state
const resolveStudentTimezone = (country, timezone) => {
  if (country) {
    const c = country.toLowerCase();
    if (c.includes('أريزونا') || c.includes('arizona') || c.includes('phoenix')) return 'America/Phoenix';
    if (c.includes('تكساس') || c.includes('texas') || c.includes('شيكاغو') || c.includes('chicago') || c.includes('إلينوي')) return 'America/Chicago';
    if (c.includes('كاليفورنيا') || c.includes('california') || c.includes('لوس أنجلوس') || c.includes('los angeles') || c.includes('سياتل')) return 'America/Los_Angeles';
    if (c.includes('كولورادو') || c.includes('colorado') || c.includes('دنفر') || c.includes('denver') || c.includes('يوتا')) return 'America/Denver';
    if (c.includes('نيويورك') || c.includes('new york') || c.includes('فلوريدا') || c.includes('florida') || c.includes('جورجيا')) return 'America/New_York';
    if (c.includes('ألاسكا') || c.includes('alaska')) return 'America/Anchorage';
    if (c.includes('هاواي') || c.includes('hawaii')) return 'Pacific/Honolulu';
  }
  return timezone || 'America/New_York';
};

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

// @desc    Calculate monthly hours deficit/surplus for a student
// @route   GET /api/reports/monthly-deficit/:studentId?month=YYYY-MM
// @access  Private (Teacher/Supervisor/Admin/GlobalSup/Parent)
const getMonthlyDeficit = async (req, res) => {
  const { studentId } = req.params;
  const { month } = req.query; // format: "YYYY-MM"

  try {
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Access control: Parent can only view their own children
    if (req.user.role === 'Parent') {
      const isParent = student.parent && student.parent.toString() === req.user.id;
      if (!isParent) return res.status(403).json({ message: 'Access denied' });
    }

    // Determine the target month
    const targetDate = month ? new Date(month) : new Date();
    const year = targetDate.getFullYear();
    const monthIndex = targetDate.getMonth(); // 0-indexed
    const startOfMonth = new Date(year, monthIndex, 1);
    const endOfMonth = new Date(year, monthIndex + 1, 0, 23, 59, 59);
    const monthStr = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

    // Get student's schedule slots (use new system if available, fallback to old)
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let slots = [];

    if (student.scheduleSlots && student.scheduleSlots.length > 0) {
      slots = student.scheduleSlots.map(s => ({
        day: s.day,
        time: s.time,
        durationMinutes: s.durationMinutes || 60
      }));
    } else if (student.sessionDays && student.sessionDays.length > 0) {
      // Fallback to old system
      student.sessionDays.forEach(day => {
        slots.push({
          day,
          time: student.sessionTimeTeacher || '00:00',
          durationMinutes: student.sessionDurationMinutes || 60
        });
      });
    }

    // Count how many times each scheduled weekday occurs in this month
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const slotDetails = slots.map(slot => {
      const targetDayIndex = DAY_NAMES.indexOf(slot.day);
      let occurrences = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, monthIndex, d);
        if (date.getDay() === targetDayIndex) occurrences++;
      }
      return {
        day: slot.day,
        time: slot.time,
        durationMinutes: slot.durationMinutes,
        occurrences,
        targetMinutes: occurrences * slot.durationMinutes
      };
    });

    // Total target minutes for the month
    const totalTargetMinutes = slotDetails.reduce((sum, s) => sum + s.targetMinutes, 0);
    const totalTargetHours = parseFloat((totalTargetMinutes / 60).toFixed(2));
    const totalTargetSessions = slotDetails.reduce((sum, s) => sum + s.occurrences, 0);

    // Get actual sessions in this month
    const sessions = await Session.find({
      student: studentId,
      date: { $gte: startOfMonth, $lte: endOfMonth }
    });

    // Actual attended = Present (including Makeup sessions) + Trial
    const attendedSessions = sessions.filter(s =>
      s.status === 'Present' || s.status === 'Trial'
    );
    const actualMinutes = attendedSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
    const actualHours = parseFloat((actualMinutes / 60).toFixed(2));
    const actualSessions = attendedSessions.length;

    // Breakdown
    const excusedSessions = sessions.filter(s => s.status === 'Excused').length;
    const unexcusedSessions = sessions.filter(s => s.status === 'Unexcused').length;
    const teacherAbsSessions = sessions.filter(s => s.status === 'TeacherAbs').length;
    const pendingMakeupSessions = sessions.filter(s => s.makeupStatus === 'Pending').length;

    const deficitMinutes = actualMinutes - totalTargetMinutes;
    const deficitHours = parseFloat((deficitMinutes / 60).toFixed(2));

    let status = 'on-track';
    if (deficitHours < 0) status = 'deficit';
    else if (deficitHours > 0) status = 'surplus';

    res.json({
      success: true,
      data: {
        month: monthStr,
        student: { _id: student._id, name: student.name, timezone: student.timezone },
        schedule: {
          slots: slotDetails,
          totalTargetSessions,
          totalTargetHours
        },
        actual: {
          totalSessions: sessions.length,
          attendedSessions: actualSessions,
          actualHours,
          excusedSessions,
          unexcusedSessions,
          teacherAbsSessions,
          pendingMakeupSessions
        },
        deficit: {
          hours: deficitHours,
          minutes: deficitMinutes,
          status // 'deficit' | 'surplus' | 'on-track'
        }
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get weekly schedule and hours taught for a teacher
// @route   GET /api/reports/weekly-schedule/:teacherId
// @access  Private
const getTeacherWeeklySchedule = async (req, res) => {
  const { teacherId } = req.params;
  const { date } = req.query;

  try {
    const teacher = await User.findById(teacherId).select('name email phone');
    if (!teacher) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    // Determine week bounds: Saturday to Friday in Cairo time
    const d = date ? new Date(date) : new Date();
    const day = d.getDay(); // 0 is Sunday, 6 is Saturday
    const daysToSubtract = (day + 1) % 7;
    
    const weekStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysToSubtract, 0, 0, 0);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1000);

    // Fetch all active and paused students assigned to this teacher
    const students = await Student.find({
      teachers: teacherId,
      status: { $in: ['Active', 'Paused'] }
    }).select('name timezone country status scheduleSlots');

    // Fetch all active pauses for these students
    const studentIds = students.map(s => s._id);
    const activePauses = await StudentPause.find({
      student: { $in: studentIds },
      isResolved: false
    });

    // Fetch this teacher's weekly schedule slots
    const teacherSchedules = await WeeklySchedule.find({
      teacher: teacherId
    });

    // Fetch all sessions logged for this teacher and these students in this week
    const sessions = await Session.find({
      teacher: teacherId,
      date: { $gte: weekStart, $lte: weekEnd }
    });

    const studentsRows = students.map(student => {
      // Find active pause if any
      const activePause = activePauses.find(p => p.student.toString() === student._id.toString());
      let expectedReturnDate = null;
      if (student.status === 'Paused' && activePause && activePause.type === 'temporary') {
        expectedReturnDate = activePause.expectedReturnAt;
      }

      // Combine student.scheduleSlots (Admin/Supervisor) and teacherSchedules (Teacher)
      const combinedSlots = [];
      const seenSlots = new Set();

      // 1. Add official student slots
      if (student.scheduleSlots && student.scheduleSlots.length > 0) {
        for (const slot of student.scheduleSlots) {
          if (slot.day && slot.time) {
            const key = `${slot.day}-${slot.time}`;
            if (!seenSlots.has(key)) {
              seenSlots.add(key);
              combinedSlots.push({
                day: slot.day,
                time: slot.time,
                duration: slot.durationMinutes || 60
              });
            }
          }
        }
      }

      // 2. Add teacher-specific slots
      const studentSchedules = teacherSchedules.filter(s => s.student.toString() === student._id.toString());
      for (const slot of studentSchedules) {
        let duration = 60;
        let time = slot.timeSlot;
        let cleanTime = time;
        if (time && time.includes('-')) {
          const parts = time.split('-');
          cleanTime = parts[0].trim();
          const start = parts[0].trim();
          const end = parts[1].trim();
          const parseTime = (t) => {
            const [h, m] = t.split(':').map(Number);
            return h * 60 + (m || 0);
          };
          const diff = parseTime(end) - parseTime(start);
          if (diff > 0) duration = diff;
        }

        const key = `${slot.dayOfWeek}-${cleanTime}`;
        if (!seenSlots.has(key)) {
          seenSlots.add(key);
          combinedSlots.push({
            day: slot.dayOfWeek,
            time: cleanTime,
            duration: duration
          });
        }
      }

      // Group slots by day
      const slotsByDay = {
        Saturday: combinedSlots.filter(s => s.day === 'Saturday').map(s => s.time).join(', '),
        Sunday: combinedSlots.filter(s => s.day === 'Sunday').map(s => s.time).join(', '),
        Monday: combinedSlots.filter(s => s.day === 'Monday').map(s => s.time).join(', '),
        Tuesday: combinedSlots.filter(s => s.day === 'Tuesday').map(s => s.time).join(', '),
        Wednesday: combinedSlots.filter(s => s.day === 'Wednesday').map(s => s.time).join(', '),
        Thursday: combinedSlots.filter(s => s.day === 'Thursday').map(s => s.time).join(', '),
        Friday: combinedSlots.filter(s => s.day === 'Friday').map(s => s.time).join(', ')
      };

      const sessionsPerWeek = combinedSlots.length;
      const totalMinutes = combinedSlots.reduce((sum, s) => sum + s.duration, 0);

      const weeklyTargetHours = totalMinutes / 60;
      const monthlyTargetHours = weeklyTargetHours * 4;
      const avgDuration = combinedSlots.length > 0 ? Math.round(totalMinutes / combinedSlots.length) : 60;

      // Find sessions for this student
      const studentSessions = sessions.filter(s => s.student.toString() === student._id.toString());
      
      const attendedSessions = studentSessions.filter(s => s.status === 'Present' || s.status === 'Trial');
      const actualMinutes = attendedSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
      const actualHoursThisWeek = parseFloat((actualMinutes / 60).toFixed(2));

      return {
        _id: student._id,
        name: student.name,
        country: student.country || '—',
        timezone: resolveStudentTimezone(student.country, student.timezone),
        status: student.status,
        expectedReturnDate,
        slots: slotsByDay,
        sessionsPerWeek: sessionsPerWeek,
        lessonDuration: avgDuration,
        weeklyTargetHours: parseFloat(weeklyTargetHours.toFixed(2)),
        monthlyTargetHours: parseFloat(monthlyTargetHours.toFixed(2)),
        actualHoursThisWeek
      };
    });

    // Summary calculations
    const totalWeeklyTargetHours = parseFloat(studentsRows.reduce((sum, r) => sum + r.weeklyTargetHours, 0).toFixed(2));
    const totalMonthlyTargetHours = parseFloat(studentsRows.reduce((sum, r) => sum + r.monthlyTargetHours, 0).toFixed(2));
    const totalActualHoursThisWeek = parseFloat(studentsRows.reduce((sum, r) => sum + r.actualHoursThisWeek, 0).toFixed(2));

    res.json({
      success: true,
      data: {
        teacher,
        weekStart,
        weekEnd,
        students: studentsRows,
        summary: {
          totalWeeklyTargetHours,
          totalMonthlyTargetHours,
          totalActualHoursThisWeek
        }
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get comprehensive Teachers Deficit Matrix (expected vs actual hours, breakdown by student & reasons)
// @route   GET /api/reports/teachers-deficit-matrix?month=YYYY-MM&teacherId=...
// @access  Private (Teacher sees self; Supervisor/GlobalSup/Admin can view assigned or all)
const getTeachersDeficitMatrix = async (req, res) => {
  try {
    const { month, teacherId } = req.query;

    // Determine target month
    const targetDate = month ? new Date(month + '-01') : new Date();
    const year = targetDate.getFullYear();
    const monthIndex = targetDate.getMonth(); // 0-indexed
    const monthStr = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

    const startOfMonth = new Date(year, monthIndex, 1, 0, 0, 0);
    const endOfMonth = new Date(year, monthIndex + 1, 0, 23, 59, 59);
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // 1. Determine teacher scope based on user role
    let teacherFilter = { role: 'Teacher' };
    if (req.user.role === 'Teacher') {
      teacherFilter._id = req.user.id;
    } else if (req.user.role === 'Supervisor') {
      const supervisedTeachers = await User.find({ supervisor: req.user.id, role: 'Teacher' }).select('_id');
      const teacherIds = supervisedTeachers.map(t => t._id);
      if (teacherId) {
        if (!teacherIds.some(id => id.toString() === teacherId)) {
          return res.status(403).json({ message: 'Access denied to this teacher' });
        }
        teacherFilter._id = teacherId;
      } else {
        teacherFilter._id = { $in: teacherIds };
      }
    } else if (teacherId) {
      teacherFilter._id = teacherId;
    }

    const teachers = await User.find(teacherFilter).select('name email phone');

    // 2. Process matrix data per teacher
    const teacherMatrix = await Promise.all(teachers.map(async (teacher) => {
      // Find students assigned to this teacher
      const students = await Student.find({
        teachers: teacher._id
      }).select('name status startDate scheduleSlots sessionDays sessionTimeTeacher sessionDurationMinutes timezone');

      const studentIds = students.map(s => s._id);

      // Fetch active pauses during this month for these students
      const pauses = await StudentPause.find({
        student: { $in: studentIds }
      });

      // Fetch all sessions in this month for this teacher
      const sessions = await Session.find({
        teacher: teacher._id,
        date: { $gte: startOfMonth, $lte: endOfMonth }
      });

      let teacherTotalExpectedMinutes = 0;
      let teacherTotalActualMinutes = 0;

      const studentBreakdowns = students.map(student => {
        // Calculate expected target hours for this student in this month
        let slots = [];
        if (student.scheduleSlots && student.scheduleSlots.length > 0) {
          slots = student.scheduleSlots.map(s => ({
            day: s.day,
            durationMinutes: s.durationMinutes || 60
          }));
        } else if (student.sessionDays && student.sessionDays.length > 0) {
          student.sessionDays.forEach(day => {
            slots.push({
              day,
              durationMinutes: student.sessionDurationMinutes || 60
            });
          });
        }

        let studentTargetMinutes = 0;
        slots.forEach(slot => {
          const targetDayIndex = DAY_NAMES.indexOf(slot.day);
          let occurrences = 0;
          for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(year, monthIndex, d);
            if (date.getDay() === targetDayIndex) occurrences++;
          }
          studentTargetMinutes += (occurrences * slot.durationMinutes);
        });

        // Sessions for this student with this teacher
        const studentSessions = sessions.filter(s => s.student.toString() === student._id.toString());
        
        // Attended sessions: Present, Trial, or Makeup completed
        const attendedSessions = studentSessions.filter(s =>
          s.status === 'Present' || s.status === 'Trial' || s.makeupStatus === 'Completed'
        );
        const studentActualMinutes = attendedSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);

        const studentDeficitMinutes = studentTargetMinutes - studentActualMinutes;
        const studentTargetHours = parseFloat((studentTargetMinutes / 60).toFixed(1));
        const studentActualHours = parseFloat((studentActualMinutes / 60).toFixed(1));
        const studentDeficitHours = parseFloat((studentDeficitMinutes / 60).toFixed(1));

        teacherTotalExpectedMinutes += studentTargetMinutes;
        teacherTotalActualMinutes += studentActualMinutes;

        // Causes breakdown analysis
        const causes = [];

        // Cause 1: Check Student Pauses / Leaves
        const studentPauses = pauses.filter(p => p.student.toString() === student._id.toString());
        const activePause = studentPauses.find(p => {
          const pauseDate = new Date(p.pausedAt);
          const resumeDate = p.actualReturnAt ? new Date(p.actualReturnAt) : (p.expectedReturnAt ? new Date(p.expectedReturnAt) : new Date(2099, 11, 31));
          return pauseDate <= endOfMonth && resumeDate >= startOfMonth;
        });

        if (activePause || student.status === 'Paused') {
          const pauseReason = activePause?.reason || 'إجازة / توقف طالب';
          const pauseType = activePause?.type === 'permanent' ? 'دائم' : 'مؤقت';
          causes.push({
            type: 'student_pause',
            badge: 'إجازة طالب (توقف مؤقت)',
            severity: 'warning',
            details: `إجازة طالب مسجلة: ${pauseReason} (${pauseType})`
          });
        } else if (student.status === 'Inactive') {
          causes.push({
            type: 'student_inactive',
            badge: 'توقف تام',
            severity: 'danger',
            details: 'الطالب غير نشط (توقف عن الدراسة كلياً)'
          });
        }

        // Cause 2: Check Teacher Absences
        const teacherAbsSessions = studentSessions.filter(s => s.status === 'TeacherAbs');
        if (teacherAbsSessions.length > 0) {
          const hours = teacherAbsSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / 60;
          const pendingMakeups = teacherAbsSessions.filter(s => s.makeupStatus !== 'Completed').length;
          causes.push({
            type: 'teacher_absence',
            badge: 'غياب معلم',
            severity: 'info',
            details: `عدد الحصص الملغاة من المعلم: ${teacherAbsSessions.length} (${hours.toFixed(1)} ساعة) | تعويضات معلقة: ${pendingMakeups}`
          });
        }

        // Cause 3: Check Student Excused Absences
        const studentExcusedSessions = studentSessions.filter(s => s.status === 'Excused');
        if (studentExcusedSessions.length > 0) {
          const hours = studentExcusedSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / 60;
          const pendingMakeups = studentExcusedSessions.filter(s => s.makeupStatus !== 'Completed').length;
          causes.push({
            type: 'excused_absence',
            badge: 'إجازة طالب (حصة بعذر)',
            severity: 'warning',
            details: `عدد غيابات/إجازات الطالب بعذر: ${studentExcusedSessions.length} (${hours.toFixed(1)} ساعة) | تعويضات معلقة: ${pendingMakeups}`
          });
        }

        // Cause 4: Check Student Unexcused Absences
        const studentUnexcusedSessions = studentSessions.filter(s => s.status === 'Unexcused');
        if (studentUnexcusedSessions.length > 0) {
          const hours = studentUnexcusedSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / 60;
          causes.push({
            type: 'unexcused_absence',
            badge: 'غياب طالب بدون عذر',
            severity: 'danger',
            details: `عدد غيابات الطالب بدون عذر: ${studentUnexcusedSessions.length} (${hours.toFixed(1)} ساعة)`
          });
        }

        // Cause 5: Check Joined Mid-Month
        if (student.startDate) {
          const startDate = new Date(student.startDate);
          if (startDate > startOfMonth && startDate <= endOfMonth) {
            causes.push({
              type: 'joined_mid_month',
              badge: 'انضمام منتصف الشهر',
              severity: 'info',
              details: `تاريخ بدء الطالب: ${startDate.toISOString().substring(0, 10)}`
            });
          }
        }

        // Cause 6: Check Completed Makeups (الحصص التعويضية المنجزة ومدتها)
        const completedMakeups = studentSessions.filter(s => s.isMakeup === true || s.makeupStatus === 'Completed');
        if (completedMakeups.length > 0) {
          const makeupMinutes = completedMakeups.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
          const makeupHours = parseFloat((makeupMinutes / 60).toFixed(2));
          causes.push({
            type: 'completed_makeup',
            badge: `تم التعويض (${makeupMinutes} دقيقة / ${makeupHours}h)`,
            severity: 'success',
            details: `عدد الحصص التعويضية المنجزة: ${completedMakeups.length} حصة (إجمالي المدة: ${makeupMinutes} دقيقة / ${makeupHours}h)`
          });
        }

        // Cause 7: Check Partial Session Duration Shortages (عجز نقص دقائق الحصة عن المقرر)
        const partialShortageSessions = attendedSessions.filter(s => (s.durationMinutes || 0) < (student.sessionDurationMinutes || 60));
        if (partialShortageSessions.length > 0) {
          const expectedAttendedMins = partialShortageSessions.length * (student.sessionDurationMinutes || 60);
          const actualAttendedMins = partialShortageSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
          const shortageMins = expectedAttendedMins - actualAttendedMins;
          if (shortageMins > 0) {
            causes.push({
              type: 'short_session_duration',
              badge: `نقص مدة حصص (${shortageMins} دقيقة عجز)`,
              severity: 'warning',
              details: `تم تسجيل ${partialShortageSessions.length} حصة بمدة أقل من المقرر (إجمالي النقص: ${shortageMins} دقيقة / ${(shortageMins / 60).toFixed(2)}h)`
            });
          }
        }

        // Default cause if there is deficit but no explicit cause found
        if (studentDeficitHours > 0 && causes.length === 0) {
          causes.push({
            type: 'unscheduled_or_missed',
            badge: 'حصص لم تُسجل / عجز مواعيد',
            severity: 'neutral',
            details: 'لم يتم تسجيل كامل الحصص المخططة في الجدول هذا الشهر'
          });
        }

        return {
          studentId: student._id,
          studentName: student.name,
          status: student.status,
          expectedMinutes: studentTargetMinutes,
          actualMinutes: studentActualMinutes,
          deficitMinutes: Math.max(0, studentDeficitMinutes),
          expectedHours: studentTargetHours,
          actualHours: studentActualHours,
          deficitHours: studentDeficitHours,
          causes
        };
      });

      const totalDeficitMinutes = Math.max(0, teacherTotalExpectedMinutes - teacherTotalActualMinutes);
      const expectedHours = parseFloat((teacherTotalExpectedMinutes / 60).toFixed(2));
      const actualHours = parseFloat((teacherTotalActualMinutes / 60).toFixed(2));
      const deficitHours = parseFloat(((teacherTotalExpectedMinutes - teacherTotalActualMinutes) / 60).toFixed(2));

      // Determine primary cause badge for teacher
      let primaryCause = 'منتظم';
      if (deficitHours > 0) {
        const allCauses = studentBreakdowns.flatMap(s => s.causes.map(c => c.badge));
        if (allCauses.some(c => c.includes('نقص مدة'))) primaryCause = 'نقص مدة الحصص بالدقائق';
        else if (allCauses.some(c => c.includes('إجازة طالب') || c.includes('توقف'))) primaryCause = 'إجازات / توقفات طلاب';
        else if (allCauses.some(c => c.includes('غياب معلم'))) primaryCause = 'غياب معلم';
        else if (allCauses.some(c => c.includes('انضمام منتصف الشهر'))) primaryCause = 'انضمام جديد منتصف الشهر';
        else primaryCause = 'عجز حصص غير مسجلة';
      }

      return {
        teacher: {
          _id: teacher._id,
          name: teacher.name,
          email: teacher.email,
          phone: teacher.phone
        },
        studentsCount: students.length,
        totalExpectedMinutes: teacherTotalExpectedMinutes,
        totalActualMinutes: teacherTotalActualMinutes,
        totalDeficitMinutes,
        expectedHours,
        actualHours,
        deficitHours,
        status: deficitHours > 0 ? 'deficit' : (deficitHours < 0 ? 'surplus' : 'on-track'),
        primaryCause,
        students: studentBreakdowns
      };
    }));

    // Overall summary across teachers
    const totalExpectedHours = parseFloat(teacherMatrix.reduce((sum, t) => sum + t.expectedHours, 0).toFixed(2));
    const totalActualHours = parseFloat(teacherMatrix.reduce((sum, t) => sum + t.actualHours, 0).toFixed(2));
    const totalNetDeficitHours = parseFloat((totalExpectedHours - totalActualHours).toFixed(2));
    const totalExpectedMinutes = teacherMatrix.reduce((sum, t) => sum + (t.totalExpectedMinutes || 0), 0);
    const totalActualMinutes = teacherMatrix.reduce((sum, t) => sum + (t.totalActualMinutes || 0), 0);
    const totalDeficitMinutes = Math.max(0, totalExpectedMinutes - totalActualMinutes);
    const teachersWithDeficit = teacherMatrix.filter(t => t.deficitHours > 0).length;

    res.json({
      success: true,
      month: monthStr,
      summary: {
        totalTeachers: teachers.length,
        totalExpectedHours,
        totalActualHours,
        totalNetDeficitHours,
        totalExpectedMinutes,
        totalActualMinutes,
        totalDeficitMinutes,
        teachersWithDeficit
      },
      data: teacherMatrix
    });
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
  getLeadSources,
  getMonthlyDeficit,
  getTeacherWeeklySchedule,
  getTeachersDeficitMatrix
};

