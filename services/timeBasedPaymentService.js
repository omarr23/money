const { Payment, User, Association } = require('../models');
const sequelize = require('../config/db');

function calculatePayoutDate(paymentDate, duration, durationUnit) {
  const date = new Date(paymentDate);
  
  switch(durationUnit) {
    case 'seconds':
      date.setSeconds(date.getSeconds() + duration);
      break;
    case 'minutes':
      date.setMinutes(date.getMinutes() + duration);
      break;
    case 'hours':
      date.setHours(date.getHours() + duration);
      break;
    case 'days':
      date.setDate(date.getDate() + duration);
      break;
    case 'weeks':
      date.setDate(date.getDate() + (duration * 7));
      break;
    case 'months':
      date.setMonth(date.getMonth() + duration);
      break;
    default:
      throw new Error('Invalid duration unit');
  }
  
  return date;
}

async function createTimeBasedPayment(userId, associationId, amount, duration, durationUnit = 'months') {
  const transaction = await sequelize.transaction();
  
  try {
    // Check if user has sufficient balance
    const user = await User.findByPk(userId, { transaction });
    if (!user) {
      throw new Error('User not found');
    }
    
    if (user.walletBalance < amount) {
      throw new Error('Insufficient balance');
    }

    // Validate duration unit
    if (!['seconds', 'minutes', 'hours', 'days', 'weeks', 'months'].includes(durationUnit)) {
      throw new Error('Invalid duration unit. Must be one of: seconds, minutes, hours, days, weeks, months');
    }

    // Calculate payout date based on duration unit
    const paymentDate = new Date();
    const payoutDate = calculatePayoutDate(paymentDate, duration, durationUnit);

    // Calculate payout amount (10% return on investment)
    const payoutAmount = amount + (amount * 0.1);

    // Create payment record
    const payment = await Payment.create({
      userId,
      associationId,
      amount,
      duration,
      durationUnit,
      paymentDate,
      status: 'active',
      payoutDate,
      payoutAmount
    }, { transaction });

    // Deduct amount from user's wallet
    await user.update({
      walletBalance: sequelize.literal(`walletBalance - ${amount}`)
    }, { transaction });

    await transaction.commit();
    return payment;
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }
    throw error;
  }
}

async function processPayouts() {
  const transaction = await sequelize.transaction();
  
  try {
    // Find all active payments that are due for payout
    const duePayments = await Payment.findAll({
      where: {
        status: 'active',
        payoutDate: {
          [sequelize.Op.lte]: new Date()
        }
      },
      include: [User],
      transaction
    });

    for (const payment of duePayments) {
      // Add payout amount to user's wallet
      await payment.User.update({
        walletBalance: sequelize.literal(`walletBalance + ${payment.payoutAmount}`)
      }, { transaction });

      // Mark payment as completed
      await payment.update({
        status: 'completed'
      }, { transaction });
    }

    await transaction.commit();
    return duePayments.length;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

module.exports = {
  createTimeBasedPayment,
  processPayouts,
  calculatePayoutDate
}; 