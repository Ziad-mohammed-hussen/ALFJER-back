const express = require('express');
const { getSchedule, addScheduleSlot, deleteScheduleSlot, updateStudentSchedule } = require('../controllers/weeklyScheduleController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

router.route('/')
  .get(protect, getSchedule)
  .post(protect, restrictTo('Teacher'), addScheduleSlot);

router.route('/student/:studentId')
  .put(protect, updateStudentSchedule);

router.route('/:id')
  .delete(protect, restrictTo('Teacher'), deleteScheduleSlot);

module.exports = router;
