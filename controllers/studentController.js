const Student = require('../models/Student');
const Pricing = require('../models/Pricing');
const User = require('../models/User');
const Session = require('../models/Session');

// @desc    Get all students (filtered by role)
// @route   GET /api/students
// @access  Private
const getStudents = async (req, res) => {
  try {
    let filter = {};

    if (req.user.role === 'Parent') {
      filter.parent = req.user.id;
    } else if (req.user.role === 'Teacher') {
      filter.teachers = req.user.id;
    } else if (req.user.role === 'Supervisor') {
      // Find teachers assigned to this supervisor
      const teachers = await User.find({ supervisor: req.user.id, role: 'Teacher' });
      const teacherIds = teachers.map(t => t._id);
      filter.teachers = { $in: teacherIds };
    }

    const students = await Student.find(filter)
      .populate('parent', 'name email phone')
      .populate('teachers', 'name email');

    // Add dynamic alerts for consecutive absences
    const studentsWithAlerts = await Promise.all(students.map(async (s) => {
      const lastSession = await Session.findOne({ student: s._id }).sort({ date: -1, createdAt: -1 });
      const hasAlert = lastSession && (lastSession.consecutiveAbsenceCounter >= 2) && ['Excused', 'Unexcused', 'TeacherAbs'].includes(lastSession.status);
      return {
        ...s.toObject(),
        hasConsecutiveAbsenceAlert: !!hasAlert
      };
    }));

    res.json({ success: true, count: studentsWithAlerts.length, data: studentsWithAlerts });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a new student
// @route   POST /api/students
// @access  Private/Admin/GlobalSup/Supervisor
const createStudent = async (req, res) => {
  const { name, parentId, teacherIds } = req.body;

  try {
    const parent = await User.findById(parentId);
    if (!parent || parent.role !== 'Parent') {
      return res.status(400).json({ message: 'Invalid parent ID provided' });
    }

    const student = await Student.create({
      name,
      parent: parentId,
      teachers: teacherIds || []
    });

    // Update parent Of list
    await User.findByIdAndUpdate(parentId, {
      $push: { parentOf: student._id }
    });

    res.status(201).json({ success: true, data: student });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get single student details
// @route   GET /api/students/:id
// @access  Private
const getStudent = async (req, res) => {
  try {
    const student = await Student.findById(req.params.id)
      .populate('parent', 'name email phone')
      .populate('teachers', 'name email');

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Role-based check
    if (req.user.role === 'Parent' && student.parent._id.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to view this student' });
    }

    if (req.user.role === 'Teacher' && !student.teachers.some(t => t._id.toString() === req.user.id)) {
      return res.status(403).json({ message: 'Not authorized to view this student' });
    }

    res.json({ success: true, data: student });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Configure pricing for student + teacher + subject
// @route   POST /api/students/pricing
// @access  Private/Admin
const setPricing = async (req, res) => {
  const { studentId, teacherId, subject, hourlyRate, currency, teacherRate, teacherCurrency } = req.body;

  try {
    const pricing = await Pricing.findOneAndUpdate(
      { student: studentId, teacher: teacherId, subject },
      {
        hourlyRate,
        currency,
        teacherRate,
        teacherCurrency
      },
      { new: true, upsert: true }
    );

    // Ensure teacher is linked to student
    await Student.findByIdAndUpdate(studentId, {
      $addToSet: { teachers: teacherId }
    });

    res.json({ success: true, data: pricing });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get pricing details for a student
// @route   GET /api/students/pricing/:studentId
// @access  Private/Admin
const getPricing = async (req, res) => {
  try {
    const pricing = await Pricing.find({ student: req.params.studentId })
      .populate('teacher', 'name email')
      .populate('student', 'name');
      
    res.json({ success: true, data: pricing });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getStudents, createStudent, getStudent, setPricing, getPricing };
