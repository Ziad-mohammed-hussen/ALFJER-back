const express = require('express');
const { saveReport, getReports, saveLeadSource, getLeadSources } = require('../controllers/reportController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

router.route('/')
  .post(protect, restrictTo('Teacher'), saveReport)
  .get(protect, getReports);

// Admin-only lead sources
router.route('/leads')
  .post(protect, restrictTo('Admin'), saveLeadSource)
  .get(protect, restrictTo('Admin'), getLeadSources);

module.exports = router;
