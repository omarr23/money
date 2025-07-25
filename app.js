require('./jobs/cron');
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
  const { seedAdminUser } = require('./seeding/seeding');

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
    // Simplified error logging
    if (process.env.NODE_ENV === 'development') {
      console.error(err);
    }
    res.status(500).json({
      success: false,
      error: 'Something went wrong!',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  });
  const isTestEnvironment = process.env.NODE_ENV === 'test';

  // Database sync & server start
  sequelize.sync({ force: false})
    .then(async () => {
      console.log('✅ Database synced successfully');
      await seedAdminUser(); // <-- Clean and simple!
      const port = process.env.PORT || 3000;
      server.listen(port, () => { // <-- use 'server', not 'app'
        console.log(`Server is running on port ${port}`);
      });
    })
    .catch(err => {
      if (process.env.NODE_ENV === 'development') {
        console.error('❌ Database sync failed:', err);
      }
    });
