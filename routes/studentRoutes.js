const express = require('express');
const { getStudents, createStudent, getStudent, setPricing, getPricing, checkStudentExists } = require('../controllers/studentController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

// Check existence before create
router.get('/check', protect, restrictTo('Admin', 'GlobalSup', 'Supervisor'), checkStudentExists);

router.route('/')
  .get(protect, getStudents)
  .post(protect, restrictTo('Admin', 'GlobalSup', 'Supervisor'), createStudent);

router.get('/:id', protect, getStudent);

// Pricing endpoints (Admin + GlobalSup)
router.post('/pricing', protect, restrictTo('Admin', 'GlobalSup'), setPricing);
router.get('/pricing/:studentId', protect, restrictTo('Admin', 'GlobalSup'), getPricing);

module.exports = router;
