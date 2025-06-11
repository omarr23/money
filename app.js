require('dotenv').config();

const express = require('express');
const app = express();
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

// Database sync
sequelize.sync({ force: false }) // Set to true only for development to drop tables
  .then(() => {
    console.log('✅ Database synced successfully');
    // Start the server after database sync
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  })
  .catch(err => {
    console.error('❌ Database sync failed:', err);
  });