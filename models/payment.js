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
  eWalletProvider: { type: DataTypes.STRING },    // new field
  eWalletAddress: { type: DataTypes.STRING },
  qabdMethod: { type: DataTypes.STRING },
  eWalletPhone: { type: DataTypes.STRING }, // Add this field     // new field
  eWalletBalance: { type: DataTypes.FLOAT }       // optional, for balance tracking
});


module.exports = Payment;