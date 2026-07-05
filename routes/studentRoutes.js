const express = require('express');
const { getStudents, createStudent, getStudent, setPricing, getPricing } = require('../controllers/studentController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

router.route('/')
  .get(protect, getStudents)
  .post(protect, restrictTo('Admin', 'GlobalSup', 'Supervisor'), createStudent);

router.get('/:id', protect, getStudent);

// Pricing endpoints (Admin only)
router.post('/pricing', protect, restrictTo('Admin'), setPricing);
router.get('/pricing/:studentId', protect, restrictTo('Admin'), getPricing);

module.exports = router;
