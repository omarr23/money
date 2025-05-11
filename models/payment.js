const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Payment = sequelize.define('Payment', {
  amount: { type: DataTypes.FLOAT, allowNull: false },
  userId: { 
    type: DataTypes.INTEGER, 
    allowNull: false,
    field: 'userId' // Explicitly set the field name
  },
  associationId: { 
    type: DataTypes.INTEGER, 
    allowNull: false,
    field: 'associationId' // Explicitly set the field name
  },
  paymentDate: { type: DataTypes.DATE, allowNull: false },
  duration: { type: DataTypes.INTEGER, allowNull: false }, // Duration in months
  durationUnit: {
    type: DataTypes.ENUM('seconds', 'minutes', 'hours', 'days', 'weeks', 'months'),
    allowNull: false,
    defaultValue: 'months'
  },
  status: {
    type: DataTypes.ENUM('pending', 'active', 'completed'),
    defaultValue: 'pending'
  },
  payoutDate: { type: DataTypes.DATE, allowNull: true },
  payoutAmount: { type: DataTypes.FLOAT, allowNull: true }
}, {
  // Disable automatic timestamp fields
  timestamps: true,
  // Disable automatic pluralization
  freezeTableName: true
});

// Add validation for duration unit
Payment.beforeValidate((payment) => {
  if (payment.durationUnit && !['seconds', 'minutes', 'hours', 'days', 'weeks', 'months'].includes(payment.durationUnit)) {
    throw new Error('Invalid duration unit. Must be one of: seconds, minutes, hours, days, weeks, months');
  }
});

module.exports = Payment;