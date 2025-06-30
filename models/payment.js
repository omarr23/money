const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Payment = sequelize.define('Payment', {
  amount: { type: DataTypes.FLOAT, allowNull: false },
  paymentDate: { type: DataTypes.DATE, allowNull: false },
  feeAmount: DataTypes.FLOAT,
  feePercent: DataTypes.FLOAT,
  paymentChoice: { type: DataTypes.STRING },
  eGateway: { type: DataTypes.STRING },
  notificationCategory: { type: DataTypes.ENUM('sms', 'email', 'none'), defaultValue: 'none' },
  // userId: { type: DataTypes.INTEGER, allowNull: false }, // Removed to avoid duplicate UserId
});

module.exports = Payment;