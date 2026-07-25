const express = require('express');
const {
  saveReport,
  getReports,
  getStudentTimeline,
  getTeacherMonthlyPerformance,
  saveLeadSource,
  getLeadSources,
  getMonthlyDeficit,
  getTeacherWeeklySchedule
} = require('../controllers/reportController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

router.route('/')
  .post(protect, restrictTo('Teacher'), saveReport)
  .get(protect, getReports);

// Student monthly timeline (all roles can view based on access control in controller)
router.get('/student/:studentId/timeline', protect, getStudentTimeline);

// Teacher monthly performance (Teacher sees own, Admin/Supervisor/GlobalSup pass teacherId)
router.get('/teacher-performance', protect, getTeacherMonthlyPerformance);

// Monthly deficit/surplus calculator for a student
router.get('/monthly-deficit/:studentId', protect, getMonthlyDeficit);

// Weekly schedule and actual hours taught spreadsheet for a teacher
router.get('/weekly-schedule/:teacherId', protect, getTeacherWeeklySchedule);

// Admin-only lead sources
router.route('/leads')
  .post(protect, restrictTo('Admin'), saveLeadSource)
  .get(protect, restrictTo('Admin'), getLeadSources);

module.exports = router;

