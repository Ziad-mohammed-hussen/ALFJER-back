const express = require('express');
const { getExportOverview, exportUsers } = require('../controllers/exportController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

// Both routes are strictly restricted to Admin (Read-Only operations)
router.get('/overview', protect, restrictTo('Admin'), getExportOverview);
router.post('/download', protect, restrictTo('Admin'), exportUsers);

module.exports = router;
