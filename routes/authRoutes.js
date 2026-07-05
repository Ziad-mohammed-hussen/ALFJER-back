const express = require('express');
const { register, login, getMe, getUsers, signup, transferTeacher } = require('../controllers/authController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/login', login);
router.post('/signup', signup);
router.post('/register', protect, restrictTo('Admin'), register);
router.post('/transfer-teacher', protect, restrictTo('Admin', 'GlobalSup'), transferTeacher);
router.get('/me', protect, getMe);
router.get('/users', protect, restrictTo('Admin', 'GlobalSup', 'Supervisor'), getUsers);

module.exports = router;
