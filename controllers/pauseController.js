const StudentPause = require('../models/StudentPause');
const Student = require('../models/Student');
const User = require('../models/User');

// @desc    Log a student pause (temporary or permanent)
// @route   POST /api/pauses
// @access  Private/Supervisor/Admin/GlobalSup
const logPause = async (req, res) => {
  const { studentId, type, reason, pausedAt, expectedReturnAt } = req.body;
  const supervisorId = req.user.id;

  try {
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // If requester is a Supervisor, ensure they only pause their assigned students
    if (req.user.role === 'Supervisor') {
      const teachers = await User.find({ supervisor: req.user.id, role: 'Teacher' }).select('_id');
      const teacherIds = teachers.map(t => t._id.toString());
      const hasPermission = student.teachers && student.teachers.some(t => teacherIds.includes(t.toString()));
      if (!hasPermission) {
        return res.status(403).json({ message: 'غير مصرح لك بإيقاف طالب ليس ضمن مجموعتك الإشرافية' });
      }
    }

    const pauseData = {
      student: studentId,
      supervisor: supervisorId,
      type,
      reason: reason || 'إجازة / توقف مؤقت',
      pausedAt: pausedAt || Date.now()
    };
    if (expectedReturnAt && expectedReturnAt !== '') {
      pauseData.expectedReturnAt = expectedReturnAt;
    }
    const pause = await StudentPause.create(pauseData);

    // Update student status
    student.status = type === 'permanent' ? 'Inactive' : 'Paused';
    await student.save();

    res.status(201).json({ success: true, data: pause, student });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Resolve a student pause / resume student
// @route   POST /api/pauses/:id/resume
// @access  Private/Supervisor/Admin/GlobalSup
const resumeStudent = async (req, res) => {
  try {
    const pause = await StudentPause.findById(req.params.id);
    if (!pause) {
      return res.status(404).json({ message: 'Pause record not found' });
    }

    // If supervisor, check permission
    if (req.user.role === 'Supervisor') {
      const teachers = await User.find({ supervisor: req.user.id, role: 'Teacher' }).select('_id');
      const teacherIds = teachers.map(t => t._id.toString());
      const student = await Student.findById(pause.student);
      const hasPermission = student && student.teachers && student.teachers.some(t => teacherIds.includes(t.toString()));
      if (!hasPermission && pause.supervisor?.toString() !== req.user.id) {
        return res.status(403).json({ message: 'غير مصرح لك بتفعيل طالب ليس ضمن مجموعتك الإشرافية' });
      }
    }

    pause.isResolved = true;
    pause.actualReturnAt = Date.now();
    await pause.save();

    // Update student status to Active
    const student = await Student.findById(pause.student);
    if (student) {
      student.status = 'Active';
      await student.save();
    }

    res.json({ success: true, data: pause, student });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all pause records
// @route   GET /api/pauses
// @access  Private/Supervisor/Admin/GlobalSup
const getPauses = async (req, res) => {
  try {
    let filter = {};

    if (req.user.role === 'Supervisor') {
      const teachers = await User.find({ supervisor: req.user.id, role: 'Teacher' }).select('_id');
      const teacherIds = teachers.map(t => t._id);
      const supervisedStudents = await Student.find({ teachers: { $in: teacherIds } }).select('_id');
      const studentIds = supervisedStudents.map(s => s._id);
      filter = {
        $or: [
          { supervisor: req.user.id },
          { student: { $in: studentIds } }
        ]
      };
    } else if (req.user.role === 'Teacher') {
      const teacherStudents = await Student.find({ teachers: req.user.id }).select('_id');
      const studentIds = teacherStudents.map(s => s._id);
      filter.student = { $in: studentIds };
    }

    const pauses = await StudentPause.find(filter)
      .populate('student', 'name')
      .populate('supervisor', 'name')
      .sort({ pausedAt: -1 });

    // Mark pauses as overdue if today > expectedReturnAt and not resolved
    const pausesWithAlerts = pauses.map(p => {
      const isOverdue = !p.isResolved && p.expectedReturnAt && new Date() > new Date(p.expectedReturnAt);
      return {
        ...p.toObject(),
        isOverdueAlert: isOverdue
      };
    });

    res.json({ success: true, data: pausesWithAlerts });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Resolve a student pause / resume student by studentId
// @route   POST /api/pauses/student/:studentId/resume
// @access  Private/Supervisor/Admin/GlobalSup/Teacher
const resumeStudentByStudentId = async (req, res) => {
  const { studentId } = req.params;
  try {
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // If supervisor, check permission
    if (req.user.role === 'Supervisor') {
      const teachers = await User.find({ supervisor: req.user.id, role: 'Teacher' }).select('_id');
      const teacherIds = teachers.map(t => t._id.toString());
      const hasPermission = student.teachers && student.teachers.some(t => teacherIds.includes(t.toString()));
      if (!hasPermission) {
        return res.status(403).json({ message: 'غير مصرح لك بتفعيل طالب ليس ضمن مجموعتك الإشرافية' });
      }
    }

    const pause = await StudentPause.findOne({ student: studentId, isResolved: false });
    if (!pause) {
      student.status = 'Active';
      await student.save();
      return res.json({ success: true, message: 'Student status updated to Active', student });
    }

    pause.isResolved = true;
    pause.actualReturnAt = Date.now();
    await pause.save();

    student.status = 'Active';
    await student.save();

    res.json({ success: true, data: pause, student });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { logPause, resumeStudent, getPauses, resumeStudentByStudentId };
