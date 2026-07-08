const jwt = require('jsonwebtoken');
const User = require('../models/User');

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
  const { name, email, password, role, phone, supervisor, parentOf } = req.body;

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
      supervisor,
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
  const { name, email, password, phone, notes } = req.body;

  try {
    // Check if already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: `ولي الأمر بهذا البريد "${email}" موجود بالفعل في النظام.` });
    }

    const user = await User.create({
      name,
      email,
      password: password || 'parent123',
      role: 'Parent',
      phone: phone || ''
    });

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

// @desc    Update user info (email / phone / name)
// @route   PUT /api/auth/users/:id
// @access  Private/Admin/GlobalSup
const updateUser = async (req, res) => {
  const { name, email, phone } = req.body;
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name, email, phone },
      { new: true, runValidators: true }
    );
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ success: true, data: user, message: 'تم تحديث بيانات المستخدم بنجاح.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { register, login, getMe, getUsers, signup, transferTeacher, registerParent, updateUser };
