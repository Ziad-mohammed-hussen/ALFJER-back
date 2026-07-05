const StudentPause = require('../models/StudentPause');
const Student = require('../models/Student');

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

    // Create pause record
    const pause = await StudentPause.create({
      student: studentId,
      supervisor: supervisorId,
      type,
      reason,
      pausedAt: pausedAt || Date.now(),
      expectedReturnAt
    });

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
    const pauses = await StudentPause.find()
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

module.exports = { logPause, resumeStudent, getPauses };
