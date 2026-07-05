const express = require('express');
const { logPause, resumeStudent, getPauses } = require('../controllers/pauseController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

router.route('/')
  .post(protect, restrictTo('Supervisor', 'Admin', 'GlobalSup'), logPause)
  .get(protect, restrictTo('Supervisor', 'Admin', 'GlobalSup'), getPauses);

router.post('/:id/resume', protect, restrictTo('Supervisor', 'Admin', 'GlobalSup'), resumeStudent);

module.exports = router;
