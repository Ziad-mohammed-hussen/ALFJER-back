const User = require('../models/User');
const Student = require('../models/Student');
const Pricing = require('../models/Pricing');
const TeacherAvailability = require('../models/TeacherAvailability');
const StudentPause = require('../models/StudentPause');
const WeeklySchedule = require('../models/WeeklySchedule');
const Session = require('../models/Session');
const SessionEditRequest = require('../models/SessionEditRequest');
const ScheduleEditRequest = require('../models/ScheduleEditRequest');
const Invoice = require('../models/Invoice');
const Salary = require('../models/Salary');
const MonthlyReport = require('../models/MonthlyReport');
const LeadSource = require('../models/LeadSource');

// Helper to split full name into firstName and lastName for destination schema compatibility
const splitName = (fullName) => {
  if (!fullName) return { firstName: '', lastName: '' };
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || '';
  return { firstName, lastName };
};

// Helper to safely extract and verify password hash (strictly bcrypt only)
const extractSafePasswordHash = (rawPassword) => {
  if (!rawPassword || typeof rawPassword !== 'string') return null;
  // Standard bcrypt prefixes: $2a$, $2b$, $2y$, $2x$
  if (rawPassword.startsWith('$2')) {
    return rawPassword;
  }
  // If plain text or unrecognized format, DO NOT export it or log it
  return null;
};

