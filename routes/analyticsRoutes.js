const express = require('express');
const { getTeacherPerformance, getSeasonalAnalytics } = require('../controllers/analyticsController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/teachers', protect, restrictTo('Admin', 'GlobalSup'), getTeacherPerformance);
router.get('/seasonal', protect, restrictTo('Admin'), getSeasonalAnalytics);

module.exports = router;
