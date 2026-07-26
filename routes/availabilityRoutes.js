const express = require('express');
const {
  addAvailability,
  getTeacherAvailability,
  deleteAvailability,
  updateAvailabilityStatus,
  searchMatchingTeachers
} = require('../controllers/availabilityController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.route('/')
  .post(addAvailability)
  .get(getTeacherAvailability);

router.route('/status')
  .put(updateAvailabilityStatus);

router.route('/search-matching')
  .get(restrictTo('Admin', 'GlobalSup', 'Supervisor'), searchMatchingTeachers);

router.route('/:id')
  .delete(deleteAvailability);

module.exports = router;