// @desc    Get overview of users for export panel (Strictly Read-Only, NO PASSWORDS in UI)
// @route   GET /api/export/overview
// @access  Private/Admin
const getExportOverview = async (req, res) => {
  try {
    // 1. Fetch Supervisors (excluding sensitive fields)
    const supervisors = await User.find({ role: { $in: ['Supervisor', 'GlobalSup'] } })
      .select('_id name email role phone specialty isActive createdAt')
      .lean();

    // 2. Fetch Teachers (excluding sensitive fields)
    const teachers = await User.find({ role: 'Teacher' })
      .select('_id name email role phone specialty supervisor defaultHourlyRate defaultCurrency isActive isAvailableForNewStudents createdAt')
      .populate('supervisor', 'name email role')
      .lean();

    // 3. Fetch Students with teachers and parent
    const students = await Student.find()
      .select('_id name age language country timezone status programs programLevels programBooks customProgram scheduleSlots sessionDurationMinutes teachers parent joinedAt photoUrl')
      .populate('teachers', 'name email specialty')
      .populate('parent', 'name email phone')
      .lean();

    // 4. Map relationships for UI presentation
    const teacherStudentMap = {};
    teachers.forEach(t => {
      teacherStudentMap[t._id.toString()] = [];
    });

    students.forEach(s => {
      if (Array.isArray(s.teachers)) {
        s.teachers.forEach(t => {
          const tId = (t._id || t).toString();
          if (teacherStudentMap[tId]) {
            teacherStudentMap[tId].push({
              _id: s._id,
              name: s.name,
              age: s.age,
              country: s.country,
              status: s.status,
              programs: s.programs,
              scheduleSlotsCount: (s.scheduleSlots || []).length
            });
          }
        });
      }
    });

    const enrichedTeachers = teachers.map(t => {
      const studentList = teacherStudentMap[t._id.toString()] || [];
      return {
        ...t,
        studentCount: studentList.length,
        students: studentList
      };
    });

    const supervisorTeacherMap = {};
    supervisors.forEach(s => {
      supervisorTeacherMap[s._id.toString()] = [];
    });

    teachers.forEach(t => {
      if (t.supervisor) {
        const sId = (t.supervisor._id || t.supervisor).toString();
        if (supervisorTeacherMap[sId]) {
          supervisorTeacherMap[sId].push({
            _id: t._id,
            name: t.name,
            email: t.email
          });
        }
      }
    });

    const enrichedSupervisors = supervisors.map(s => {
      const tList = supervisorTeacherMap[s._id.toString()] || [];
      return {
        ...s,
        teacherCount: tList.length,
        teachers: tList
      };
    });

    res.json({
      success: true,
      data: {
        supervisors: enrichedSupervisors,
        teachers: enrichedTeachers,
        students: students.map(s => ({
          ...s,
          teacherNames: (s.teachers || []).map(t => t.name).join(', ') || 'بدون معلم',
          parentName: s.parent?.name || 'بدون ولي أمر'
        })),
        stats: {
          totalSupervisors: enrichedSupervisors.length,
          totalTeachers: enrichedTeachers.length,
          totalStudents: students.length,
          totalPricings: await Pricing.countDocuments(),
          totalSessions: await Session.countDocuments(),
          pendingMakeupSessions: await Session.countDocuments({ makeupStatus: 'Pending' }),
          sessionsAwaitingApproval: await Session.countDocuments({ isApprovedBySupervisor: false }),
          pendingSessionEditRequests: await SessionEditRequest.countDocuments({ status: 'Pending' }),
          pendingScheduleEditRequests: await ScheduleEditRequest.countDocuments({ status: 'Pending' }),
          totalInvoices: await Invoice.countDocuments(),
          unpaidInvoices: await Invoice.countDocuments({ paymentStatus: 'Unpaid' }),
          totalSalaries: await Salary.countDocuments(),
          unpaidSalaries: await Salary.countDocuments({ payoutStatus: 'Unpaid' }),
          totalMonthlyReports: await MonthlyReport.countDocuments(),
          totalLeadSources: await LeadSource.countDocuments(),
          totalStudentPauses: await StudentPause.countDocuments(),
          totalWeeklySchedules: await WeeklySchedule.countDocuments(),
          totalAvailabilitySlots: await TeacherAvailability.countDocuments()
        }
      }
    });
  } catch (error) {
    console.error('Export Overview Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Full Account & Relational Export for cross-academy migration
// @route   POST /api/export/download
// @access  Private/Admin
const exportUsers = async (req, res) => {
  try {
    const {
      exportType = 'selected', // 'selected' | 'teacher_students' | 'all_teachers_students' | 'supervisors' | 'all'
      teacherIds = [],
      studentIds = [],
      supervisorIds = [],
      includeRelatedStudents = true,
      includeParents = true,
      includePricings = true,
      includeAvailability = true,
      includeWeeklySchedules = true,
      includePauses = true,
      format = 'json' // 'json' | 'csv'
    } = req.body;

    let targetTeacherIds = new Set(teacherIds.map(id => id.toString()));
    let targetStudentIds = new Set(studentIds.map(id => id.toString()));
    let targetSupervisorIds = new Set(supervisorIds.map(id => id.toString()));

    // 1. Resolve sets based on exportType
    if (exportType === 'all') {
      const allSupervisors = await User.find({ role: { $in: ['Supervisor', 'GlobalSup'] } }).select('_id').lean();
      const allTeachers = await User.find({ role: 'Teacher' }).select('_id').lean();
      const allStudents = await Student.find().select('_id').lean();

      allSupervisors.forEach(s => targetSupervisorIds.add(s._id.toString()));
      allTeachers.forEach(t => targetTeacherIds.add(t._id.toString()));
      allStudents.forEach(s => targetStudentIds.add(s._id.toString()));
    } else if (exportType === 'all_teachers_students') {
      const allTeachers = await User.find({ role: 'Teacher' }).select('_id').lean();
      const allStudents = await Student.find().select('_id').lean();

      allTeachers.forEach(t => targetTeacherIds.add(t._id.toString()));
      allStudents.forEach(s => targetStudentIds.add(s._id.toString()));
    } else if (exportType === 'supervisors') {
      const allSupervisors = await User.find({ role: { $in: ['Supervisor', 'GlobalSup'] } }).select('_id').lean();
      allSupervisors.forEach(s => targetSupervisorIds.add(s._id.toString()));
    } else if (exportType === 'teacher_students' || includeRelatedStudents) {
      if (targetTeacherIds.size > 0) {
        const relatedStudents = await Student.find({
          teachers: { $in: Array.from(targetTeacherIds) }
        }).select('_id').lean();

        relatedStudents.forEach(s => targetStudentIds.add(s._id.toString()));
      }
    }

    // 2. Fetch Selected Supervisors WITH passwordHash (Strictly Read-Only)
    let supervisorsData = [];
    if (targetSupervisorIds.size > 0) {
      const sups = await User.find({
        _id: { $in: Array.from(targetSupervisorIds) }
      })
        .select('+password')
        .lean();

      // Find teachers assigned to these supervisors
      const supervisedTeachers = await User.find({
        supervisor: { $in: Array.from(targetSupervisorIds) }
      }).select('_id supervisor').lean();

      const supTeacherMap = {};
      supervisedTeachers.forEach(st => {
        const sId = st.supervisor.toString();
        if (!supTeacherMap[sId]) supTeacherMap[sId] = [];
        supTeacherMap[sId].push(st._id.toString());
      });

      supervisorsData = sups.map(s => {
        const names = splitName(s.name);
        const pHash = extractSafePasswordHash(s.password);

        return {
          originalId: s._id.toString(),
          name: s.name,
          firstName: names.firstName,
          lastName: names.lastName,
          email: s.email,
          passwordHash: pHash,
          role: s.role, // 'Supervisor' | 'GlobalSup'
          phone: s.phone || '',
          specialty: s.specialty || '',
          supervisedTeacherOriginalIds: supTeacherMap[s._id.toString()] || [],
          isActive: s.isActive !== false,
          createdAt: s.createdAt
        };
      });
    }

    // 3. Fetch Selected Teachers WITH passwordHash and full profile data
    let teachersData = [];
    let availabilitySlotsData = [];
    if (targetTeacherIds.size > 0) {
      const teachers = await User.find({
        _id: { $in: Array.from(targetTeacherIds) }
      })
        .select('+password')
        .populate('supervisor', 'name email role')
        .lean();

      // Find availability slots if requested
      let availabilityMap = {};
      if (includeAvailability) {
        const avSlots = await TeacherAvailability.find({
          teacher: { $in: Array.from(targetTeacherIds) }
        }).lean();

        avSlots.forEach(slot => {
          const tId = slot.teacher.toString();
          if (!availabilityMap[tId]) availabilityMap[tId] = [];
          const slotItem = {
            teacherOriginalId: tId,
            dayOfWeek: slot.dayOfWeek,
            timeSlot: slot.timeSlot,
            durationMinutes: slot.durationMinutes || 60,
            isPermanent: slot.isPermanent !== false,
            specificDate: slot.specificDate || null,
            notes: slot.notes || '',
            createdAt: slot.createdAt
          };
          availabilityMap[tId].push(slotItem);
          availabilitySlotsData.push(slotItem);
        });
      }

      // Map assigned students for each teacher
      const teacherAssignedStudents = await Student.find({
        teachers: { $in: Array.from(targetTeacherIds) }
      }).select('_id teachers').lean();

      const tAssignedMap = {};
      teacherAssignedStudents.forEach(st => {
        (st.teachers || []).forEach(t => {
          const tId = (t._id || t).toString();
          if (!tAssignedMap[tId]) tAssignedMap[tId] = [];
          tAssignedMap[tId].push(st._id.toString());
        });
      });

      teachersData = teachers.map(t => {
        const names = splitName(t.name);
        const pHash = extractSafePasswordHash(t.password);

        return {
          originalId: t._id.toString(),
          name: t.name,
          firstName: names.firstName,
          lastName: names.lastName,
          email: t.email,
          passwordHash: pHash,
          role: t.role, // 'Teacher'
          phone: t.phone || '',
          specialty: t.specialty || '',
          supervisorOriginalId: t.supervisor ? (t.supervisor._id || t.supervisor).toString() : null,
          supervisor: t.supervisor ? {
            originalId: (t.supervisor._id || t.supervisor).toString(),
            name: t.supervisor.name,
            email: t.supervisor.email,
            role: t.supervisor.role
          } : null,
          defaultHourlyRate: t.defaultHourlyRate ?? null,
          defaultCurrency: t.defaultCurrency || 'EGP',
          isAvailableForNewStudents: t.isAvailableForNewStudents !== false,
          availabilityStatusNote: t.availabilityStatusNote || '',
          availabilitySlots: availabilityMap[t._id.toString()] || [],
          assignedStudentOriginalIds: tAssignedMap[t._id.toString()] || [],
          isActive: t.isActive !== false,
          createdAt: t.createdAt
        };
      });
    }

    // 4. Fetch Selected Students with complete profiles and relations
    let studentsData = [];
    let parentIdsToFetch = new Set();
    let pricingRulesData = [];
    let studentPausesData = [];

    if (targetStudentIds.size > 0) {
      const students = await Student.find({
        _id: { $in: Array.from(targetStudentIds) }
      })
        .populate('teachers', 'name email specialty')
        .populate('parent', 'name email phone')
        .lean();

      // Fetch pricing rules for these students
      let pricingMap = {};
      if (includePricings) {
        const pricings = await Pricing.find({
          student: { $in: Array.from(targetStudentIds) }
        }).lean();

        pricings.forEach(p => {
          const sId = p.student.toString();
          if (!pricingMap[sId]) pricingMap[sId] = [];
          const pItem = {
            studentOriginalId: sId,
            teacherOriginalId: p.teacher.toString(),
            subject: p.subject,
            hourlyRate: p.hourlyRate,
            currency: p.currency || 'USD',
            teacherRate: p.teacherRate,
            teacherCurrency: p.teacherCurrency || 'EGP',
            createdAt: p.createdAt
          };
          pricingMap[sId].push(pItem);
          pricingRulesData.push(pItem);
        });
      }

      // Fetch student pauses history
      let pauseMap = {};
      if (includePauses) {
        const pauses = await StudentPause.find({
          student: { $in: Array.from(targetStudentIds) }
        }).lean();

        pauses.forEach(pz => {
          const sId = pz.student.toString();
          if (!pauseMap[sId]) pauseMap[sId] = [];
          const pzItem = {
            studentOriginalId: sId,
            supervisorOriginalId: pz.supervisor ? pz.supervisor.toString() : null,
            type: pz.type, // 'temporary' | 'permanent'
            reason: pz.reason,
            pausedAt: pz.pausedAt,
            expectedReturnAt: pz.expectedReturnAt || null,
            actualReturnAt: pz.actualReturnAt || null,
            isResolved: !!pz.isResolved,
            createdAt: pz.createdAt
          };
          pauseMap[sId].push(pzItem);
          studentPausesData.push(pzItem);
        });
      }

      studentsData = students.map(s => {
        if (s.parent && s.parent._id) {
          parentIdsToFetch.add(s.parent._id.toString());
        }

        const names = splitName(s.name);

        return {
          originalId: s._id.toString(),
          name: s.name,
          firstName: names.firstName,
          lastName: names.lastName,
          age: s.age,
          language: s.language || '',
          country: s.country || '',
          timezone: s.timezone || 'Africa/Cairo',
          status: s.status || 'Active', // 'Active' | 'Paused' | 'Inactive'
          photoUrl: s.photoUrl || '',
          parentSocialMediaConsent: !!s.parentSocialMediaConsent,
          startDate: s.startDate || null,
          programs: s.programs || [],
          customProgram: s.customProgram || '',
          programLevels: s.programLevels || '{}',
          programBooks: s.programBooks || '{}',
          initialLevel: s.initialLevel || '',
          levelPerProgram: s.levelPerProgram || '',
          booksUsed: s.booksUsed || [],
          scheduleSlots: (s.scheduleSlots || []).map(slot => ({
            day: slot.day,
            time: slot.time,
            durationMinutes: slot.durationMinutes || 60
          })),
          sessionDurationMinutes: s.sessionDurationMinutes || 60,
          sessionDays: s.sessionDays || [],
          sessionTimeTeacher: s.sessionTimeTeacher || '',
          assignedTeacherOriginalIds: (s.teachers || []).map(t => (t._id || t).toString()),
          assignedTeachers: (s.teachers || []).map(t => ({
            originalId: (t._id || t).toString(),
            name: t.name,
            email: t.email
          })),
          parentOriginalId: s.parent ? (s.parent._id || s.parent).toString() : null,
          parent: s.parent ? {
            originalId: (s.parent._id || s.parent).toString(),
            name: s.parent.name,
            email: s.parent.email,
            phone: s.parent.phone || ''
          } : null,
          pricingRules: pricingMap[s._id.toString()] || [],
          pauseRecords: pauseMap[s._id.toString()] || [],
          joinedAt: s.joinedAt
        };
      });
    }

    // 5. Fetch Parents WITH passwordHash (Strictly Read-Only)
    let parentsData = [];
    if (includeParents && parentIdsToFetch.size > 0) {
      const parents = await User.find({
        _id: { $in: Array.from(parentIdsToFetch) }
      })
        .select('+password')
        .lean();

      parentsData = parents.map(p => {
        const names = splitName(p.name);
        const pHash = extractSafePasswordHash(p.password);

        return {
          originalId: p._id.toString(),
          name: p.name,
          firstName: names.firstName,
          lastName: names.lastName,
          email: p.email,
          passwordHash: pHash,
          role: p.role || 'Parent',
          phone: p.phone || '',
          childrenOriginalIds: (p.parentOf || []).map(c => c.toString()),
          isActive: p.isActive !== false,
          createdAt: p.createdAt
        };
      });
    }

    // 6. Fetch Weekly Schedules grid if requested
    let weeklySchedulesData = [];
    if (includeWeeklySchedules && (targetTeacherIds.size > 0 || targetStudentIds.size > 0)) {
      const filterConditions = [];
      if (targetTeacherIds.size > 0) filterConditions.push({ teacher: { $in: Array.from(targetTeacherIds) } });
      if (targetStudentIds.size > 0) filterConditions.push({ student: { $in: Array.from(targetStudentIds) } });

      const wSlots = await WeeklySchedule.find({ $or: filterConditions }).lean();
      weeklySchedulesData = wSlots.map(ws => ({
        teacherOriginalId: ws.teacher.toString(),
        studentOriginalId: ws.student.toString(),
        dayOfWeek: ws.dayOfWeek,
        timeSlot: ws.timeSlot,
        durationMinutes: ws.durationMinutes || 60,
        subject: ws.subject || 'القرآن الكريم والتجويد',
        createdAt: ws.createdAt
      }));
    }

    // 7. Fetch All Sessions (all statuses - present, excused, unexcused, makeup, trial, teacher abs)
    let sessionsData = [];
    let pendingMakeupSessionsData = [];
    let sessionsAwaitingApprovalData = [];
    if (targetTeacherIds.size > 0 || targetStudentIds.size > 0) {
      const sessionFilter = {};
      const sessionOr = [];
      if (targetTeacherIds.size > 0) sessionOr.push({ teacher: { $in: Array.from(targetTeacherIds) } });
      if (targetStudentIds.size > 0) sessionOr.push({ student: { $in: Array.from(targetStudentIds) } });
      if (sessionOr.length > 0) sessionFilter.$or = sessionOr;

      const allSessions = await Session.find(sessionFilter)
        .populate('teacher', 'name email')
        .populate('student', 'name')
        .lean();

      sessionsData = allSessions.map(s => ({
        originalId: s._id.toString(),
        studentOriginalId: s.student ? (s.student._id || s.student).toString() : null,
        studentName: s.student?.name || '',
        teacherOriginalId: s.teacher ? (s.teacher._id || s.teacher).toString() : null,
        teacherName: s.teacher?.name || '',
        subject: s.subject || 'القرآن الكريم والتجويد',
        program: s.program || '',
        isCombinedProgram: !!s.isCombinedProgram,
        date: s.date,
        durationMinutes: s.durationMinutes || 60,
        status: s.status,
        scheduledMakeupDate: s.scheduledMakeupDate || null,
        scheduledMakeupTimeSlot: s.scheduledMakeupTimeSlot || '',
        latenessRemark: s.latenessRemark || '',
        notifiedOnGroup: !!s.notifiedOnGroup,
        preNotifiedTwoHours: !!s.preNotifiedTwoHours,
        isMakeup: !!s.isMakeup,
        originalSessionId: s.originalSession ? s.originalSession.toString() : null,
        makeupStatus: s.makeupStatus || 'None',
        makeupSessionId: s.makeupSession ? s.makeupSession.toString() : null,
        makeupDifficultyNote: s.makeupDifficultyNote || '',
        isApprovedBySupervisor: !!s.isApprovedBySupervisor,
        isLocked: !!s.isLocked,
        isBilled: !!s.isBilled,
        isPaidToTeacher: !!s.isPaidToTeacher,
        teacherNote: s.teacherNote || '',
        internalSupervisorNote: s.internalSupervisorNote || '',
        supervisorChecklist: s.supervisorChecklist || {},
        consecutiveAbsenceCounter: s.consecutiveAbsenceCounter || 0,
        createdAt: s.createdAt
      }));

      // Subset: pending makeup sessions (awaiting a makeup to be scheduled)
      pendingMakeupSessionsData = sessionsData.filter(s => s.makeupStatus === 'Pending');

      // Subset: sessions that have NOT been approved by supervisor yet
      sessionsAwaitingApprovalData = sessionsData.filter(s => !s.isApprovedBySupervisor);
    }

    // 8. Fetch Session Edit Requests (all & pending)
    let sessionEditRequestsData = [];
    let pendingSessionEditRequestsData = [];
    if (targetTeacherIds.size > 0) {
      const serFilter = { teacher: { $in: Array.from(targetTeacherIds) } };
      const sessionEditRequests = await SessionEditRequest.find(serFilter)
        .populate('session', 'date status subject durationMinutes')
        .populate('teacher', 'name email')
        .lean();

      sessionEditRequestsData = sessionEditRequests.map(r => ({
        originalId: r._id.toString(),
        sessionOriginalId: r.session ? (r.session._id || r.session).toString() : null,
        sessionDate: r.session?.date || null,
        sessionCurrentStatus: r.session?.status || '',
        teacherOriginalId: r.teacher ? (r.teacher._id || r.teacher).toString() : null,
        teacherName: r.teacher?.name || '',
        reason: r.reason || '',
        proposedChanges: r.proposedChanges || {},
        status: r.status, // 'Pending' | 'Approved' | 'Rejected'
        createdAt: r.createdAt
      }));

      pendingSessionEditRequestsData = sessionEditRequestsData.filter(r => r.status === 'Pending');
    }

    // 9. Fetch Schedule Edit Requests (all & pending)
    let scheduleEditRequestsData = [];
    let pendingScheduleEditRequestsData = [];
    if (targetTeacherIds.size > 0 || targetStudentIds.size > 0) {
      const schedFilter = {};
      const schedOr = [];
      if (targetTeacherIds.size > 0) schedOr.push({ teacher: { $in: Array.from(targetTeacherIds) } });
      if (targetStudentIds.size > 0) schedOr.push({ student: { $in: Array.from(targetStudentIds) } });
      if (schedOr.length > 0) schedFilter.$or = schedOr;

      const schedEditRequests = await ScheduleEditRequest.find(schedFilter)
        .populate('student', 'name country timezone')
        .populate('teacher', 'name email')
        .populate('supervisor', 'name email')
        .populate('requestedBy', 'name email role')
        .lean();

      scheduleEditRequestsData = schedEditRequests.map(r => ({
        originalId: r._id.toString(),
        studentOriginalId: r.student ? (r.student._id || r.student).toString() : null,
        studentName: r.student?.name || '',
        teacherOriginalId: r.teacher ? (r.teacher._id || r.teacher).toString() : null,
        teacherName: r.teacher?.name || '',
        supervisorOriginalId: r.supervisor ? (r.supervisor._id || r.supervisor).toString() : null,
        supervisorName: r.supervisor?.name || '',
        requestedByOriginalId: r.requestedBy ? (r.requestedBy._id || r.requestedBy).toString() : null,
        requestedByName: r.requestedBy?.name || '',
        requestedByRole: r.requestedBy?.role || '',
        oldScheduleSlots: r.oldScheduleSlots || [],
        newScheduleSlots: r.newScheduleSlots || [],
        newStudentTimezone: r.newStudentTimezone || '',
        newStudentCountry: r.newStudentCountry || '',
        status: r.status, // 'Pending' | 'Approved' | 'Rejected'
        rejectionReason: r.rejectionReason || '',
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt || null
      }));

      pendingScheduleEditRequestsData = scheduleEditRequestsData.filter(r => r.status === 'Pending');
    }

    // 10. Fetch Invoices (parent billing records)
    let invoicesData = [];
    if (includeParents && parentIdsToFetch.size > 0) {
      const invoices = await Invoice.find({
        parent: { $in: Array.from(parentIdsToFetch) }
      })
        .populate('parent', 'name email')
        .lean();

      invoicesData = invoices.map(inv => ({
        originalId: inv._id.toString(),
        invoiceNumber: inv.invoiceNumber,
        parentOriginalId: inv.parent ? (inv.parent._id || inv.parent).toString() : null,
        parentName: inv.parent?.name || '',
        parentEmail: inv.parent?.email || '',
        month: inv.month,
        items: (inv.items || []).map(item => ({
          studentOriginalId: item.student ? item.student.toString() : null,
          studentName: item.studentName || '',
          description: item.description || '',
          minutes: item.minutes || 0,
          hours: item.hours,
          rate: item.rate,
          total: item.total
        })),
        subTotal: inv.subTotal,
        paypalFee: inv.paypalFee || 0,
        totalAmount: inv.totalAmount,
        currency: inv.currency || 'USD',
        paymentStatus: inv.paymentStatus, // 'Unpaid' | 'Paid' | 'PartiallyPaid'
        paymentMethod: inv.paymentMethod || 'PayPal',
        isApprovedByAdmin: !!inv.isApprovedByAdmin,
        paidAt: inv.paidAt || null,
        createdAt: inv.createdAt
      }));
    }

    // 11. Fetch Salaries (teacher payroll records)
    let salariesData = [];
    if (targetTeacherIds.size > 0) {
      const salaries = await Salary.find({
        teacher: { $in: Array.from(targetTeacherIds) }
      })
        .populate('teacher', 'name email')
        .lean();

      salariesData = salaries.map(sal => ({
        originalId: sal._id.toString(),
        salaryNumber: sal.salaryNumber,
        teacherOriginalId: sal.teacher ? (sal.teacher._id || sal.teacher).toString() : null,
        teacherName: sal.teacher?.name || '',
        month: sal.month,
        sessionOriginalIds: (sal.sessions || []).map(s => s.toString()),
        hoursTaught: sal.hoursTaught || 0,
        baseSalaryUsd: sal.baseSalaryUsd || 0,
        baseSalaryEgp: sal.baseSalaryEgp || 0,
        exchangeRateUsed: sal.exchangeRateUsed || 50,
        finalPayoutEgp: sal.finalPayoutEgp,
        payoutStatus: sal.payoutStatus, // 'Unpaid' | 'Paid'
        isApprovedByAdmin: !!sal.isApprovedByAdmin,
        paidAt: sal.paidAt || null,
        createdAt: sal.createdAt
      }));
    }

    // 12. Fetch Monthly Reports (student progress reports)
    let monthlyReportsData = [];
    if (targetStudentIds.size > 0 || targetTeacherIds.size > 0) {
      const mrFilter = {};
      const mrOr = [];
      if (targetStudentIds.size > 0) mrOr.push({ student: { $in: Array.from(targetStudentIds) } });
      if (targetTeacherIds.size > 0) mrOr.push({ teacher: { $in: Array.from(targetTeacherIds) } });
      if (mrOr.length > 0) mrFilter.$or = mrOr;

      const monthlyReports = await MonthlyReport.find(mrFilter)
        .populate('student', 'name')
        .populate('teacher', 'name email')
        .lean();

      monthlyReportsData = monthlyReports.map(mr => ({
        originalId: mr._id.toString(),
        studentOriginalId: mr.student ? (mr.student._id || mr.student).toString() : null,
        studentName: mr.student?.name || '',
        teacherOriginalId: mr.teacher ? (mr.teacher._id || mr.teacher).toString() : null,
        teacherName: mr.teacher?.name || '',
        month: mr.month,
        initialTrialSummary: mr.initialTrialSummary || '',
        startingLevelRating: mr.startingLevelRating,
        currentProgressRating: mr.currentProgressRating,
        textEvaluation: mr.textEvaluation,
        attendancePercentage: mr.attendancePercentage ?? 100,
        createdAt: mr.createdAt
      }));
    }

    // 13. Fetch Lead Sources (marketing / referral tracking)
    let leadSourcesData = [];
    {
      const leadSourceFilter = exportType === 'all' ? {} :
        targetStudentIds.size > 0
          ? { student: { $in: Array.from(targetStudentIds) } }
          : {};

      if (exportType === 'all' || Object.keys(leadSourceFilter).length > 0) {
        const leads = await LeadSource.find(leadSourceFilter)
          .populate('student', 'name')
          .populate('referrerParent', 'name email')
          .populate('createdBy', 'name email role')
          .lean();

        leadSourcesData = leads.map(l => ({
          originalId: l._id.toString(),
          leadName: l.leadName,
          studentOriginalId: l.student ? (l.student._id || l.student).toString() : null,
          studentName: l.student?.name || '',
          sourceType: l.sourceType,
          referrerParentOriginalId: l.referrerParent ? (l.referrerParent._id || l.referrerParent).toString() : null,
          referrerParentName: l.referrerParent?.name || '',
          referrerParentEmail: l.referrerParent?.email || '',
          notes: l.notes || '',
          createdByOriginalId: l.createdBy ? (l.createdBy._id || l.createdBy).toString() : null,
          createdByName: l.createdBy?.name || '',
          createdByRole: l.createdBy?.role || '',
          createdAt: l.createdAt
        }));
      }
    }

    // 14. Handle CSV Format Option
    if (format === 'csv') {
      const csvRows = [];
      csvRows.push(['Original ID', 'Name', 'Role/Type', 'Email', 'Phone', 'Country/Specialty', 'Status', 'Has Password Hash', 'Related IDs'].join(','));

      supervisorsData.forEach(s => {
        csvRows.push([
          `"${s.originalId}"`,
          `"${s.name}"`,
          `"مشرف (${s.role})"`,
          `"${s.email}"`,
          `"${s.phone}"`,
          `"${s.specialty}"`,
          `"${s.isActive ? 'نشط' : 'معطل'}"`,
          `"${s.passwordHash ? 'YES (Bcrypt)' : 'NO'}"`,
          `"Teachers: ${s.supervisedTeacherOriginalIds.length}"`
        ].join(','));
      });

      teachersData.forEach(t => {
        csvRows.push([
          `"${t.originalId}"`,
          `"${t.name}"`,
          `"معلم (Teacher)"`,
          `"${t.email}"`,
          `"${t.phone}"`,
          `"${t.specialty}"`,
          `"${t.isActive ? 'نشط' : 'معطل'}"`,
          `"${t.passwordHash ? 'YES (Bcrypt)' : 'NO'}"`,
          `"Supervisor: ${t.supervisorOriginalId || 'None'}; Students: ${t.assignedStudentOriginalIds.length}"`
        ].join(','));
      });

      studentsData.forEach(s => {
        csvRows.push([
          `"${s.originalId}"`,
          `"${s.name}"`,
          `"طالب (Student)"`,
          `"${s.parent?.email || 'N/A'}"`,
          `"${s.parent?.phone || 'N/A'}"`,
          `"${s.country} (${s.timezone})"`,
          `"${s.status}"`,
          `"N/A (Managed by Parent)"`,
          `"Teachers: ${s.assignedTeacherOriginalIds.join('; ')}; Parent: ${s.parentOriginalId || 'None'}"`
        ].join(','));
      });

      parentsData.forEach(p => {
        csvRows.push([
          `"${p.originalId}"`,
          `"${p.name}"`,
          `"ولي أمر (Parent)"`,
          `"${p.email}"`,
          `"${p.phone}"`,
          `""`,
          `"${p.isActive ? 'نشط' : 'معطل'}"`,
          `"${p.passwordHash ? 'YES (Bcrypt)' : 'NO'}"`,
          `"Children: ${p.childrenOriginalIds.join('; ')}"`
        ].join(','));
      });

      const csvContent = '\uFEFF' + csvRows.join('\r\n');
      return res.json({
        success: true,
        format: 'csv',
        csvContent,
        filename: `alfjr_users_export_${Date.now()}.csv`,
        message: 'تم تصدير البيانات بصيغة CSV بنجاح'
      });
    }

    // 15. Full Relational Export Package (Version 3.0 - Complete Academy Data)
    const exportPackage = {
      metadata: {
        exportVersion: '3.0',
        exportType,
        exportDate: new Date().toISOString(),
        system: 'EduCore ERP v3.0',
        sourceAcademy: {
          sourceAcademyId: 'alfjr-academy',
          sourceAcademyName: 'أكاديمية الفجر - Alfjr Academy',
          domain: 'alfjer-front.vercel.app'
        },
        summary: {
          supervisorsCount: supervisorsData.length,
          teachersCount: teachersData.length,
          studentsCount: studentsData.length,
          parentsCount: parentsData.length,
          pricingRulesCount: pricingRulesData.length,
          availabilitySlotsCount: availabilitySlotsData.length,
          weeklyScheduleSlotsCount: weeklySchedulesData.length,
          pauseRecordsCount: studentPausesData.length,
          totalSessionsCount: sessionsData.length,
          pendingMakeupSessionsCount: pendingMakeupSessionsData.length,
          sessionsAwaitingApprovalCount: sessionsAwaitingApprovalData.length,
          sessionEditRequestsCount: sessionEditRequestsData.length,
          pendingSessionEditRequestsCount: pendingSessionEditRequestsData.length,
          scheduleEditRequestsCount: scheduleEditRequestsData.length,
          pendingScheduleEditRequestsCount: pendingScheduleEditRequestsData.length,
          invoicesCount: invoicesData.length,
          salariesCount: salariesData.length,
          monthlyReportsCount: monthlyReportsData.length,
          leadSourcesCount: leadSourcesData.length
        },
        securityNotice: {
          passwordsPreservedAsHash: true,
          hashAlgorithm: 'bcrypt',
          plainPasswordsIncluded: false,
          tokensOrSecretsIncluded: false,
          instructions: 'The passwordHash fields contain existing bcrypt hashes. Do not re-hash them during import; insert them directly into the User collection password field so users can log in with their exact same existing passwords.'
        },
        importGuidelines: {
          relationalMappingPlan: [
            '1. Create or select target Academy ID in the destination platform.',
            '2. Import Supervisors -> create mapping: originalId => newSupervisorObjectId.',
            '3. Import Teachers with passwordHash -> replace supervisorOriginalId using Supervisor mapping.',
            '4. Import Parents with passwordHash -> generate mapping: originalId => newParentObjectId.',
            '5. Import Students -> replace assignedTeacherOriginalIds using Teacher mapping, and parentOriginalId using Parent mapping.',
            '6. Import Pricing rules, TeacherAvailability, WeeklySchedule, and StudentPauses substituting original IDs with newly assigned ObjectIds.',
            '7. Import Sessions -> map teacherOriginalId and studentOriginalId using Teacher/Student mappings.',
            '8. Import SessionEditRequests and ScheduleEditRequests -> map all referenced IDs.',
            '9. Import Invoices -> map parentOriginalId; update item.studentOriginalId using Student mapping.',
            '10. Import Salaries -> map teacherOriginalId and sessionOriginalIds using Teacher/Session mappings.',
            '11. Import MonthlyReports -> map studentOriginalId and teacherOriginalId.',
            '12. Import LeadSources -> map studentOriginalId, referrerParentOriginalId, createdByOriginalId.'
          ]
        }
      },

      // ─── Accounts & Profiles ────────────────────────────────────────────────────
      supervisors: supervisorsData,
      teachers: teachersData,
      students: studentsData,
      parents: parentsData,

      // ─── Pricing & Schedules ─────────────────────────────────────────────────────
      pricingRules: pricingRulesData,
      teacherAvailability: availabilitySlotsData,
      weeklySchedules: weeklySchedulesData,

      // ─── Student Pauses / Holds ──────────────────────────────────────────────────
      studentPauses: studentPausesData,

      // ─── Sessions (All / Pending Makeup / Awaiting Approval) ─────────────────────
      sessions: sessionsData,
      pendingMakeupSessions: pendingMakeupSessionsData,
      sessionsAwaitingApproval: sessionsAwaitingApprovalData,

      // ─── Edit Requests (Session & Schedule) ──────────────────────────────────────
      sessionEditRequests: sessionEditRequestsData,
      pendingSessionEditRequests: pendingSessionEditRequestsData,
      scheduleEditRequests: scheduleEditRequestsData,
      pendingScheduleEditRequests: pendingScheduleEditRequestsData,

      // ─── Financials ──────────────────────────────────────────────────────────────
      invoices: invoicesData,
      salaries: salariesData,

      // ─── Progress & Reports ───────────────────────────────────────────────────────
      monthlyReports: monthlyReportsData,

      // ─── Marketing / Acquisition ─────────────────────────────────────────────────
      leadSources: leadSourcesData
    };

    res.json({
      success: true,
      message: 'تم استخراج وتصدير بيانات الأكاديمية الكاملة بنجاح (الحسابات، الحصص، المعلقة، الاعتماد، الفواتير، الرواتب، التقارير)',
      data: exportPackage
    });
  } catch (error) {
    console.error('Export Download Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getExportOverview,
  exportUsers
};
