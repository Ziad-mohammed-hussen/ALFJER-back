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

// @desc    Update/Replace all schedule slots for a student
// @route   PUT /api/schedule/student/:studentId
// @access  Private
const updateStudentSchedule = async (req, res) => {
  const { studentId } = req.params;
  const { slots, teacherId } = req.body;

  try {
    const targetTeacherId = (['Admin', 'Supervisor', 'GlobalSup'].includes(req.user.role) && teacherId)
      ? teacherId
      : req.user.id;

    // Remove old slots for this student & teacher
    await WeeklySchedule.deleteMany({ student: studentId, teacher: targetTeacherId });

    const createdSlots = [];
    if (slots && Array.isArray(slots) && slots.length > 0) {
      for (const item of slots) {
        if (!item.dayOfWeek || !item.timeSlot) continue;
        const slot = await WeeklySchedule.create({
          teacher: targetTeacherId,
          student: studentId,
          dayOfWeek: item.dayOfWeek,
          timeSlot: item.timeSlot,
          durationMinutes: item.durationMinutes ? Number(item.durationMinutes) : 60,
          subject: 'القرآن الكريم والتجويد'
        });
        createdSlots.push(slot);
      }
    }

    res.json({ success: true, message: 'تم تحديث مواعيد الطالب بنجاح', data: createdSlots });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Request schedule edit for a student (Teacher submits, goes to Pending)
// @route   POST /api/schedule/request-edit
// @access  Private/Teacher
const requestScheduleEdit = async (req, res) => {
  const { studentId, slots, newStudentTimezone, newStudentCountry } = req.body;
  const teacherId = req.user.id;

  try {
    const Student = require('../models/Student');
    const User = require('../models/User');
    const ScheduleEditRequest = require('../models/ScheduleEditRequest');

    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const teacherUser = await User.findById(teacherId);
    const supervisorId = teacherUser ? teacherUser.supervisor : null;

    // Get current old slots
    const currentSlots = await WeeklySchedule.find({ student: studentId, teacher: teacherId });
    const oldSlotsFormatted = currentSlots.map(s => ({
      dayOfWeek: s.dayOfWeek,
      timeSlot: s.timeSlot,
      durationMinutes: s.durationMinutes
    }));

    // If request submitted by Admin or Supervisor directly, auto-approve
    if (['Admin', 'Supervisor', 'GlobalSup'].includes(req.user.role)) {
      await WeeklySchedule.deleteMany({ student: studentId, teacher: teacherId });
      const created = [];
      if (slots && Array.isArray(slots)) {
        for (const item of slots) {
          if (!item.dayOfWeek || !item.timeSlot) continue;
          const s = await WeeklySchedule.create({
            teacher: teacherId,
            student: studentId,
            dayOfWeek: item.dayOfWeek,
            timeSlot: item.timeSlot,
            durationMinutes: item.durationMinutes ? Number(item.durationMinutes) : 60
          });
          created.push(s);
        }
      }
      if (newStudentTimezone) student.timezone = newStudentTimezone;
      if (newStudentCountry) student.country = newStudentCountry;
      await student.save();

      return res.json({ success: true, message: 'تم تحديث جدول الطالب مباشرة بنجاح!', autoApproved: true });
    }

    // Otherwise create Pending ScheduleEditRequest
    const editReq = await ScheduleEditRequest.create({
      student: studentId,
      teacher: teacherId,
      supervisor: supervisorId,
      requestedBy: req.user.id,
      oldScheduleSlots: oldSlotsFormatted,
      newScheduleSlots: slots || [],
      newStudentTimezone: newStudentTimezone || '',
      newStudentCountry: newStudentCountry || '',
      status: 'Pending'
    });

    res.status(201).json({
      success: true,
      data: editReq,
      message: 'تم إرسال طلب تعديل جدول الطالب بنجاح إلى المشرف المسؤول للمراجعة والموافقة!'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get schedule edit requests
// @route   GET /api/schedule/edit-requests
// @access  Private
const getScheduleEditRequests = async (req, res) => {
  try {
    const ScheduleEditRequest = require('../models/ScheduleEditRequest');
    const User = require('../models/User');

    let filter = {};
    if (req.user.role === 'Teacher') {
      filter.teacher = req.user.id;
    } else if (req.user.role === 'Supervisor') {
      const supervisedTeachers = await User.find({ supervisor: req.user.id, role: 'Teacher' });
      const teacherIds = supervisedTeachers.map(t => t._id);
      filter.$or = [
        { supervisor: req.user.id },
        { teacher: { $in: teacherIds } }
      ];
    }

    const requests = await ScheduleEditRequest.find(filter)
      .populate('student', 'name country timezone')
      .populate('teacher', 'name email')
      .populate('requestedBy', 'name role')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: requests.length, data: requests });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Resolve (Approve / Reject) schedule edit request
// @route   POST /api/schedule/edit-requests/:id/resolve
// @access  Private (Supervisor / Admin / GlobalSup)
const resolveScheduleEditRequest = async (req, res) => {
  const { status, rejectionReason } = req.body;
  try {
    const ScheduleEditRequest = require('../models/ScheduleEditRequest');
    const Student = require('../models/Student');

    const editReq = await ScheduleEditRequest.findById(req.params.id);
    if (!editReq) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (editReq.status !== 'Pending') {
      return res.status(400).json({ message: 'تم البت في هذا الطلب مسبقاً.' });
    }

    if (status === 'Approved') {
      editReq.status = 'Approved';
      editReq.resolvedAt = new Date();
      await editReq.save();

      // Apply changes to WeeklySchedule
      await WeeklySchedule.deleteMany({ student: editReq.student, teacher: editReq.teacher });
      if (editReq.newScheduleSlots && editReq.newScheduleSlots.length > 0) {
        for (const item of editReq.newScheduleSlots) {
          if (!item.dayOfWeek || !item.timeSlot) continue;
          await WeeklySchedule.create({
            teacher: editReq.teacher,
            student: editReq.student,
            dayOfWeek: item.dayOfWeek,
            timeSlot: item.timeSlot,
            durationMinutes: item.durationMinutes ? Number(item.durationMinutes) : 60
          });
        }
      }

      // Update student timezone/country if provided
      const studentObj = await Student.findById(editReq.student);
      if (studentObj) {
        if (editReq.newStudentTimezone) studentObj.timezone = editReq.newStudentTimezone;
        if (editReq.newStudentCountry) studentObj.country = editReq.newStudentCountry;
        await studentObj.save();
      }

      return res.json({ success: true, message: 'تمت الموافقة وتحديث جدول الطالب بنجاح!', data: editReq });
    } else if (status === 'Rejected') {
      editReq.status = 'Rejected';
      editReq.rejectionReason = rejectionReason || 'تم رفض التعديل بواسطة المشرف.';
      editReq.resolvedAt = new Date();
      await editReq.save();

      return res.json({ success: true, message: 'تم رفض طلب تعديل المواعيد.', data: editReq });
    } else {
      return res.status(400).json({ message: 'حالة غير صالحة' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getSchedule,
  addScheduleSlot,
  deleteScheduleSlot,
  updateStudentSchedule,
  requestScheduleEdit,
  getScheduleEditRequests,
  resolveScheduleEditRequest
};
