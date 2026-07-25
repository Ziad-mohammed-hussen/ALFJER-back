const express = require('express');
const { logPause, resumeStudent, getPauses, resumeStudentByStudentId } = require('../controllers/pauseController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

router.route('/')
  .post(protect, restrictTo('Supervisor', 'Admin', 'GlobalSup', 'Teacher'), logPause)
  .get(protect, restrictTo('Supervisor', 'Admin', 'GlobalSup', 'Teacher'), getPauses);

router.post('/:id/resume', protect, restrictTo('Supervisor', 'Admin', 'GlobalSup', 'Teacher'), resumeStudent);

router.post('/student/:studentId/resume', protect, restrictTo('Supervisor', 'Admin', 'GlobalSup', 'Teacher'), resumeStudentByStudentId);

module.exports = router;
