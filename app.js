require('dotenv').config();

const express = require('express');
const http = require('http'); // <-- NEW
const socketIo = require('socket.io'); // <-- NEW
const app = express();
const server = http.createServer(app); // <-- NEW
const io = socketIo(server, { cors: { origin: '*' } }); // <-- NEW
const sequelize = require('./config/db');
const cors = require('cors');

// Import routes
const authRoutes = require('./routes/auth');
const authTestRoutes = require('./routes/auth_test');
const associationRoutes = require('./routes/associations');
const userRoutes = require('./routes/userData');
const paymentRoutes = require('./routes/payments');
const turnRoutes = require('./routes/turns');

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
app.use('/api/auth-test', authTestRoutes);
app.use('/api/associations', associationRoutes);
app.use('/api/userData', userRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/turns', turnRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: 'Something went wrong!',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Database sync & server start
sequelize.sync({ force: false }) // Set to true only for development to drop tables
  .then(() => {
    console.log('✅ Database synced successfully');
    const port = process.env.PORT || 3000;
    server.listen(port, () => { // <-- use 'server', not 'app'
      console.log(`Server is running on port ${port}`);
    });
  })
  .catch(err => {
    console.error('❌ Database sync failed:', err);
  });
