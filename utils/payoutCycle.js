const { Association, UserAssociation, User, sequelize } = require('../models');

const INTERVAL_MS = 30 * 1000;      // demo: 30 s between turns

module.exports = function startPayoutCycle(associationId) {
  let currentTurn = 1;

  const runTurn = async () => {
    await sequelize.transaction(async (t) => {
      const association = await Association.findByPk(associationId, { transaction:t });
      const members = await UserAssociation.findAll({
        where:{ AssociationId:associationId, status:'active' },
        include: [ { model: User, lock:true } ],
        order:[['turnNumber','ASC']],
        lock: t.LOCK.UPDATE, transaction:t
      });

      if (members.length === 0) return;                   // safety

      const pot = association.monthlyAmount * members.length;

      // === 1. debit everyone ===
      for (const m of members) {
        const u = m.User;
        if (+u.walletBalance < +association.monthlyAmount) {
          m.status = 'suspended';
          await m.save({ transaction:t });
          continue;
        }
        u.walletBalance -= association.monthlyAmount;
        await u.save({ transaction:t });
      }

      // === 2. credit turn holder ===
      const recipient = members.find(m => m.turnNumber === currentTurn);
      if (recipient) {
        recipient.User.walletBalance = (+recipient.User.walletBalance) + (+pot);
        recipient.hasReceived        = true;
        recipient.lastReceivedDate   = new Date();
        await Promise.all([
          recipient.User.save({ transaction:t }),
          recipient.save({ transaction:t })
        ]);
      }

      // === 3. advance ===
      currentTurn++;
      if (currentTurn > members.length) {
        association.status = 'completed';
        await association.save({ transaction:t });
        return;                            // stop cycle
      }
    });

    // schedule next run
    setTimeout(runTurn, INTERVAL_MS);
  };

  // kick‑off
  setTimeout(runTurn, INTERVAL_MS);
};
