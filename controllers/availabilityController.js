const TeacherAvailability = require('../models/TeacherAvailability');
const User = require('../models/User');
const Student = require('../models/Student');

// ── Timezone Offsets relative to Egypt (EET / UTC+2) ────────
const TIMEZONE_OFFSETS_FROM_EGYPT = {
  // US Timezones
  'US-EST': -7, // New York, Florida, NC, VA, MA, PA (EST UTC-5 vs Egypt UTC+2)
  'US-CST': -8, // Texas, Illinois, Chicago, MN, MO (CST UTC-6 vs Egypt UTC+2)
  'US-MST': -9, // Colorado, Arizona, Utah (MST UTC-7 vs Egypt UTC+2)
  'US-PST': -10, // California, Washington, Oregon (PST UTC-8 vs Egypt UTC+2)
  
  // Arab / Gulf Timezones
  'SAUDI-AST': 1, // Saudi Arabia, Kuwait, Qatar (UTC+3 vs Egypt UTC+2)
  'UAE-GST': 2,   // UAE, Oman (UTC+4 vs Egypt UTC+2)
  'JORDAN-EET': 0,// Jordan, Palestine, Lebanon (UTC+2)
  
  // Europe / UK Timezones
  'UK-GMT': -2,   // London (UTC+0 vs Egypt UTC+2)
  'EU-CET': -1,   // Germany, France, Italy (UTC+1 vs Egypt UTC+2)
  'EGY-EET': 0    // Egypt (UTC+2)
};

