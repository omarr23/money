const { Association, UserAssociation, User, Payment } = require('../models');
const sequelize = require('../config/db');
const { calculateFeeRatios } = require('./feeService');

/**
 * Triggers a monthly payout cycle for a given association.
 * @param {number} associationId 
 */
async function triggerCycleForAssociation(associationId) {
  const transaction = await sequelize.transaction();
  try {
    const association = await Association.findByPk(associationId, { transaction });
    if (!association) {
      throw new Error(`Association with ID ${associationId} not found.`);
    }
    if (association.status !== 'active') {
      if (association.status === 'pending') {
        await association.update({ status: 'active' }, { transaction });
      } else {
        throw new Error(`Association ${associationId} is not active (status: ${association.status}).`);
      }
    }

    const completedPayouts = await UserAssociation.count({
      where: { AssociationId: associationId, hasReceived: true },
      transaction,
    });
    const currentTurnNumber = completedPayouts + 1;

    if (currentTurnNumber > association.duration) {
      await association.update({ status: 'completed' }, { transaction });
      await transaction.commit();
      return { success: true, message: `Association ${associationId} is fully completed.`, status: 'completed' };
    }

    const payoutUserAssociation = await UserAssociation.findOne({
      where: { AssociationId: associationId, turnNumber: currentTurnNumber },
      include: [User],
      transaction,
    });

    if (!payoutUserAssociation) {
      throw new Error(`No user found for turn ${currentTurnNumber} in association ${associationId}.`);
    }

    const payoutUser = payoutUserAssociation.User;
    const monthlyAmount = association.monthlyAmount;
    let totalPot = 0;
    const logs = [];

    const allMembers = await UserAssociation.findAll({
      where: { AssociationId: associationId, status: 'active' },
      include: [User],
      transaction,
    });

    for (const member of allMembers) {
      if (member.UserId === payoutUser.id) continue;

      if (member.User.walletBalance < monthlyAmount) {
        throw new Error(`User ${member.User.id} (${member.User.fullName}) has insufficient funds (${member.User.walletBalance}) to pay ${monthlyAmount}.`);
      }
      await member.User.update({
        walletBalance: sequelize.literal(`walletBalance - ${monthlyAmount}`),
      }, { transaction });

      totalPot += monthlyAmount;
      logs.push(`Collected ${monthlyAmount} from user ${member.UserId}.`);
    }

    // admin fee
    const feeRatios = calculateFeeRatios(association.duration);
    const feePercent = feeRatios[currentTurnNumber - 1] || 0;
    const totalAssociationValue = association.monthlyAmount * association.duration;
    const feeAmount = feePercent * totalAssociationValue;
    const payoutAmount = totalPot - feeAmount;

    // Credit admin's wallet
    if (feeAmount !== 0) {
      const admin = await User.findOne({ where: { role: 'admin' }, order: [['createdAt', 'ASC']], transaction });
      if (admin) {
        await admin.update({
          walletBalance: sequelize.literal(`walletBalance + ${feeAmount}`),
        }, { transaction });
        logs.push(`Credited admin ${admin.id} with fee ${feeAmount}.`);
      } else {
        logs.push(`Warning: No admin found to credit fee of ${feeAmount}.`);
      }
    }

    await payoutUser.update({
      walletBalance: sequelize.literal(`walletBalance + ${payoutAmount}`),
    }, { transaction });

    await payoutUserAssociation.update({
      hasReceived: true,
      lastReceivedDate: new Date(),
    }, { transaction });

    logs.push(`Paid out ${payoutAmount} to user ${payoutUser.id} (Turn ${currentTurnNumber}).`);

    if (currentTurnNumber === association.duration) {
      await association.update({ status: 'completed' }, { transaction });
      logs.push(`Association ${association.id} marked as completed.`);
    }

    await transaction.commit();

    return {
      success: true,
      message: `Cycle for turn ${currentTurnNumber} completed successfully for association ${associationId}.`,
      logs,
    };
  } catch (error) {
    if (transaction.finished !== 'commit' && transaction.finished !== 'rollback') {
      await transaction.rollback();
    }
    console.error(`[ROSCAService] Error in triggerCycleForAssociation for ID ${associationId}:`, error);
    throw error;
  }
}

module.exports = {
  triggerCycleForAssociation,
};
