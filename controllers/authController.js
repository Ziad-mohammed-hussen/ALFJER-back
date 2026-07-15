const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Session = require('../models/Session');
const Student = require('../models/Student');

// Helper to generate token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'supersecretkeyforalfjracademy123', {
    expiresIn: '30d'
  });
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Private/Admin
const register = async (req, res) => {
  const { name, email, password, role, phone, supervisor, parentOf, specialty } = req.body;

  try {
    // Check if user already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create user
    const user = await User.create({
      name,
      email,
      password,
      role,
      phone,
      specialty: specialty || '',
      supervisor: (supervisor && supervisor !== '') ? supervisor : undefined,
      parentOf
    });

    res.status(201).json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Auth user & get token
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // Validate request
    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password' });
    }

    // Check for user
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check if password matches
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    res.json({
      success: true,
      token: generateToken(user._id),
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('parentOf');
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all users (filtered by role)
// @route   GET /api/auth/users
// @access  Private/Admin/GlobalSup
const getUsers = async (req, res) => {
  const { role } = req.query;
  const filter = {};
  if (role) filter.role = role;

  try {
    const users = await User.find(filter).populate('parentOf').populate('supervisor', 'name');
    res.json({ success: true, count: users.length, data: users });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Signup a user (public registration)
// @route   POST /api/auth/signup
// @access  Public
const signup = async (req, res) => {
  const { name, email, password, role, phone } = req.body;

  try {
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const user = await User.create({
      name,
      email,
      password,
      role: role || 'Parent',
      phone
    });

    res.status(201).json({
      success: true,
      token: generateToken(user._id),
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Transfer teacher to another supervisor
// @route   POST /api/auth/transfer-teacher
// @access  Private/Admin/GlobalSup
const transferTeacher = async (req, res) => {
  const { teacherId, newSupervisorId } = req.body;

  try {
    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== 'Teacher') {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    const supervisor = await User.findById(newSupervisorId);
    if (!supervisor || (supervisor.role !== 'Supervisor' && supervisor.role !== 'Admin')) {
      return res.status(404).json({ message: 'Supervisor not found' });
    }

    teacher.supervisor = newSupervisorId;
    await teacher.save();

    res.json({ success: true, data: teacher, message: `تم نقل المعلم ${teacher.name} بنجاح إلى المشرف ${supervisor.name}.` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Register a new Parent account (Admin or Supervisor)
// @route   POST /api/auth/register-parent
// @access  Private/Admin/GlobalSup/Supervisor
const registerParent = async (req, res) => {
  const { name, email, password, phone, notes, defaultHourlyRate, defaultCurrency, studentIds } = req.body;

  try {
    // Check if already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: `ولي الأمر بهذا البريد "${email}" موجود بالفعل في النظام.` });
    }

    const verifiedStudentIds = Array.isArray(studentIds) ? studentIds : [];

    const user = await User.create({
      name,
      email,
      password: password || 'parent123',
      role: 'Parent',
      phone: phone || '',
      defaultHourlyRate: defaultHourlyRate || null,
      defaultCurrency: defaultCurrency || '',
      parentOf: verifiedStudentIds
    });

    if (verifiedStudentIds.length > 0) {
      await Student.updateMany(
        { _id: { $in: verifiedStudentIds } },
        { parent: user._id }
      );
    }

    res.status(201).json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone
      },
      message: `تم إنشاء حساب ولي الأمر "${name}" بنجاح.`
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update user info (email / phone / name / role / supervisor)
// @route   PUT /api/auth/users/:id
// @access  Private/Admin/GlobalSup
const updateUser = async (req, res) => {
  const { name, email, phone, role, supervisor, password, specialty, defaultHourlyRate, defaultCurrency } = req.body;
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (name !== undefined) user.name = name;
    if (email !== undefined) user.email = email;
    if (phone !== undefined) user.phone = phone;
    if (specialty !== undefined) user.specialty = specialty;
    if (defaultHourlyRate !== undefined) user.defaultHourlyRate = defaultHourlyRate || null;
    if (defaultCurrency !== undefined) user.defaultCurrency = defaultCurrency || '';

    if (password) {
      user.password = password; // The pre-save hook will hash it
    }

    // Only Admin can change roles
    if (role !== undefined && req.user.role === 'Admin') {
      user.role = role;
      // If changing to a role that shouldn't have a supervisor
      if (role === 'Supervisor' || role === 'GlobalSup' || role === 'Admin') {
        user.supervisor = null;
      }
    }

    // Explicitly handle supervisor assignment or unassignment
    if (req.body.hasOwnProperty('supervisor')) {
      if (!supervisor || supervisor === '') {
        user.supervisor = null;
      } else {
        user.supervisor = supervisor;
      }
    }

    // Extra safety: if role is Admin/Supervisor/GlobalSup, force supervisor to null
    if (['Admin', 'GlobalSup', 'Supervisor'].includes(user.role)) {
      user.supervisor = null;
    }

    await user.save();
    res.json({ success: true, data: user, message: 'تم تحديث بيانات المستخدم بنجاح.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get full org hierarchy with KPIs
// @route   GET /api/auth/hierarchy
// @access  Private/Admin/GlobalSup/Supervisor
const getHierarchy = async (req, res) => {
  try {
    const currentUser = req.user;

    // Fetch all sessions for KPI calculations (last 60 days)
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    // Window for "this week" makeups (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const allSessions = await Session.find({ date: { $gte: sixtyDaysAgo } })
      .select('student teacher status makeupStatus isMakeup date');

    // Helper: compute KPIs for a given teacherId
    const teacherKPIs = (teacherId) => {
      const tid = teacherId.toString();
      const sessions = allSessions.filter(s => s.teacher && s.teacher.toString() === tid);
      const total = sessions.length;
      const absent = sessions.filter(s => ['Excused', 'Unexcused'].includes(s.status)).length;
      const pendingMakeups = sessions.filter(s => s.makeupStatus === 'Pending').length;
      const completedMakeups = sessions.filter(s => s.makeupStatus === 'Completed').length;
      const totalMakeups = pendingMakeups + completedMakeups;
      const makeupCompletionRate = totalMakeups > 0 ? Math.round((completedMakeups / totalMakeups) * 100) : 100;
      const teacherAbsent = sessions.filter(s => s.status === 'TeacherAbs').length;
      const absenceRate = total > 0 ? Math.round((absent / total) * 100) : 0;
      // Weekly pending makeups (last 7 days)
      const weeklyPendingMakeups = sessions.filter(s =>
        s.makeupStatus === 'Pending' && s.date && new Date(s.date) >= sevenDaysAgo
      ).length;
      return { total, absent, pendingMakeups, completedMakeups, totalMakeups, makeupCompletionRate, teacherAbsent, absenceRate, weeklyPendingMakeups };
    };

    // Helper: compute KPIs for a given studentId
    const studentKPIs = (studentId) => {
      const sid = studentId.toString();
      const sessions = allSessions.filter(s => s.student && s.student.toString() === sid);
      const total = sessions.length;
      const absent = sessions.filter(s => ['Excused', 'Unexcused'].includes(s.status)).length;
      const pendingMakeups = sessions.filter(s => s.makeupStatus === 'Pending').length;
      const completedMakeups = sessions.filter(s => s.makeupStatus === 'Completed').length;
      const absenceRate = total > 0 ? Math.round((absent / total) * 100) : 0;
      return { total, absent, pendingMakeups, completedMakeups, absenceRate };
    };

    // Helper: aggregate KPIs for supervisor (from his teachers)
    const supervisorKPIs = (teachers) => {
      const totalStudents = teachers.reduce((sum, t) => sum + (t.students ? t.students.length : 0), 0);
      const pendingMakeups = teachers.reduce((sum, t) => sum + t.kpis.pendingMakeups, 0);
      const completedMakeups = teachers.reduce((sum, t) => sum + t.kpis.completedMakeups, 0);
      const totalMakeups = pendingMakeups + completedMakeups;
      const makeupCompletionRate = totalMakeups > 0 ? Math.round((completedMakeups / totalMakeups) * 100) : 100;
      const teacherAbsent = teachers.reduce((sum, t) => sum + t.kpis.teacherAbsent, 0);
      const weeklyPendingMakeups = teachers.reduce((sum, t) => sum + t.kpis.weeklyPendingMakeups, 0);
      const avgAbsenceRate = teachers.length > 0
        ? Math.round(teachers.reduce((sum, t) => sum + t.kpis.absenceRate, 0) / teachers.length)
        : 0;
      return { totalStudents, pendingMakeups, completedMakeups, totalMakeups, makeupCompletionRate, teacherAbsent, avgAbsenceRate, weeklyPendingMakeups };
    };

    if (currentUser.role === 'Supervisor') {
      // Supervisor sees only their own branch
      const teachers = await User.find({ role: 'Teacher', supervisor: currentUser._id }).select('name email phone role specialty');
      const allStudents = await Student.find({ teachers: { $in: teachers.map(t => t._id) } }).select('name status teachers initialLevel levelPerProgram');

      const teachersWithData = teachers.map(t => {
        const students = allStudents
          .filter(s => s.teachers.some(tid => tid.toString() === t._id.toString()))
          .map(s => ({ _id: s._id, name: s.name, status: s.status, initialLevel: s.initialLevel || '', levelPerProgram: s.levelPerProgram || '', kpis: studentKPIs(s._id) }));
        return {
          _id: t._id, name: t.name, email: t.email, role: t.role, specialty: t.specialty || '',
          students,
          kpis: teacherKPIs(t._id)
        };
      });

      return res.json({
        success: true,
        data: [{
          _id: currentUser._id,
          name: currentUser.name,
          email: currentUser.email,
          role: 'Supervisor',
          teachers: teachersWithData,
          kpis: supervisorKPIs(teachersWithData)
        }]
      });
    }

    // Admin / GlobalSup: full hierarchy
    const globalSups = await User.find({ role: 'GlobalSup' }).select('name email phone role specialty');
    const supervisors = await User.find({ role: 'Supervisor' }).select('name email phone role supervisor specialty');
    const teachers = await User.find({ role: 'Teacher' }).select('name email phone role supervisor specialty');
    const allStudents = await Student.find({}).select('name status teachers initialLevel levelPerProgram');

    // Helper: build teacher+students data for a supervisor
    const buildTeachersForSup = (supId) => {
      const myTeachers = teachers.filter(t => t.supervisor && t.supervisor.toString() === supId.toString());
      return myTeachers.map(t => {
        const students = allStudents
          .filter(s => s.teachers.some(tid => tid.toString() === t._id.toString()))
          .map(s => ({ _id: s._id, name: s.name, status: s.status, initialLevel: s.initialLevel || '', levelPerProgram: s.levelPerProgram || '', kpis: studentKPIs(s._id) }));
        return { _id: t._id, name: t.name, email: t.email, role: t.role, specialty: t.specialty || '', students, kpis: teacherKPIs(t._id) };
      });
    };

    const result = globalSups.map(gs => {
      // ─── Smart Assignment ─────────────────────────────────────
      // If supervisor.supervisor === gs._id → explicitly assigned
      // If only 1 GlobalSup exists AND supervisor has no supervisor → auto-assign to this GS
      const singleGS = globalSups.length === 1;
      const mySupervisors = supervisors.filter(s => {
        if (s.supervisor && s.supervisor.toString() === gs._id.toString()) return true;
        if (singleGS && !s.supervisor) return true; // auto-assign to single GS
        return false;
      });

      const supervisorsWithData = mySupervisors.map(sup => {
        const teachersWithData = buildTeachersForSup(sup._id);
        return {
          _id: sup._id, name: sup.name, email: sup.email, role: sup.role,
          teachers: teachersWithData,
          kpis: supervisorKPIs(teachersWithData)
        };
      });

      const gsKPIs = supervisorKPIs(supervisorsWithData.flatMap(s => s.teachers));
      return {
        _id: gs._id, name: gs.name, email: gs.email, role: gs.role,
        supervisors: supervisorsWithData,
        kpis: gsKPIs
      };
    });

    // Only add "unassigned" group if multiple GlobalSups exist
    if (globalSups.length > 1) {
      const assignedSupIds = new Set(
        supervisors.filter(s => s.supervisor).map(s => s._id.toString())
      );
      const unassignedSups = supervisors.filter(s => !s.supervisor && !assignedSupIds.has(s._id.toString()));
      if (unassignedSups.length > 0) {
        const teachersWithData = unassignedSups.flatMap(sup => buildTeachersForSup(sup._id));
        result.push({
          _id: 'unassigned',
          name: 'غير مُعيَّن لمشرف عام',
          email: '',
          role: 'GlobalSup',
          supervisors: unassignedSups.map(sup => {
            const t = buildTeachersForSup(sup._id);
            return { _id: sup._id, name: sup.name, email: sup.email, role: sup.role, teachers: t, kpis: supervisorKPIs(t) };
          }),
          kpis: supervisorKPIs(teachersWithData)
        });
      }
    }

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('getHierarchy error:', error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = { register, login, getMe, getUsers, signup, transferTeacher, registerParent, updateUser, getHierarchy };

