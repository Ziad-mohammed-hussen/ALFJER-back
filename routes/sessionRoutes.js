const express = require('express');
const {
  logSession,
  getSessions,
  getPendingMakeups,
  getMakeupDashboardStats,
  scheduleMakeup,
  submitMakeupDifficulty,
  approveSession,
  updateSessionDirect,
  requestSessionEdit,
  getSessionEditRequests,
  resolveSessionEditRequest,
  lockMonth,
  cancelMakeup
} = require('../controllers/sessionController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

router.route('/')
  .post(protect, restrictTo('Teacher', 'Admin'), logSession)
  .get(protect, getSessions);

router.post('/lock-month', protect, restrictTo('Admin'), lockMonth);
router.get('/edit-requests', protect, restrictTo('Admin', 'Supervisor', 'GlobalSup'), getSessionEditRequests);
router.post('/edit-requests/:id/resolve', protect, restrictTo('Admin', 'Supervisor', 'GlobalSup'), resolveSessionEditRequest);

router.get('/makeups', protect, getPendingMakeups);
router.get('/makeups/dashboard', protect, getMakeupDashboardStats);
router.post('/:id/makeup', protect, scheduleMakeup);
router.post('/:id/difficulty', protect, restrictTo('Teacher'), submitMakeupDifficulty);
router.post('/:id/approve', protect, restrictTo('Supervisor', 'Admin', 'GlobalSup'), approveSession);
router.post('/:id/cancel-makeup', protect, restrictTo('Supervisor', 'Admin', 'GlobalSup'), cancelMakeup);
router.post('/:id/request-edit', protect, restrictTo('Teacher'), requestSessionEdit);
router.put('/:id', protect, restrictTo('Teacher'), updateSessionDirect);

module.exports = router;
