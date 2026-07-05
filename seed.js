const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User');
const Student = require('./models/Student');
const Pricing = require('./models/Pricing');
const Session = require('./models/Session');
const Invoice = require('./models/Invoice');
const Salary = require('./models/Salary');

dotenv.config();

const seedData = async () => {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/alfjr_academy');
    console.log('Connected to MongoDB for seeding...');

    // Clear existing data
    await User.deleteMany();
    await Student.deleteMany();
    await Pricing.deleteMany();
    await Session.deleteMany();
    await Invoice.deleteMany();
    await Salary.deleteMany();
    console.log('Cleared existing data.');

    // 1. Create Users
    const admin = await User.create({
      name: 'أحمد الإداري (Admin)',
      email: 'admin@alfjr.com',
      password: 'password123',
      role: 'Admin',
      phone: '01000000001'
    });

    const globalSup = await User.create({
      name: 'هاني المشرف العام',
      email: 'globalsup@alfjr.com',
      password: 'password123',
      role: 'GlobalSup',
      phone: '01000000002'
    });

    const supervisor = await User.create({
      name: 'خالد المشرف المباشر',
      email: 'supervisor@alfjr.com',
      password: 'password123',
      role: 'Supervisor',
      phone: '01000000003'
    });

    const teacher = await User.create({
      name: 'محمد عبد العزيز المعلم',
      email: 'teacher@alfjr.com',
      password: 'password123',
      role: 'Teacher',
      phone: '01000000004',
      supervisor: supervisor._id
    });

    const parent = await User.create({
      name: 'عبد الرحمن ولي الأمر',
      email: 'parent@alfjr.com',
      password: 'password123',
      role: 'Parent',
      phone: '01000000005'
    });

    console.log('Created core users (Admin, GlobalSup, Supervisor, Teacher, Parent).');

    // 2. Create Student
    const student = await Student.create({
      name: 'يوسف عبد الرحمن',
      parent: parent._id,
      teachers: [teacher._id]
    });

    // Update parent Of list
    parent.parentOf = [student._id];
    await parent.save();
    console.log('Created student (يوسف) linked to Parent and Teacher.');

    // 3. Set Pricing
    const pricing = await Pricing.create({
      student: student._id,
      teacher: teacher._id,
      subject: 'القرآن الكريم والتجويد',
      hourlyRate: 15, // $15 per hour for parent
      currency: 'USD',
      teacherRate: 200, // 200 EGP per hour for teacher
      teacherCurrency: 'EGP'
    });
    console.log('Set pricing plan for the student.');

    // 4. Create Sessions
    // A present session
    const session1 = await Session.create({
      student: student._id,
      teacher: teacher._id,
      subject: 'القرآن الكريم والتجويد',
      date: new Date(new Date().setDate(new Date().getDate() - 5)), // 5 days ago
      durationHours: 1.5,
      status: 'Present',
      isApprovedBySupervisor: true,
      teacherNote: 'تم حفظ سورة النبأ من آية 1 إلى 15 ومخارج الحروف جيدة جداً.'
    });

    // An excused absence session (generates pending makeup)
    const session2 = await Session.create({
      student: student._id,
      teacher: teacher._id,
      subject: 'القرآن الكريم والتجويد',
      date: new Date(new Date().setDate(new Date().getDate() - 2)), // 2 days ago
      durationHours: 1,
      status: 'Excused',
      makeupStatus: 'Pending',
      teacherNote: 'اعتذر ولي الأمر لظروف سفر طارئة.'
    });

    console.log('Logged test sessions (1 Present, 1 Excused Absence).');

    // 5. Create Test Invoice
    const invoice = await Invoice.create({
      invoiceNumber: 'INV-202607-001',
      parent: parent._id,
      month: new Date(2026, 6, 1), // July 2026
      items: [{
        student: student._id,
        studentName: student.name,
        hours: 1.5,
        rate: 15,
        total: 22.5
      }],
      subTotal: 22.5,
      paypalFee: 1.13, // 5% fee
      totalAmount: 23.63,
      currency: 'USD',
      paymentStatus: 'Unpaid'
    });

    // 6. Create Test Salary
    const salary = await Salary.create({
      salaryNumber: 'SAL-202607-001',
      teacher: teacher._id,
      month: new Date(2026, 6, 1),
      hoursTaught: 1.5,
      baseSalaryUsd: 0,
      baseSalaryEgp: 300, // 1.5 hours * 200 EGP
      exchangeRateUsed: 50.0,
      finalPayoutEgp: 300,
      payoutStatus: 'Unpaid'
    });

    console.log('Created test invoice and salary payroll.');
    console.log('Database seeding completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Seeding error:', error.message);
    process.exit(1);
  }
};

seedData();
