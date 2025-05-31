const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Payment = sequelize.define('Payment', {
  amount: { type: DataTypes.FLOAT, allowNull: false },
  paymentDate: { type: DataTypes.DATE, allowNull: false },
  feeAmount: DataTypes.FLOAT,
  feePercent: DataTypes.FLOAT
});

module.exports = Payment;