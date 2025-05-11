const { UserAssociation, Association, User } = require('../models');

async function runCycleForAssociation(associationId) {
  const users = await UserAssociation.findAll({
    where: { AssociationId: associationId, hasReceived: false },
    order: [['turnNumber', 'ASC']],
    include: [User]
  });

  if (!users.length) return { done: true };

  const nextUser = users[0];

  const association = await Association.findByPk(associationId);
  const totalAmount = association.monthlyAmount * association.duration;

  const payoutUser = await User.findByPk(nextUser.UserId);
  payoutUser.walletBalance += totalAmount;
  await payoutUser.save();

  nextUser.hasReceived = true;
  nextUser.lastReceivedDate = new Date();
  await nextUser.save();

  return {
    done: false,
    userId: nextUser.UserId,
    associationId,
    amount: totalAmount
  };
}

module.exports = {
  runCycleForAssociation
};
