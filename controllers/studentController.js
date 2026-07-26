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
    age, language, country,
    startDate, programs, customProgram, programLevels, programBooks, levelPerProgram, booksUsed,
    scheduleSlots,
    sessionDurationMinutes, sessionDays, sessionTimeTeacher
  } = req.body;

  try {
    let parent = null;
    let actualParentId = null;

    if (parentId && parentId !== 'none') {
      parent = await User.findById(parentId);
      if (!parent || parent.role !== 'Parent') {
        return res.status(400).json({ message: 'Invalid parent ID provided' });
      }
      actualParentId = parentId;
    }

    // ─── منع تسجيل نفس الطالب مرتين لنفس ولي الأمر (أو بدون ولي أمر) ───
    const existingStudent = await Student.findOne({
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
      parent: actualParentId
    });
    if (existingStudent) {
      return res.status(400).json({
        message: actualParentId 
          ? `الطالب "${name}" مسجل بالفعل تحت ولي الأمر هذا. يُرجى التحقق من البيانات.`
          : `الطالب "${name}" بدون ولي أمر مسجل بالفعل في النظام. يُرجى التحقق من البيانات.`
      });
    }

    // بناء scheduleSlots من بيانات قديمة إذا لم تُرسل
    let finalSlots = scheduleSlots || [];
    if (!finalSlots.length && sessionDays?.length && sessionTimeTeacher) {
      finalSlots = sessionDays.map(day => ({
        day,
        time: sessionTimeTeacher,
        durationMinutes: sessionDurationMinutes || 60
      }));
    }

    let finalTeacherIds = teacherIds ? [...teacherIds] : [];
    if (req.user.role === 'Teacher' && !finalTeacherIds.includes(req.user.id)) {
      finalTeacherIds.push(req.user.id);
    }

    const student = await Student.create({
      name: name.trim(),
      parent: actualParentId,
      teachers: finalTeacherIds,
      timezone: timezone || 'Africa/Cairo',
      photoUrl: photoUrl || '',
      initialLevel: initialLevel || '',
      parentSocialMediaConsent: parentSocialMediaConsent || false,
      age: age || null,
      language: language || '',
      country: country || '',
      startDate: startDate || null,
      programs: programs || [],
      customProgram: customProgram || '',
      programLevels: typeof programLevels === 'object' ? JSON.stringify(programLevels) : (programLevels || '{}'),
      programBooks: typeof programBooks === 'object' ? JSON.stringify(programBooks) : (programBooks || '{}'),
      levelPerProgram: levelPerProgram || '',
      booksUsed: booksUsed || [],
      scheduleSlots: finalSlots,
      sessionDurationMinutes: sessionDurationMinutes || 60,
      sessionDays: sessionDays || [],
      sessionTimeTeacher: sessionTimeTeacher || ''
    });

    if (actualParentId) {
      await User.findByIdAndUpdate(actualParentId, { $push: { parentOf: student._id } });
    }

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
    if (req.user.role === 'Parent' && (!student.parent || student.parent._id.toString() !== req.user.id)) {
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
    startDate, programs, customProgram, programLevels, programBooks, levelPerProgram, booksUsed,
    scheduleSlots, sessionDurationMinutes, sessionDays, sessionTimeTeacher,
    status
  } = req.body;

  try {
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ message: 'Student not found' });

    const oldParentId = student.parent ? student.parent.toString() : '';
    const newParentId = (parentId && parentId !== 'none') ? parentId.toString() : '';

    if (newParentId !== oldParentId) {
      if (oldParentId) {
        await User.findByIdAndUpdate(oldParentId, { $pull: { parentOf: student._id } });
      }
      if (newParentId) {
        const parent = await User.findById(newParentId);
        if (!parent || parent.role !== 'Parent') {
          return res.status(400).json({ message: 'Invalid parent ID provided' });
        }
        await User.findByIdAndUpdate(newParentId, { $push: { parentOf: student._id } });
        student.parent = newParentId;
      } else {
        student.parent = null;
      }
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
    if (customProgram !== undefined) student.customProgram = customProgram;
    if (programLevels !== undefined) student.programLevels = typeof programLevels === 'object' ? JSON.stringify(programLevels) : programLevels;
    if (programBooks !== undefined) student.programBooks = typeof programBooks === 'object' ? JSON.stringify(programBooks) : programBooks;
    if (levelPerProgram !== undefined) student.levelPerProgram = levelPerProgram;
    if (booksUsed !== undefined) student.booksUsed = booksUsed;
    if (scheduleSlots !== undefined) student.scheduleSlots = scheduleSlots;
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

// @desc    Delete a student
// @route   DELETE /api/students/:id
// @access  Private/Admin/GlobalSup/Supervisor
const deleteStudent = async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ message: 'Student not found' });

    // Remove from parent's parentOf list
    if (student.parent) {
      await User.findByIdAndUpdate(student.parent, { $pull: { parentOf: student._id } });
    }

    // Delete associated sessions
    await Session.deleteMany({ student: student._id });

    await student.deleteOne();
    res.json({ success: true, message: 'تم حذف الطالب وجميع حصصه بنجاح.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all pricing details
// @route   GET /api/students/pricing/all
// @access  Private/Admin/GlobalSup
const getAllPricing = async (req, res) => {
  try {
    const pricing = await Pricing.find({})
      .populate('teacher', 'name email')
      .populate('student', 'name');
    res.json({ success: true, data: pricing });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getStudents, createStudent, getStudent, setPricing, getPricing, getAllPricing, checkStudentExists, updateStudent, deleteStudent };
