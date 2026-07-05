const express = require('express');
const { getLeads, createLead } = require('../controllers/leadController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

router.route('/')
  .get(protect, restrictTo('Admin'), getLeads)
  .post(protect, restrictTo('Admin'), createLead);

module.exports = router;
