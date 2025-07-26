const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');
const { Association, UserAssociation } = require('./association');
const bcrypt = require('bcryptjs');

// Email validation function
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  fullName: { type: DataTypes.STRING, allowNull: false },
  nationalId: { type: DataTypes.STRING, unique: true, allowNull: true },
  email: { 
    type: DataTypes.STRING, 
    unique: true, 
    allowNull: true,
    validate: {
      isEmail: true,
      customValidator(value) {
        if (value && !validateEmail(value)) {
          throw new Error('Invalid email format');
        }
      }
    }
  },
  phone: { type: DataTypes.STRING, unique: true },
  address: { type: DataTypes.TEXT, allowNull: true },
  profileImage: { type: DataTypes.STRING, allowNull: true },
  salarySlipImage: { type: DataTypes.STRING, allowNull: true },
  walletBalance: { type: DataTypes.FLOAT, defaultValue: 0 },
  role: { type: DataTypes.ENUM('admin', 'user'), defaultValue: 'user' },
  password: { type: DataTypes.STRING, allowNull: false },
  profileApproved: { type: DataTypes.BOOLEAN, defaultValue: false },
  profileRejectedReason: { type: DataTypes.STRING, allowNull: true }
});

// Custom validation to ensure at least email or nationalId is provided
User.beforeValidate(async (user) => {
  if (!user.email && !user.nationalId) {
    throw new Error('Either email or nationalId must be provided');
  }
});

User.beforeCreate(async (user) => {
  user.password = await bcrypt.hash(user.password, 10);
});

module.exports = User;