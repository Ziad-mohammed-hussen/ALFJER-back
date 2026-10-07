const User = require('../models/User');
const Student = require('../models/Student');
const Pricing = require('../models/Pricing');
const TeacherAvailability = require('../models/TeacherAvailability');
const StudentPause = require('../models/StudentPause');
const WeeklySchedule = require('../models/WeeklySchedule');

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
          totalPricings: await Pricing.countDocuments()
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

    // 7. Handle CSV Format Option
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

    // 8. Full Relational Export Package (Version 2.0 with preserved passwordHash and complete accounts)
    const exportPackage = {
      metadata: {
        exportVersion: '2.0',
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
          pauseRecordsCount: studentPausesData.length
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
            '6. Import Pricing rules, TeacherAvailability, WeeklySchedule, and StudentPauses substituting original IDs with newly assigned ObjectIds.'
          ]
        }
      },
      supervisors: supervisorsData,
      teachers: teachersData,
      students: studentsData,
      parents: parentsData,
      pricingRules: pricingRulesData,
      teacherAvailability: availabilitySlotsData,
      weeklySchedules: weeklySchedulesData,
      studentPauses: studentPausesData
    };

    res.json({
      success: true,
      message: 'تم استخراج وتصدير بيانات الحسابات الكاملة والعلاقات وكلمات المرور المشفرة بنجاح',
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
