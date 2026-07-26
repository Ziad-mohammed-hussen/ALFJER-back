const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('../config/db');

dotenv.config();

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

// DB connection middleware
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('Database connection error on Vercel:', err.message);
    res.status(500).json({ success: false, message: 'Database connection failed: ' + err.message });
  }
});

// Routes
app.use('/api/auth', require('../routes/authRoutes'));
app.use('/api/students', require('../routes/studentRoutes'));
app.use('/api/sessions', require('../routes/sessionRoutes'));
app.use('/api/pauses', require('../routes/pauseRoutes'));
app.use('/api/invoices', require('../routes/invoiceRoutes'));
app.use('/api/salaries', require('../routes/salaryRoutes'));
app.use('/api/reports', require('../routes/reportRoutes'));
app.use('/api/leads', require('../routes/leadRoutes'));
app.use('/api/analytics', require('../routes/analyticsRoutes'));
app.use('/api/schedule', require('../routes/weeklyScheduleRoutes'));
app.use('/api/upload', require('../routes/uploadRoutes'));
app.use('/api/availability', require('../routes/availabilityRoutes'));

app.get('/api/status', (req, res) => {
  res.json({
    status: 'success',
    message: 'Alfjr Academy backend server is running and database is connected successfully.'
  });
});

module.exports = app;
