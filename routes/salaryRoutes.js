const express = require('express');
const { generateSalary, getSalaries, paySalary } = require('../controllers/salaryController');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/generate', protect, restrictTo('Admin'), generateSalary);
router.get('/', protect, restrictTo('Admin', 'Teacher'), getSalaries);
router.put('/:id/pay', protect, restrictTo('Admin'), paySalary);

module.exports = router;
