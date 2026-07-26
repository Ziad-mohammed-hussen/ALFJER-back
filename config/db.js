const mongoose = require('mongoose');

// Global cache to reuse connection across serverless invocations
let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

const connectDB = async () => {
  // Return existing connection if available
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  // Reset if connection dropped
  if (mongoose.connection.readyState === 0) {
    cached.conn = null;
    cached.promise = null;
  }

  if (!cached.promise) {
    const uri = process.env.MONGO_URI || 'mongodb+srv://alfjer:alfjer@cluster0.oqg4s2c.mongodb.net/alfjr_academy?appName=Cluster0';
    
    cached.promise = mongoose.connect(uri, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    }).then(async (m) => {
      console.log(`MongoDB Connected: ${m.connection.host}`);
      // Ensure default Admin user exists in Atlas database
      try {
        const User = require('../models/User');
        const adminExists = await User.findOne({ email: 'admin@alfjr.com' });
        if (!adminExists) {
          await User.create({
            name: 'أحمد الإداري (Admin)',
            email: 'admin@alfjr.com',
            password: 'password123',
            role: 'Admin',
            phone: '01000000001'
          });
          console.log('✅ Default Admin account created: admin@alfjr.com');
        }
      } catch (err) {
        console.error('Auto-seed admin warning:', err.message);
      }
      return m;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (error) {
    cached.promise = null;
    cached.conn = null;
    console.error(`MongoDB connection error: ${error.message}`);
    throw error;
  }

  return cached.conn;
};

module.exports = connectDB;

