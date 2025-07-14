require('dotenv').config();

const express = require('express');
const http = require('http'); // <-- NEW
const socketIo = require('socket.io'); // <-- NEW
const app = express();
const server = http.createServer(app); // <-- NEW
const io = socketIo(server, { cors: { origin: '*' } }); // <-- NEW
const sequelize = require('./config/db');
const cors = require('cors');
const { User } = require('./models');

// Import routes
const authRoutes = require('./routes/auth');
const associationRoutes = require('./routes/associations');
const userRoutes = require('./routes/userData');
const paymentRoutes = require('./routes/payments');
const turnRoutes = require('./routes/turns');
const nationalIDRoutes = require('./routes/nationalID');
const { fa } = require('@faker-js/faker');

// Import models to ensure associations are set up
require('./models');

app.use(cors());
app.use(express.json());

// Socket.IO logic
const adminSockets = new Set();

io.on('connection', (socket) => {
  socket.on('register', (data) => {
    if (data.role === 'admin') adminSockets.add(socket.id);
    socket.role = data.role;
    socket.userId = data.userId;
  });
  socket.on('disconnect', () => {
    if (socket.role === 'admin') adminSockets.delete(socket.id);
  });
});

app.set('io', io); // So you can use io instance elsewhere if needed

// Routes
app.use('/api/auth', authRoutes);

app.use('/api/associations', associationRoutes);
app.use('/api/userData', userRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/turns', turnRoutes);
app.use('/api/nationalID', nationalIDRoutes);
app.use('/uploads', express.static('uploads'));
app.use('/nationalID', express.static('nationalID'));

// Error handling middleware
app.use((err, req, res, next) => {
  // Enhanced error logging
  console.error('--- ERROR START ---');
  console.error('Error stack:', err.stack);
  if (err.sql) {
    console.error('SQL:', err.sql);
  }
  if (err.parent) {
    console.error('Sequelize Parent Error:', err.parent);
  }
  console.error('Full error object:', err);
  console.error('--- ERROR END ---');
  res.status(500).json({
    success: false,
    error: 'Something went wrong!',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});
const isTestEnvironment = process.env.NODE_ENV === 'test';

// Database sync & server start
sequelize.sync({ force:false })
  .then(async () => {
    console.log('✅ Database synced successfully');
    // Seed admin user
    const adminNationalId = '1234';
    const adminPassword = '1234';
    const adminPhone = '1234';
    const admin = await User.findOne({ where: { nationalId: adminNationalId } });
    if (!admin) {
      await User.create({
        fullName: 'Admin',
        nationalId: adminNationalId,
        phone: adminPhone,
        password: adminPassword,
        role: 'admin',
        profileApproved: true
      });
      console.log('✅ Seeded admin user with nationalId 1234 and password 1234');
    } else {
      console.log('ℹ️ Admin user already exists');
    }
    const port = process.env.PORT || 3000;
    server.listen(port, () => { // <-- use 'server', not 'app'
      console.log(`Server is running on port ${port}`);
    });
  })
  .catch(err => {
    console.error('❌ Database sync failed:', err);
  });
