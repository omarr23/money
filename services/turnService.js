const { Turn, User, Association, UserAssociation } = require('../models');
const sequelize = require('../config/db');
const { Op } = require('sequelize');

// Helper: Fee ratios
function calculateFeeRatios(duration) {
  const ratios = [];
  for (let i = 0; i < duration; i++) {
    if (i < 4) ratios.push(0.07);
    else if (i < duration - 1) ratios.push(0.05);
    else if (i === duration - 1) ratios.push(-0.02);
  }
  return ratios;
}

module.exports = {
  // Pick/lock a turn for user
  async pickTurn(userId, turnId) {
    const transaction = await sequelize.transaction();
    try {
      // Already has a turn?
      const existingTurn = await Turn.findOne({
        where: { userId, isTaken: true },
        transaction
      });
      if (existingTurn) {
        throw {
          status: 400,
          success: false,
          error: 'لديك دور محجوز بالفعل',
          existingTurn: {
            id: existingTurn.id,
            turnName: existingTurn.turnName,
            scheduledDate: existingTurn.scheduledDate
          }
        };
      }

      const turn = await Turn.findByPk(turnId, { transaction, lock: true });
      if (!turn) throw { status: 404, success: false, error: 'الدور غير موجود' };
      if (turn.isTaken) throw { status: 400, success: false, error: 'هذا الدور محجوز بالفعل' };

      const user = await User.findByPk(userId, { transaction, lock: true });
      if (!user) throw { status: 404, success: false, error: 'المستخدم غير موجود' };
      if (user.walletBalance < turn.feeAmount) {
        throw {
          status: 400,
          success: false,
          error: 'رصيد المحفظة غير كافي',
          requiredAmount: turn.feeAmount,
          currentBalance: user.walletBalance
        };
      }

      await turn.update({
        isTaken: true,
        userId,
        pickedAt: new Date()
      }, { transaction });

      await user.update({
        walletBalance: sequelize.literal(`walletBalance - ${turn.feeAmount}`)
      }, { transaction });

      await transaction.commit();

      return {
        success: true,
        message: 'تم حجز الدور بنجاح',
        turn: {
          id: turn.id,
          turnName: turn.turnName,
          scheduledDate: turn.scheduledDate,
          feeAmount: turn.feeAmount,
          pickedAt: turn.pickedAt
        }
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  // All available future turns
  async getAvailableTurns() {
    const turns = await Turn.findAll({
      where: {
        isTaken: false,
        scheduledDate: { [Op.gt]: new Date() }
      },
      order: [['scheduledDate', 'ASC']]
    });

    return {
      success: true,
      turns: turns.map(turn => ({
        id: turn.id,
        turnName: turn.turnName,
        scheduledDate: turn.scheduledDate,
        feeAmount: turn.feeAmount
      }))
    };
  },

  // All taken turns for a user
  async getUserTurns(userId) {
    const turns = await Turn.findAll({
      where: { userId, isTaken: true },
      include: [{ model: Association, as: 'Association' }],
      order: [['scheduledDate', 'ASC']]
    });
    if (!turns || turns.length === 0) {
      throw { status: 404, success: false, error: 'لا يوجد لديك دور محجوز' };
    }

    // Map all user's turns
    const results = turns.map(turn => {
      const assoc = turn.Association;
      const totalPayout = assoc.monthlyAmount * assoc.duration;
      const contractDeliveryFee = assoc.contractDeliveryFee || 50;
      const feeRatios = calculateFeeRatios(assoc.duration);
      const turnIdx = (turn.turnNumber || 1) - 1;
      const feeRatio = feeRatios[turnIdx] || 0;
      const feeAmount = +(totalPayout * feeRatio).toFixed(2);
      const finalAmount = +(totalPayout - feeAmount - contractDeliveryFee).toFixed(2);

      // Time left till scheduledDate
      const now = new Date();
      const scheduledDate = new Date(turn.scheduledDate);
      const timeLeftMs = scheduledDate - now;
      const timeLeft = timeLeftMs > 0 ? {
        days: Math.floor(timeLeftMs / (1000 * 60 * 60 * 24)),
        hours: Math.floor((timeLeftMs / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((timeLeftMs / (1000 * 60)) % 60),
        seconds: Math.floor((timeLeftMs / 1000) % 60)
      } : null;

      return {
        id: turn.id,
        associationId: assoc.id,
        associationName: assoc.name,
        turnName: turn.turnName,
        scheduledDate: turn.scheduledDate,
        pickedAt: turn.pickedAt,
        timeLeft,
        turnNumber: turn.turnNumber,
        monthlyAmount: assoc.monthlyAmount,
        currentTurn: {
          currentTurnMember: {
            userId: turn.userId,
            turnNumber: turn.turnNumber,
            hasReceived: turn.hasReceived || false
          },
          totalPayout,
          feeAmount,
          contractDeliveryFee,
          finalAmount
        }
      };
    });

    return { success: true, turns: results };
  },

  // All turns for user's first association
  async getTurnsForUserAssociation(userId) {
    const user = await User.findByPk(userId, {
      include: {
        model: Association,
        as: 'Associations',
        through: { attributes: [] }
      }
    });

    const userAssociation = user.Associations[0];
    if (!userAssociation) {
      throw { status: 404, error: 'المستخدم غير منضم إلى أي جمعية' };
    }

    const turns = await Turn.findAll({ order: [['scheduledDate', 'ASC']] });

    const enriched = turns.map((turn) => ({
      id: turn.id,
      turnName: turn.turnName,
      scheduledDate: turn.scheduledDate,
      feeAmount: turn.feeAmount,
      taken: turn.isTaken,
      association: {
        startDate: userAssociation.startDate,
        monthlyAmount: userAssociation.monthlyAmount
      }
    }));

    return enriched;
  },

  // Select a turn by body (alternate pick)
  async selectTurn(userId, turnId) {
    const turn = await Turn.findByPk(turnId);

    if (!turn || turn.isTaken) {
      throw { status: 400, error: 'هذا الدور غير متاح' };
    }

    turn.userId = userId;
    turn.isTaken = true;
    turn.pickedAt = new Date();
    await turn.save();

    return { success: true, message: 'تم حجز الدور بنجاح' };
  },

  // Get all turns for an association (user must be member)
  async getTurnsForAssociation(userId, associationId) {
    // Check if user is a member of the association
    const userAssociation = await UserAssociation.findOne({
      where: { userId, associationId }
    });

    if (!userAssociation) {
      throw { status: 403, error: 'غير مصرح لك بالوصول إلى هذه الجمعية' };
    }

    const turns = await Turn.findAll({
      where: { associationId },
      order: [['turnNumber', 'ASC']],
      include: [{
        model: Association,
        attributes: ['name', 'monthlyAmount', 'startDate']
      }]
    });

    // Enrich turns with category information
    const enrichedTurns = turns.map(turn => {
      let category;
      if (turn.turnNumber <= 4) category = 'early';
      else if (turn.turnNumber <= 7) category = 'middle';
      else category = 'late';

      return {
        id: turn.id,
        turnName: turn.turnName,
        scheduledDate: turn.scheduledDate,
        feeAmount: turn.feeAmount,
        isTaken: turn.isTaken,
        turnNumber: turn.turnNumber,
        category,
        association: {
          name: turn.Association.name,
          monthlyAmount: turn.Association.monthlyAmount,
          startDate: turn.Association.startDate
        }
      };
    });

    return { success: true, turns: enrichedTurns };
  },

  // Pick a turn (alt. endpoint)
  async pickTurnForAssociation(userId, turnId) {
    const transaction = await sequelize.transaction();
    try {
      const turn = await Turn.findByPk(turnId, {
        include: [{
          model: Association,
          attributes: ['monthlyAmount']
        }]
      });

      if (!turn) throw { status: 404, error: 'الدور غير موجود' };
      if (turn.isTaken) throw { status: 400, error: 'هذا الدور محجوز بالفعل' };

      // Check if user is a member of the association
      const userAssociation = await UserAssociation.findOne({
        where: { userId, associationId: turn.associationId }
      });

      if (!userAssociation) throw { status: 403, error: 'يجب أن تكون عضوًا في الجمعية لاختيار دور' };

      turn.isTaken = true;
      turn.takenBy = userId;
      await turn.save({ transaction });

      await transaction.commit();
      return { message: 'تم اختيار الدور بنجاح', turn };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  // Admin: Create a new turn
  async createTurn(data) {
    const { associationId, turnName, scheduledDate, feeAmount, turnNumber } = data;
    if (!associationId || !turnName || !scheduledDate || !turnNumber) {
      throw { status: 400, error: 'جميع الحقول مطلوبة' };
    }

    const association = await Association.findByPk(associationId);
    if (!association) throw { status: 404, error: 'الجمعية غير موجودة' };

    const existingTurn = await Turn.findOne({
      where: { associationId, turnNumber }
    });

    if (existingTurn) throw { status: 400, error: 'رقم الدور موجود بالفعل في هذه الجمعية' };

    const turn = await Turn.create({
      associationId,
      turnName,
      scheduledDate,
      feeAmount: feeAmount || association.monthlyAmount * 0.1,
      turnNumber,
      isTaken: false
    });

    return turn;
  },

  // Admin: Update a turn
  async updateTurn(turnId, data) {
    const { turnName, scheduledDate, feeAmount, turnNumber } = data;

    const turn = await Turn.findByPk(turnId);
    if (!turn) throw { status: 404, error: 'الدور غير موجود' };

    // If changing turn number, check for duplicates
    if (turnNumber && turnNumber !== turn.turnNumber) {
      const existingTurn = await Turn.findOne({
        where: {
          associationId: turn.associationId,
          turnNumber
        }
      });
      if (existingTurn) throw { status: 400, error: 'رقم الدور موجود بالفعل في هذه الجمعية' };
    }

    await turn.update({
      turnName: turnName || turn.turnName,
      scheduledDate: scheduledDate || turn.scheduledDate,
      feeAmount: feeAmount || turn.feeAmount,
      turnNumber: turnNumber || turn.turnNumber
    });

    return turn;
  },

  // Admin: Delete a turn
  async deleteTurn(turnId) {
    const turn = await Turn.findByPk(turnId);
    if (!turn) throw { status: 404, error: 'الدور غير موجود' };
    if (turn.isTaken) throw { status: 400, error: 'لا يمكن حذف دور محجوز' };

    await turn.destroy();
    return { message: 'تم حذف الدور بنجاح' };
  },

  // All turns for dashboard, etc.
  async getAllTurnsFormatted() {
    const turns = await Turn.findAll({ order: [['scheduledDate', 'ASC']] });

    const formattedTurns = turns.map(turn => {
      const isLocked = turn.isTaken;
      const eligibilityReason = isLocked ? 'Turn is already taken.' : null;

      return {
        name: turn.turnName,
        month: new Date(turn.scheduledDate).getMonth() + 1,
        year: new Date(turn.scheduledDate).getFullYear(),
        fee: turn.feeAmount,
        isLocked: isLocked,
        eligibilityReason: eligibilityReason
      };
    });

    return formattedTurns;
  },

  // Get current turn/public info for an association
  async getPublicTurnsInfo(associationId) {
    const association = await Association.findByPk(associationId);
    if (!association) throw { status: 404, error: 'الجمعية غير موجودة' };

    const members = await UserAssociation.findAll({
      where: { AssociationId: associationId },
      order: [['turnNumber', 'ASC']]
    });

    // Find the current turn member (first who has not received)
    const currentTurnMember = members.find(m => !m.hasReceived);

    let turnInfo = null;
    if (currentTurnMember) {
      const totalPayout = association.monthlyAmount * association.duration;
      const feeRatios = calculateFeeRatios(association.duration);
      const feeRatio = feeRatios[(currentTurnMember.turnNumber || 1) - 1] || 0;
      const feeAmount = totalPayout * feeRatio;
      const contractDeliveryFee = 50;
      const finalAmount = totalPayout - feeAmount - contractDeliveryFee;
      turnInfo = {
        currentTurnMember: {
          userId: currentTurnMember.UserId || currentTurnMember.userId,
          turnNumber: currentTurnMember.turnNumber,
          hasReceived: currentTurnMember.hasReceived,
        },
        totalPayout,
        feeAmount,
        contractDeliveryFee,
        finalAmount
      };
    }

    const turns = await Turn.findAll({
      where: { associationId },
      include: [{
        model: Association,
        as: 'Association',
        attributes: ['startDate', 'monthlyAmount']
      }],
      order: [['turnNumber', 'ASC']]
    });

    const result = turns.map(turn => ({
      id: turn.id,
      turnName: turn.turnName,
      scheduledDate: turn.scheduledDate,
      feeAmount: turn.feeAmount,
      taken: turn.isTaken,
      association: {
        startDate: turn.Association?.startDate,
        monthlyAmount: turn.Association?.monthlyAmount
      }
    }));

    return { turns: result, currentTurn: turnInfo };
  }
};
