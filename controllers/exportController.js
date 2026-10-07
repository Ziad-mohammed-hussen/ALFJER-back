const User = require('../models/User');
const Student = require('../models/Student');
const Pricing = require('../models/Pricing');
const TeacherAvailability = require('../models/TeacherAvailability');

// @desc    Get overview of users for export panel (Teachers, Supervisors, Students with relationships)
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

    // 4. Map relationships:
    // For each teacher, find their students and student count
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

    // For each supervisor, map supervised teachers
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

// @desc    Generate and download export file (JSON / CSV) with preserved relationships
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
      // Auto-include all students assigned to the selected teachers
      if (targetTeacherIds.size > 0) {
        const relatedStudents = await Student.find({
          teachers: { $in: Array.from(targetTeacherIds) }
        }).select('_id').lean();

        relatedStudents.forEach(s => targetStudentIds.add(s._id.toString()));
      }
    }

    // 2. Fetch Selected Supervisors (Strictly Read-Only, Exclude Passwords)
    let supervisorsData = [];
    if (targetSupervisorIds.size > 0) {
      const sups = await User.find({
        _id: { $in: Array.from(targetSupervisorIds) }
      })
        .select('_id name email role phone specialty isActive createdAt')
        .lean();

      supervisorsData = sups.map(s => ({
        originalId: s._id.toString(),
        name: s.name,
        email: s.email,
        role: s.role,
        phone: s.phone || '',
        specialty: s.specialty || '',
        isActive: s.isActive !== false,
        createdAt: s.createdAt
      }));
    }

    // 3. Fetch Selected Teachers (Strictly Read-Only, Exclude Passwords)
    let teachersData = [];
    if (targetTeacherIds.size > 0) {
      const teachers = await User.find({
        _id: { $in: Array.from(targetTeacherIds) }
      })
        .select('_id name email role phone specialty supervisor defaultHourlyRate defaultCurrency isAvailableForNewStudents availabilityStatusNote isActive createdAt')
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
          availabilityMap[tId].push({
            dayOfWeek: slot.dayOfWeek,
            timeSlot: slot.timeSlot,
            durationMinutes: slot.durationMinutes,
            isPermanent: slot.isPermanent,
            specificDate: slot.specificDate,
            notes: slot.notes || ''
          });
        });
      }

      teachersData = teachers.map(t => ({
        originalId: t._id.toString(),
        name: t.name,
        email: t.email,
        role: t.role,
        phone: t.phone || '',
        specialty: t.specialty || '',
        supervisor: t.supervisor ? {
          originalId: t.supervisor._id.toString(),
          name: t.supervisor.name,
          email: t.supervisor.email,
          role: t.supervisor.role
        } : null,
        defaultHourlyRate: t.defaultHourlyRate || null,
        defaultCurrency: t.defaultCurrency || '',
        isAvailableForNewStudents: t.isAvailableForNewStudents !== false,
        availabilityStatusNote: t.availabilityStatusNote || '',
        availabilitySlots: availabilityMap[t._id.toString()] || [],
        isActive: t.isActive !== false,
        createdAt: t.createdAt
      }));
    }

    // 4. Fetch Selected Students (Strictly Read-Only)
    let studentsData = [];
    let parentIdsToFetch = new Set();

    if (targetStudentIds.size > 0) {
      const students = await Student.find({
        _id: { $in: Array.from(targetStudentIds) }
      })
        .populate('teachers', 'name email specialty')
        .populate('parent', 'name email phone')
        .lean();

      // Fetch pricing rules for these students and teachers
      let pricingMap = {};
      if (includePricings) {
        const pricings = await Pricing.find({
          student: { $in: Array.from(targetStudentIds) }
        }).lean();

        pricings.forEach(p => {
          const sId = p.student.toString();
          if (!pricingMap[sId]) pricingMap[sId] = [];
          pricingMap[sId].push({
            teacherOriginalId: p.teacher.toString(),
            subject: p.subject,
            hourlyRate: p.hourlyRate,
            currency: p.currency,
            teacherRate: p.teacherRate,
            teacherCurrency: p.teacherCurrency
          });
        });
      }

      studentsData = students.map(s => {
        if (s.parent && s.parent._id) {
          parentIdsToFetch.add(s.parent._id.toString());
        }

        return {
          originalId: s._id.toString(),
          name: s.name,
          age: s.age,
          language: s.language || '',
          country: s.country || '',
          timezone: s.timezone || 'Africa/Cairo',
          status: s.status || 'Active',
          photoUrl: s.photoUrl || '',
          parentSocialMediaConsent: !!s.parentSocialMediaConsent,
          startDate: s.startDate || null,
          programs: s.programs || [],
          customProgram: s.customProgram || '',
          programLevels: s.programLevels || '{}',
          programBooks: s.programBooks || '{}',
          scheduleSlots: (s.scheduleSlots || []).map(slot => ({
            day: slot.day,
            time: slot.time,
            durationMinutes: slot.durationMinutes || 60
          })),
          sessionDurationMinutes: s.sessionDurationMinutes || 60,
          assignedTeachers: (s.teachers || []).map(t => ({
            originalId: t._id.toString(),
            name: t.name,
            email: t.email
          })),
          assignedTeacherIds: (s.teachers || []).map(t => t._id.toString()),
          parent: s.parent ? {
            originalId: s.parent._id.toString(),
            name: s.parent.name,
            email: s.parent.email,
            phone: s.parent.phone || ''
          } : null,
          pricingRules: pricingMap[s._id.toString()] || [],
          joinedAt: s.joinedAt
        };
      });
    }

    // 5. Fetch Parents (Strictly Read-Only, Exclude Passwords)
    let parentsData = [];
    if (includeParents && parentIdsToFetch.size > 0) {
      const parents = await User.find({
        _id: { $in: Array.from(parentIdsToFetch) }
      })
        .select('_id name email role phone parentOf isActive createdAt')
        .lean();

      parentsData = parents.map(p => ({
        originalId: p._id.toString(),
        name: p.name,
        email: p.email,
        role: p.role || 'Parent',
        phone: p.phone || '',
        childrenOriginalIds: (p.parentOf || []).map(c => c.toString()),
        isActive: p.isActive !== false,
        createdAt: p.createdAt
      }));
    }

    // 6. Handle CSV Format Option
    if (format === 'csv') {
      const csvRows = [];
      csvRows.push(['ID', 'Name', 'Role/Type', 'Email', 'Phone', 'Country/Specialty', 'Status', 'Related Info'].join(','));

      supervisorsData.forEach(s => {
        csvRows.push([
          `"${s.originalId}"`,
          `"${s.name}"`,
          `"مشرف (${s.role})"`,
          `"${s.email}"`,
          `"${s.phone}"`,
          `"${s.specialty}"`,
          `"${s.isActive ? 'نشط' : 'معطل'}"`,
          `"Supervised Teachers"`
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
          `"Supervisor: ${t.supervisor?.name || 'N/A'}"`
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
          `"Teachers: ${s.assignedTeachers.map(t => t.name).join('; ') || 'None'}"`
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

    // 7. Canonical JSON Export Package (Primary Format for Destination Academy Import)
    const exportPackage = {
      metadata: {
        exportVersion: '1.0',
        system: 'EduCore ERP v3.0',
        exportDate: new Date().toISOString(),
        sourceAcademy: {
          id: 'alfjr-academy',
          name: 'أكاديمية الفجر - Alfjr Academy',
          domain: 'alfjer-front.vercel.app'
        },
        exportType,
        summary: {
          supervisorsCount: supervisorsData.length,
          teachersCount: teachersData.length,
          studentsCount: studentsData.length,
          parentsCount: parentsData.length
        },
        securityNotice: 'This export contains zero passwords, tokens, or private secrets. Passwords must be regenerated or reset upon import in the target academy.',
        importGuidelines: {
          matchingKeys: ['originalId', 'email'],
          relationalHierarchy: 'Supervisors -> Teachers -> Parents -> Students -> ScheduleSlots -> Pricing'
        }
      },
      supervisors: supervisorsData,
      teachers: teachersData,
      students: studentsData,
      parents: parentsData
    };

    res.json({
      success: true,
      message: 'تم تصدير المستخدمين والعلاقات المرتبطة بهم بنجاح',
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
