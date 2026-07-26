const WeeklySchedule = require('../models/WeeklySchedule');

// @desc    Get weekly schedule slots (Teacher can get their own; Admin/Supervisor can get a teacher's schedule)
// @route   GET /api/schedule
// @access  Private
const getSchedule = async (req, res) => {
  try {
    let teacherId = req.user.id;
    if ((req.user.role === 'Admin' || req.user.role === 'Supervisor' || req.user.role === 'GlobalSup') && req.query.teacherId) {
      teacherId = req.query.teacherId;
    }
    const schedule = await WeeklySchedule.find({ teacher: teacherId })
      .populate('student', 'name')
      .sort({ dayOfWeek: 1, timeSlot: 1 });

    res.json({ success: true, data: schedule });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Add one or multiple slots to weekly schedule (Teacher only)
// @route   POST /api/schedule
// @access  Private/Teacher
const addScheduleSlot = async (req, res) => {
  const { dayOfWeek, daysOfWeek, timeSlot, studentId, subject, durationMinutes } = req.body;
  try {
    const daysToCreate = daysOfWeek && Array.isArray(daysOfWeek) && daysOfWeek.length > 0 
      ? daysOfWeek 
      : (dayOfWeek ? [dayOfWeek] : []);

    if (daysToCreate.length === 0) {
      return res.status(400).json({ message: 'يرجى اختيار يوم واحد على الأقل' });
    }

    const createdSlots = [];
    for (const day of daysToCreate) {
      const slot = await WeeklySchedule.create({
        teacher: req.user.id,
        dayOfWeek: day,
        timeSlot,
        student: studentId,
        subject: subject || 'القرآن الكريم والتجويد',
        durationMinutes: durationMinutes ? Number(durationMinutes) : 60
      });
      createdSlots.push(slot);
    }
    res.status(201).json({ success: true, data: createdSlots.length === 1 ? createdSlots[0] : createdSlots });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete a slot from weekly schedule (Teacher only)
// @route   DELETE /api/schedule/:id
// @access  Private/Teacher
const deleteScheduleSlot = async (req, res) => {
  try {
    const slot = await WeeklySchedule.findById(req.params.id);
    if (!slot || slot.teacher.toString() !== req.user.id) {
      return res.status(404).json({ message: 'Schedule slot not found or unauthorized' });
    }
    await slot.deleteOne();
    res.json({ success: true, message: 'Slot deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getSchedule, addScheduleSlot, deleteScheduleSlot };