// @desc    Add availability slot for teacher
// @route   POST /api/availability
// @access  Private (Teacher / Admin / Supervisor)
const addAvailability = async (req, res) => {
  try {
    const { teacherId, dayOfWeek, timeSlot, durationMinutes, isPermanent, specificDate, notes } = req.body;
    
    // Default to logged-in user if teacher role
    const targetTeacherId = req.user.role === 'Teacher' ? req.user.id : (teacherId || req.user.id);

    const slotData = {
      teacher: targetTeacherId,
      dayOfWeek,
      timeSlot,
      durationMinutes: durationMinutes || 60,
      isPermanent: isPermanent !== undefined ? isPermanent : true,
      specificDate: specificDate || null,
      notes: notes || ''
    };

    const slot = await TeacherAvailability.create(slotData);
    res.status(201).json({ success: true, data: slot });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get availability slots for teacher
// @route   GET /api/availability/my?teacherId=...
// @access  Private (Teacher / Admin / Supervisor / GlobalSup)
const getTeacherAvailability = async (req, res) => {
  try {
    let targetTeacherId = req.user.id;
    if (['Admin', 'GlobalSup', 'Supervisor'].includes(req.user.role) && req.query.teacherId) {
      targetTeacherId = req.query.teacherId;
    }

    const slots = await TeacherAvailability.find({ teacher: targetTeacherId })
      .sort({ dayOfWeek: 1, timeSlot: 1 });

    const teacherUser = await User.findById(targetTeacherId)
      .select('name isAvailableForNewStudents availabilityStatusNote specialty');

    res.json({
      success: true,
      teacher: teacherUser,
      data: slots
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete availability slot
// @route   DELETE /api/availability/:id
// @access  Private (Teacher / Admin / Supervisor)
const deleteAvailability = async (req, res) => {
  try {
    const slot = await TeacherAvailability.findById(req.params.id);
    if (!slot) {
      return res.status(404).json({ message: 'Availability slot not found' });
    }

    // Check ownership if teacher
    if (req.user.role === 'Teacher' && slot.teacher.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await slot.deleteOne();
    res.json({ success: true, message: 'Slot deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update teacher seeking students status & note
// @route   PUT /api/availability/status
// @access  Private (Teacher / Admin / Supervisor)
const updateAvailabilityStatus = async (req, res) => {
  try {
    const { isAvailableForNewStudents, availabilityStatusNote, teacherId } = req.body;
    const targetTeacherId = req.user.role === 'Teacher' ? req.user.id : (teacherId || req.user.id);

    const user = await User.findById(targetTeacherId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (isAvailableForNewStudents !== undefined) {
      user.isAvailableForNewStudents = isAvailableForNewStudents;
    }
    if (availabilityStatusNote !== undefined) {
      user.availabilityStatusNote = availabilityStatusNote;
    }

    await user.save();
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Smart Search: Find matching available teachers by student state/timezone, day, and time
// @route   GET /api/availability/search-matching
// @access  Private (Admin / GlobalSup / Supervisor)
const searchMatchingTeachers = async (req, res) => {
  try {
    const { timezoneKey, dayOfWeek, timeSlotStudent } = req.query;

    if (!timezoneKey || !dayOfWeek || !timeSlotStudent) {
      return res.status(400).json({ message: 'timezoneKey, dayOfWeek, and timeSlotStudent are required' });
    }

    // 1. Calculate Egypt Equivalent Time
    const offsetHours = TIMEZONE_OFFSETS_FROM_EGYPT[timezoneKey] || 0;
    
    // Parse student time HH:MM
    const [stHourStr, stMinStr] = timeSlotStudent.split(':');
    let stHour = parseInt(stHourStr, 10);
    let stMin = parseInt(stMinStr, 10);

    // Convert Student Local Time to Egypt Time (EGY = StudentTime - Offset)
    // Example: Student EST (Offset -7) at 10:00 AM -> Egypt Time = 10 - (-7) = 17:00 (05:00 PM EGY)
    let egyHour = stHour - offsetHours;
    let dayShift = 0;

    if (egyHour >= 24) {
      egyHour -= 24;
      dayShift = 1; // Shifts to next day
    } else if (egyHour < 0) {
      egyHour += 24;
      dayShift = -1; // Shifts to previous day
    }

    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let targetDayIndex = DAY_NAMES.indexOf(dayOfWeek);
    if (dayShift !== 0) {
      targetDayIndex = (targetDayIndex + dayShift + 7) % 7;
    }
    const egyDayOfWeek = DAY_NAMES[targetDayIndex];

    const egyTimeSlot = `${String(egyHour).padStart(2, '0')}:${String(stMin).padStart(2, '0')}`;

    // 2. Find matching availability slots
    const matchingSlots = await TeacherAvailability.find({
      dayOfWeek: egyDayOfWeek,
      timeSlot: egyTimeSlot
    }).populate({
      path: 'teacher',
      select: 'name email phone specialty isAvailableForNewStudents availabilityStatusNote supervisor'
    });

    // 3. Enhance results with student counts and status badges
    const teacherIds = matchingSlots.map(s => s.teacher?._id).filter(Boolean);
    const teacherStudents = await Student.find({
      teachers: { $in: teacherIds },
      status: 'Active'
    }).select('teachers');

    const results = matchingSlots.map(slot => {
      const teacher = slot.teacher;
      const activeStudentsCount = teacherStudents.filter(s =>
        s.teachers.some(tId => tId.toString() === teacher._id.toString())
      ).length;

      return {
        slotId: slot._id,
        teacher: {
          _id: teacher._id,
          name: teacher.name,
          email: teacher.email,
          phone: teacher.phone,
          specialty: teacher.specialty || 'القرآن الكريم والتجويد',
          isAvailableForNewStudents: teacher.isAvailableForNewStudents,
          availabilityStatusNote: teacher.availabilityStatusNote,
          activeStudentsCount
        },
        dayOfWeek: slot.dayOfWeek,
        timeSlotEgy: slot.timeSlot,
        durationMinutes: slot.durationMinutes,
        isPermanent: slot.isPermanent,
        notes: slot.notes,
        timeConversionInfo: {
          studentStateTimezone: timezoneKey,
          studentLocalTime: timeSlotStudent,
          studentDay: dayOfWeek,
          egyptTeacherTime: egyTimeSlot,
          egyptDay: egyDayOfWeek,
          offsetHours
        }
      };
    });

    // Sort: Available & seeking students first
    results.sort((a, b) => (b.teacher.isAvailableForNewStudents ? 1 : 0) - (a.teacher.isAvailableForNewStudents ? 1 : 0));

    res.json({
      success: true,
      query: {
        timezoneKey,
        dayOfWeek,
        timeSlotStudent,
        calculatedEgyptTime: egyTimeSlot,
        calculatedEgyptDay: egyDayOfWeek
      },
      count: results.length,
      data: results
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  addAvailability,
  getTeacherAvailability,
  deleteAvailability,
  updateAvailabilityStatus,
  searchMatchingTeachers,
  TIMEZONE_OFFSETS_FROM_EGYPT
};
