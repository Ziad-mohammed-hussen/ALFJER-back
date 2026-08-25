const Session = require('../models/Session');
const Student = require('../models/Student');
const User = require('../models/User');
const SessionEditRequest = require('../models/SessionEditRequest');

// @desc    Log a new teaching session/attendance
// @route   POST /api/sessions
// @access  Private/Teacher/Admin
const logSession = async (req, res) => {
  const {
    studentId, subject, program, isCombinedProgram, date, durationMinutes, status, teacherNote,
    scheduledMakeupDate, scheduledMakeupTimeSlot, originalSessionId,
    latenessRemark, notifiedOnGroup, preNotifiedTwoHours
  } = req.body;
  const teacherId = req.user.id;

  try {
    // Check if consecutive absences alert is triggered
    let consecutiveAbsences = 0;
    let triggerAlert = false;
    const isAbsence = ['Excused', 'Unexcused', 'TeacherAbs'].includes(status);

    if (isAbsence) {
      const lastSession = await Session.findOne({ student: studentId }).sort({ date: -1, createdAt: -1 });
      if (
        lastSession &&
        ['Excused', 'Unexcused', 'TeacherAbs'].includes(lastSession.status)
      ) {
        consecutiveAbsences = (lastSession.consecutiveAbsenceCounter || 0) + 1;
        if (consecutiveAbsences >= 2) {
          triggerAlert = true;
        }
      } else {
        consecutiveAbsences = 1;
      }
    }

    // Strict Procedure Check: Cannot log Unexcused absence without verifying group call or last minute excuse
    if (status === 'Unexcused' && !notifiedOnGroup && !preNotifiedTwoHours) {
      return res.status(400).json({
        message: 'لا يمكن تسجيل الحصة (غياب بدون عذر) وتخصيمها ماليّاً إلا بعد تحديد خيار الإيضاح: (تم الرن على الجروب) أو (اعتذار خلال/قبل الحصة بدقائق معدودة)!'
      });
    }

    // 1. Verify student exists
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Check if target month is locked
    const d = new Date(date);
    const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
    const lockedSession = await Session.findOne({
      date: { $gte: startOfMonth, $lte: endOfMonth },
      isLocked: true
    });
    if (lockedSession) {
      return res.status(400).json({ message: 'هذا الشهر مقفل مالياً وتلقائياً. لا يمكن تسجيل حصة جديدة فيه.' });
    }

    // Strict Check: Cannot log a makeup session unless student has uncompleted pending absences
    let linkedOriginalSessionId = originalSessionId;
    if (['TeacherMakeup', 'StudentMakeup'].includes(status)) {
      const pendingAbsences = await Session.find({
        student: studentId,
        teacher: teacherId,
        status: { $in: ['Excused', 'TeacherAbs'] },
        makeupStatus: { $ne: 'Completed' }
      }).sort({ date: 1 });

      if (!pendingAbsences || pendingAbsences.length === 0) {
        return res.status(400).json({
          message: 'لا يمكن تسجيل حصة تعويضية لهذا الطالب لعدم وجود أي غيابات سابقة معلقة تحتاج إلى تعويض!'
        });
      }

      if (!linkedOriginalSessionId && pendingAbsences.length > 0) {
        linkedOriginalSessionId = pendingAbsences[0]._id;
      }
    }

    // Determine initial makeup status & isMakeup flag
    let makeupStatus = 'None';
    if (status === 'Excused' || status === 'TeacherAbs') {
      makeupStatus = scheduledMakeupDate ? 'Scheduled' : 'Pending';
    }

    const isMakeup = ['TeacherMakeup', 'StudentMakeup'].includes(status) || !!linkedOriginalSessionId;

    // 4. Create the session
    const session = await Session.create({
      student: studentId,
      teacher: teacherId,
      subject: subject || program || 'القرآن الكريم والتجويد',
      program: program || subject || 'القرآن الكريم والتجويد',
      isCombinedProgram: !!isCombinedProgram,
      date,
      durationMinutes: durationMinutes ? Number(durationMinutes) : 60,
      status,
      isMakeup,
      originalSession: linkedOriginalSessionId || null,
      makeupStatus,
      scheduledMakeupDate: scheduledMakeupDate || null,
      scheduledMakeupTimeSlot: scheduledMakeupTimeSlot || '',
      latenessRemark: latenessRemark || '',
      notifiedOnGroup: !!notifiedOnGroup,
      preNotifiedTwoHours: !!preNotifiedTwoHours,
      consecutiveAbsenceCounter: consecutiveAbsences,
      teacherNote
    });

    // 5. If this is a makeup session linked to an original absence session, auto-link & close original
    if (linkedOriginalSessionId) {
      const origSession = await Session.findById(linkedOriginalSessionId);
      if (origSession) {
        origSession.makeupStatus = 'Completed';
        origSession.makeupSession = session._id;
        await origSession.save();
      }
    }

    res.status(201).json({
      success: true,
      data: session,
      consecutiveAbsenceAlert: triggerAlert,
      message: triggerAlert
        ? 'ALERT: Student has missed two consecutive sessions! Notifications sent to Supervisor, General Supervisor, Admin, and Parent.'
        : 'Session logged successfully.'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get sessions (filtered by role)
// @route   GET /api/sessions
// @access  Private
const getSessions = async (req, res) => {
  try {
    let filter = {};

    if (req.user.role === 'Teacher') {
      filter.teacher = req.user.id;
    } else if (req.user.role === 'Parent') {
      const students = await Student.find({ parent: req.user.id });
      const studentIds = students.map(s => s._id);
      filter.student = { $in: studentIds };
    } else if (req.user.role === 'Supervisor') {
      const supervisedTeachers = await User.find({ supervisor: req.user.id, role: 'Teacher' });
      const teacherIds = supervisedTeachers.map(t => t._id);
      filter.teacher = { $in: teacherIds };
    }

    const sessions = await Session.find(filter)
      .populate('student', 'name timezone')
      .populate('teacher', 'name')
      .sort({ date: -1 });

    res.json({ success: true, count: sessions.length, data: sessions });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get pending makeups list
// @route   GET /api/sessions/makeups
// @access  Private
const getPendingMakeups = async (req, res) => {
  try {
    let filter = { makeupStatus: { $in: ['Pending', 'Scheduled'] } };

    if (req.user.role === 'Teacher') {
      filter.teacher = req.user.id;
    } else if (req.user.role === 'Supervisor') {
      const supervisedTeachers = await User.find({ supervisor: req.user.id, role: 'Teacher' });
      const teacherIds = supervisedTeachers.map(t => t._id);
      filter.teacher = { $in: teacherIds };
    }

    const makeups = await Session.find(filter)
      .populate('student', 'name timezone')
      .populate('teacher', 'name')
      .sort({ date: -1 });

    res.json({ success: true, data: makeups });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Propose/Schedule a makeup session
// @route   POST /api/sessions/:id/makeup
// @access  Private/Teacher/Supervisor/Admin
const scheduleMakeup = async (req, res) => {
  const { makeupDate, durationMinutes, notes } = req.body;

  try {
    const originalSession = await Session.findById(req.params.id);
    if (!originalSession) {
      return res.status(404).json({ message: 'Original session not found' });
    }

    if (originalSession.makeupStatus === 'None') {
      return res.status(400).json({ message: 'This session does not require a makeup' });
    }

    // Creating the makeup session log
    const makeupSession = await Session.create({
      student: originalSession.student,
      teacher: originalSession.teacher,
      subject: originalSession.subject,
      date: makeupDate,
      durationMinutes: durationMinutes || originalSession.durationMinutes,
      status: 'Present',
      isMakeup: true,
      originalSession: originalSession._id,
      teacherNote: `Makeup for session on ${originalSession.date.toDateString()}. Note: ${notes || ''}`
    });

    originalSession.makeupStatus = 'Completed';
    originalSession.makeupSession = makeupSession._id;
    await originalSession.save();

    res.json({ success: true, data: makeupSession, original: originalSession });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Submit difficulty to compensate a session (Teacher only)
// @route   POST /api/sessions/:id/difficulty
// @access  Private/Teacher
const submitMakeupDifficulty = async (req, res) => {
  const { difficultyNote } = req.body;

  try {
    const session = await Session.findById(req.params.id);
    if (!session || session.teacher.toString() !== req.user.id) {
      return res.status(404).json({ message: 'Session not found or not authorized' });
    }

    session.makeupDifficultyNote = difficultyNote;
    await session.save();

    res.json({ success: true, data: session, message: 'Difficulty note submitted to supervisor.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Approve/Lock sessions (Supervisor/Admin only)
// @route   POST /api/sessions/:id/approve
// @access  Private/Supervisor/Admin/GlobalSup
const approveSession = async (req, res) => {
  try {
    const { supervisorChecklist, internalSupervisorNote } = req.body;
    const session = await Session.findById(req.params.id);
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    session.isApprovedBySupervisor = true;
    if (supervisorChecklist && typeof supervisorChecklist === 'object') {
      session.supervisorChecklist = {
        ...session.supervisorChecklist,
        ...supervisorChecklist
      };
    }
    if (internalSupervisorNote) {
      session.internalSupervisorNote = internalSupervisorNote;
    }
    await session.save();

    res.json({ success: true, data: session });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update session directly (Teacher only) - for unlocked sessions
// @route   PUT /api/sessions/:id
// @access  Private/Teacher
const updateSessionDirect = async (req, res) => {
  const { subject, date, durationMinutes, status, teacherNote } = req.body;
  try {
    const session = await Session.findById(req.params.id);
    if (!session || session.teacher.toString() !== req.user.id) {
      return res.status(404).json({ message: 'Session not found or unauthorized' });
    }
    if (session.isLocked) {
      return res.status(400).json({ message: 'هذه الحصة مقفلة. يرجى تقديم طلب تعديل بدلاً من التعديل المباشر.' });
    }

    if (date) {
      const d = new Date(date);
      const startM = new Date(d.getFullYear(), d.getMonth(), 1);
      const endM = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const lockedSession = await Session.findOne({
        date: { $gte: startM, $lte: endM },
        isLocked: true
      });
      if (lockedSession) {
        return res.status(400).json({ message: 'الشهر الجديد المستهدف مقفل مالياً.' });
      }
      session.date = date;
    }

    if (subject) session.subject = subject;
    if (durationMinutes) session.durationMinutes = durationMinutes;
    if (status) session.status = status;
    if (teacherNote !== undefined) session.teacherNote = teacherNote;

    await session.save();
    res.json({ success: true, data: session, message: 'تم تحديث الحصة مباشرة بنجاح.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Request session edit (Teacher only) - for locked sessions
// @route   POST /api/sessions/:id/request-edit
// @access  Private/Teacher
const requestSessionEdit = async (req, res) => {
  const { reason, proposedChanges } = req.body;
  try {
    const session = await Session.findById(req.params.id);
    if (!session || session.teacher.toString() !== req.user.id) {
      return res.status(404).json({ message: 'Session not found or unauthorized' });
    }

    const editRequest = await SessionEditRequest.create({
      session: session._id,
      teacher: req.user.id,
      reason,
      proposedChanges,
      status: 'Pending'
    });

    res.status(201).json({ success: true, data: editRequest, message: 'تم تقديم طلب تعديل الحصة بنجاح.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get session edit requests
// @route   GET /api/sessions/edit-requests
// @access  Private/Supervisor/Admin/GlobalSup
const getSessionEditRequests = async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === 'Supervisor') {
      const supervisedTeachers = await User.find({ supervisor: req.user.id, role: 'Teacher' });
      const teacherIds = supervisedTeachers.map(t => t._id);
      filter.teacher = { $in: teacherIds };
    }
    const requests = await SessionEditRequest.find(filter)
      .populate('teacher', 'name')
      .populate({
        path: 'session',
        populate: { path: 'student', select: 'name' }
      })
      .sort({ createdAt: -1 });

    res.json({ success: true, data: requests });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Resolve session edit request (Approve/Reject)
// @route   POST /api/sessions/edit-requests/:id/resolve
// @access  Private/Supervisor/Admin/GlobalSup
const resolveSessionEditRequest = async (req, res) => {
  const { status } = req.body; // Approved or Rejected
  try {
    const editRequest = await SessionEditRequest.findById(req.params.id);
    if (!editRequest) {
      return res.status(404).json({ message: 'Request not found' });
    }

    editRequest.status = status;
    await editRequest.save();

    if (status === 'Approved') {
      const session = await Session.findById(editRequest.session);
      if (session) {
        const changes = editRequest.proposedChanges;
        if (changes.status) session.status = changes.status;
        if (changes.durationMinutes) session.durationMinutes = changes.durationMinutes;
        if (changes.date) session.date = changes.date;
        if (changes.subject) session.subject = changes.subject;
        if (changes.teacherNote) session.teacherNote = changes.teacherNote;

        await session.save();
      }
    }

    res.json({ success: true, data: editRequest, message: `Request has been ${status}.` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Lock all sessions of a specific month
// @route   POST /api/sessions/lock-month
// @access  Private/Admin
const lockMonth = async (req, res) => {
  const { monthStr } = req.body; // format: "YYYY-MM"
  try {
    const date = new Date(monthStr);
    const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

    const result = await Session.updateMany(
      { date: { $gte: startOfMonth, $lte: endOfMonth } },
      { isLocked: true }
    );

    res.json({ success: true, message: `تم قفل ${result.modifiedCount} حصص بنجاح لشهر ${monthStr}.` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Cancel makeup requirement for a session (Supervisor/Admin only)
// @route   POST /api/sessions/:id/cancel-makeup
// @access  Private/Supervisor/Admin/GlobalSup
const cancelMakeup = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }
    session.makeupStatus = 'Cancelled';
    await session.save();
    res.json({ success: true, data: session, message: 'تم إيقاف وإلغاء طلب التعويض لهذه الحصة بنجاح.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get makeup dashboard stats for Admin and Supervisor
// @route   GET /api/sessions/makeups/dashboard
// @access  Private
const getMakeupDashboardStats = async (req, res) => {
  try {
    let filter = {
      $or: [
        { makeupStatus: { $in: ['Pending', 'Scheduled', 'Completed'] } },
        { status: { $in: ['Excused', 'TeacherAbs', 'TeacherMakeup', 'StudentMakeup'] } }
      ]
    };

    if (req.user.role === 'Teacher') {
      filter.teacher = req.user.id;
    } else if (req.user.role === 'Supervisor') {
      const supervisedTeachers = await User.find({ supervisor: req.user.id, role: 'Teacher' });
      const teacherIds = supervisedTeachers.map(t => t._id);
      filter.teacher = { $in: teacherIds };
    }

    const sessions = await Session.find(filter)
      .populate('student', 'name country timezone')
      .populate('teacher', 'name email')
      .populate('originalSession')
      .populate('makeupSession')
      .sort({ date: -1 });

    res.json({ success: true, count: sessions.length, data: sessions });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  logSession,
  getSessions,
  getPendingMakeups,
  getMakeupDashboardStats,
  scheduleMakeup,
  submitMakeupDifficulty,
  approveSession,
  updateSessionDirect,
  requestSessionEdit,
  getSessionEditRequests,
  resolveSessionEditRequest,
  lockMonth,
  cancelMakeup
};
