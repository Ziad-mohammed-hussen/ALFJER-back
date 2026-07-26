const express = require('express');
const { register, login, getMe, getUsers, signup, transferTeacher, registerParent, updateUser, getHierarchy, seedUsers } = require('../controllers/authController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/seed', seedUsers);
router.post('/login', login);
router.post('/signup', signup);
router.post('/register', protect, restrictTo('Admin'), register);
router.post('/register-parent', protect, restrictTo('Admin', 'GlobalSup', 'Supervisor'), registerParent);
router.post('/transfer-teacher', protect, restrictTo('Admin', 'GlobalSup'), transferTeacher);
router.get('/me', protect, getMe);
router.get('/users', protect, restrictTo('Admin', 'GlobalSup', 'Supervisor'), getUsers);
router.put('/users/:id', protect, restrictTo('Admin', 'GlobalSup'), updateUser);
router.get('/hierarchy', protect, restrictTo('Admin', 'GlobalSup', 'Supervisor'), getHierarchy);

module.exports = router;
