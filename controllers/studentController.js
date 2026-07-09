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
  const {
    name, parentId, teacherIds, timezone, photoUrl, initialLevel, parentSocialMediaConsent,
    // القسم 1: إحصائية
    age, language, country,
    // القسم 2: كمية
    startDate, programs, levelPerProgram, booksUsed,
    // القسم 3: جدول المعلم
    sessionDurationMinutes, sessionDays, sessionTimeTeacher
  } = req.body;

  try {
    // التحقق من ولي الأمر
    const parent = await User.findById(parentId);
    if (!parent || parent.role !== 'Parent') {
      return res.status(400).json({ message: 'Invalid parent ID provided' });
    }

    // ─── التحقق من عدم وجود طالب بنفس الاسم لنفس ولي الأمر ───
    const existingStudent = await Student.findOne({
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
      parent: parentId
    });
    if (existingStudent) {
      return res.status(400).json({
        message: `الطالب "${name}" مسجل بالفعل تحت ولي الأمر هذا. يُرجى التحقق من البيانات.`
      });
    }

    const student = await Student.create({
      name: name.trim(),
      parent: parentId,
      teachers: teacherIds || [],
      timezone: timezone || 'Africa/Cairo',
      photoUrl: photoUrl || '',
      initialLevel: initialLevel || '',
      parentSocialMediaConsent: parentSocialMediaConsent || false,
      // إحصائية
      age: age || null,
      language: language || '',
      country: country || '',
      // كمية
      startDate: startDate || null,
      programs: programs || [],
      levelPerProgram: levelPerProgram || '',
      booksUsed: booksUsed || [],
      // جدول المعلم
      sessionDurationMinutes: sessionDurationMinutes || 60,
      sessionDays: sessionDays || [],
      sessionTimeTeacher: sessionTimeTeacher || ''
    });

    // Update parentOf list
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

// @desc    Check if a student exists by name + parent
// @route   GET /api/students/check?name=XXX&parentId=YYY
// @access  Private/Admin/GlobalSup/Supervisor
const checkStudentExists = async (req, res) => {
  const { name, parentId } = req.query;
  try {
    const existing = await Student.findOne({
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
      parent: parentId
    }).populate('parent', 'name');
    
    if (existing) {
      return res.json({ exists: true, student: existing });
    }
    res.json({ exists: false });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update a student
// @route   PUT /api/students/:id
// @access  Private/Admin/GlobalSup/Supervisor
const updateStudent = async (req, res) => {
  const {
    name, parentId, teacherIds, timezone, photoUrl, initialLevel, parentSocialMediaConsent,
    age, language, country,
    startDate, programs, levelPerProgram, booksUsed,
    sessionDurationMinutes, sessionDays, sessionTimeTeacher,
    status
  } = req.body;

  try {
    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // If parent is changed, update parentOf array
    if (parentId && parentId !== student.parent.toString()) {
      const parent = await User.findById(parentId);
      if (!parent || parent.role !== 'Parent') {
        return res.status(400).json({ message: 'Invalid parent ID provided' });
      }

      // Remove from old parent
      await User.findByIdAndUpdate(student.parent, {
        $pull: { parentOf: student._id }
      });

      // Add to new parent
      await User.findByIdAndUpdate(parentId, {
        $push: { parentOf: student._id }
      });
      student.parent = parentId;
    }

    if (name !== undefined) student.name = name.trim();
    if (teacherIds !== undefined) student.teachers = teacherIds;
    if (timezone !== undefined) student.timezone = timezone;
    if (photoUrl !== undefined) student.photoUrl = photoUrl;
    if (initialLevel !== undefined) student.initialLevel = initialLevel;
    if (parentSocialMediaConsent !== undefined) student.parentSocialMediaConsent = parentSocialMediaConsent;
    if (age !== undefined) student.age = age;
    if (language !== undefined) student.language = language;
    if (country !== undefined) student.country = country;
    if (startDate !== undefined) student.startDate = startDate;
    if (programs !== undefined) student.programs = programs;
    if (levelPerProgram !== undefined) student.levelPerProgram = levelPerProgram;
    if (booksUsed !== undefined) student.booksUsed = booksUsed;
    if (sessionDurationMinutes !== undefined) student.sessionDurationMinutes = sessionDurationMinutes;
    if (sessionDays !== undefined) student.sessionDays = sessionDays;
    if (sessionTimeTeacher !== undefined) student.sessionTimeTeacher = sessionTimeTeacher;
    if (status !== undefined) student.status = status;

    await student.save();

    res.json({ success: true, data: student });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getStudents, createStudent, getStudent, setPricing, getPricing, checkStudentExists, updateStudent };
