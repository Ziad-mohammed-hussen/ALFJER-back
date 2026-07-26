const express = require('express');
const { getStudents, createStudent, getStudent, setPricing, getPricing, getAllPricing, checkStudentExists, updateStudent, deleteStudent } = require('../controllers/studentController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

// Check existence before create
router.get('/check', protect, restrictTo('Admin', 'GlobalSup', 'Supervisor'), checkStudentExists);

router.route('/')
  .get(protect, getStudents)
  .post(protect, restrictTo('Admin', 'GlobalSup', 'Supervisor', 'Teacher'), createStudent);

router.route('/:id')
  .get(protect, getStudent)
  .put(protect, restrictTo('Admin', 'GlobalSup', 'Supervisor', 'Teacher'), updateStudent)
  .delete(protect, restrictTo('Admin', 'GlobalSup', 'Supervisor'), deleteStudent);

// Pricing endpoints (Admin + GlobalSup)
router.get('/pricing/all', protect, restrictTo('Admin', 'GlobalSup'), getAllPricing);
router.post('/pricing', protect, restrictTo('Admin', 'GlobalSup'), setPricing);
router.get('/pricing/:studentId', protect, restrictTo('Admin', 'GlobalSup'), getPricing);

module.exports = router;
