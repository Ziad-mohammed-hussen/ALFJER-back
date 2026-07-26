const express = require('express');
const {
  getSchedule,
  addScheduleSlot,
  deleteScheduleSlot,
  updateStudentSchedule,
  requestScheduleEdit,
  getScheduleEditRequests,
  resolveScheduleEditRequest
} = require('../controllers/weeklyScheduleController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

router.route('/')
  .get(protect, getSchedule)
  .post(protect, restrictTo('Teacher'), addScheduleSlot);

router.post('/request-edit', protect, requestScheduleEdit);
router.get('/edit-requests', protect, getScheduleEditRequests);
router.post('/edit-requests/:id/resolve', protect, restrictTo('Supervisor', 'Admin', 'GlobalSup'), resolveScheduleEditRequest);

router.route('/student/:studentId')
  .put(protect, updateStudentSchedule);

router.route('/:id')
  .delete(protect, restrictTo('Teacher'), deleteScheduleSlot);

module.exports = router;
