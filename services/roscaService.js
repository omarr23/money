const { Association, UserAssociation, User, Payment } = require('../models');
const sequelize = require('../config/db');

// Calculate fee ratios based on duration
function calculateFeeRatios(duration) {
  const ratios = [];
  for (let i = 0; i < duration; i++) {
    // Example fee calculation: 5% for first month, decreasing by 0.5% each month
    const ratio = Math.max(0.05 - (i * 0.005), 0);
    ratios.push(ratio);
  }
  return ratios;
}

async function triggerCycleForAssociation(associationId) {
  const transaction = await sequelize.transaction();
  try {
    const association = await Association.findByPk(associationId, { transaction });
    if (!association) throw new Error('Association not found');

    const members = await UserAssociation.findAll({
      where: { AssociationId: associationId, status: 'active' },
      order: [['joinDate', 'ASC']],
      transaction
    });

    const allReceived = members.every(m => m.hasReceived);
    if (allReceived) {
      await association.update({ status: 'completed' }, { transaction });
      await transaction.commit();
      return { message: 'All members have received payout. Association completed.' };
    }

    const nextMember = members.find(m => !m.hasReceived);
    if (nextMember) {
      const total = association.monthlyAmount * members.length;
      const feeRatios = calculateFeeRatios(association.duration);
      const feeRatio = feeRatios[nextMember.turnNumber - 1] || 0;
      const feeAmount = association.monthlyAmount * feeRatio;

      await User.increment('walletBalance', {
        by: total - feeAmount,
        where: { id: nextMember.UserId },
        transaction
      });

      if (feeAmount > 0) {
        const firstAdmin = await User.findOne({ 
          where: { role: 'admin' }, 
          order: [['createdAt', 'ASC']], 
          transaction 
        });
        if (firstAdmin) {
          await User.increment('walletBalance', {
            by: feeAmount,
            where: { id: firstAdmin.id },
            transaction
          });
        }
      }

      await Payment.create({
        userId: nextMember.UserId,
        associationId: associationId,
        amount: total - feeAmount,
        feeAmount: feeAmount,
        feePercent: feeRatio,
        paymentDate: new Date()
      }, { transaction });

      await nextMember.update({
        hasReceived: true,
        lastReceivedDate: new Date()
      }, { transaction });

      const remainingMembers = members.filter(m => !m.hasReceived).length;
      if (remainingMembers === 1) {
        await association.update({ status: 'completed' }, { transaction });
      }
    }
    await transaction.commit();
    return { message: 'Payout cycle triggered successfully.' };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

module.exports = { triggerCycleForAssociation }; 