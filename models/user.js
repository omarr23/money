const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');
const { Association, UserAssociation } = require('./association');
const bcrypt = require('bcryptjs');

const User = sequelize.define('User', {
  // ... جميع الحقول المطلوبة
  fullName: { type: DataTypes.STRING, allowNull: false },
  nationalId: { type: DataTypes.STRING, unique: true },
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

User.beforeCreate(async (user) => {
  user.password = await bcrypt.hash(user.password, 10);
});

module.exports = User;