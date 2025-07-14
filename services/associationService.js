const { Association, User, UserAssociation, Payment, Turn } = require('../models');
const sequelize = require('../config/db');
const { Op } = require('sequelize');
const { triggerCycleForAssociation } = require('./roscaService'); // or wherever you keep this

// ======== Helper: Dynamic Fee Ratios =========
function calculateFeeRatios(duration) {
  const ratios = [];
  for (let i = 0; i < duration; i++) {
    if (i < 4) {
      ratios.push(0.07);
    } else if (i < duration - 1) {
      ratios.push(0.05);
    } else if (i === duration - 1) {
      ratios.push(-0.02);
    }
  }
  return ratios;
}

module.exports = {
  // Create Association
  async createAssociation(data) {
    const transaction = await sequelize.transaction();
    try {
      const { name, monthlyAmount, maxMembers, startDate, type, duration } = data;
      const errors = [];

      if (!name || name.trim().length < 3) {
        errors.push('الاسم مطلوب ويجب أن يكون على الأقل 3 أحرف');
      }
      if (!monthlyAmount || isNaN(monthlyAmount)) {
        errors.push('المبلغ الشهري مطلوب ويجب أن يكون رقمًا');
      }

      let actualDuration = 10;
      if (type === '6-months' || duration == 6) {
        actualDuration = 6;
      } else if (maxMembers) {
        actualDuration = parseInt(maxMembers) || 10;
      }
      if (actualDuration < 1 || actualDuration > 100) {
        errors.push('عدد الأعضاء يجب أن يكون بين 1 و 100');
      }

      if (errors.length > 0) {
        throw { status: 400, errors };
      }

      const processedData = {
        name: name.trim(),
        monthlyAmount: parseFloat(monthlyAmount),
        duration: actualDuration,
        startDate: startDate ? new Date(startDate) : new Date(),
        status: 'pending',
        type: type || 'B',
        maxMembers: actualDuration
      };
      if (isNaN(processedData.startDate.getTime())) {
        throw { status: 400, error: 'تاريخ بداية غير صحيح' };
      }

      const existingAssociation = await Association.findOne({
        where: { name: processedData.name }
      });
      if (existingAssociation) {
        throw {
          status: 409,
          error: 'اسم الجمعية موجود مسبقًا',
          existingId: existingAssociation.id
        };
      }

      const association = await Association.create(processedData, { transaction });

      // ======= Use Dynamic Fee Logic Here ========
      const feeRatios = calculateFeeRatios(actualDuration);
      const turns = [];
      const startDateObj = new Date(processedData.startDate);
      const totalPayout = processedData.monthlyAmount * actualDuration;

      for (let i = 1; i <= actualDuration; i++) {
        const turnDate = new Date(startDateObj);
        turnDate.setMonth(turnDate.getMonth() + (i - 1));
        let feeRatio = feeRatios[i - 1] || 0;
        let feeAmount = totalPayout * feeRatio;
        turns.push({
          turnName: `الدور ${i}`,
          scheduledDate: turnDate,
          feeAmount,
          isTaken: false,
          associationId: association.id,
          turnNumber: i
        });
      }

      for (const turnData of turns) {
        await Turn.create(turnData, { transaction });
      }

      await transaction.commit();

      return {
        message: 'تم إنشاء الجمعية بنجاح',
        association: {
          id: association.id,
          name: association.name,
          monthlyAmount: association.monthlyAmount,
          status: association.status || 'active',
          duration: association.duration,
          startDate: association.startDate.toISOString().split('T')[0],
          type: association.type,
          maxMembers: association.maxMembers,
          total: totalPayout
        },
        turns: turns.map(turn => ({
          turnName: turn.turnName,
          scheduledDate: turn.scheduledDate,
          feeAmount: turn.feeAmount,
          turnNumber: turn.turnNumber
        }))
      };

    } catch (error) {
      await transaction.rollback();
      if (error.status) throw error;
      throw new Error('فشل في إنشاء الجمعية');
    }
  },

  // Get Associations (list, paginated)
  async getAssociations(query) {
    const { page = 1, pageSize = 10, status } = query;
    const parsedPage = Math.max(1, parseInt(page) || 1);
    const parsedPageSize = Math.min(Math.max(1, parseInt(pageSize) || 10), 100);

    const whereClause = {};
    if (status) {
      whereClause.status = { [Op.eq]: status || "pending" };
    }

    const { count, rows } = await Association.findAndCountAll({
      where: whereClause,
      limit: parsedPageSize,
      offset: (parsedPage - 1) * parsedPageSize,
      order: [['createdAt', 'DESC']]
    });

    const totalPages = Math.ceil(count / parsedPageSize);

    return {
      success: true,
      total: count,
      currentPage: parsedPage,
      totalPages: totalPages,
      data: rows
    };
  },

  // Update Association
  async updateAssociation(id, data) {
    const association = await Association.findByPk(id);
    if (!association) throw new Error('الجمعية غير موجودة');
    if (association.status === 'completed') {
      throw new Error('لا يمكن تعديل جمعية مكتملة');
    }
    await association.update(data);
    return association;
  },

  // Delete Association
  async deleteAssociation(id) {
    const association = await Association.findByPk(id);
    if (!association) throw new Error('الجمعية غير موجودة');
    await association.destroy();
    return true;
  },

  // Join Association
  async joinAssociation(userId, associationId, turnNumber) {
    const transaction = await sequelize.transaction();
    try {
      if (!turnNumber) {
        throw { status: 400, error: 'رقم الدور مطلوب' };
      }

      // Fetch association and user
      const [association, user] = await Promise.all([
        Association.findByPk(associationId, { transaction }),
        User.findByPk(userId, { transaction })
      ]);
      if (!association) throw { status: 404, error: 'الجمعية غير موجودة' };
      if (!user) throw { status: 404, error: 'المستخدم غير موجود' };
      if (association.status !== 'pending') throw { status: 400, error: 'لا يمكن الانضمام لجمعية غير نشطة' };

      const existingMembership = await UserAssociation.findOne({
        where: { UserId: userId, AssociationId: associationId },
        transaction
      });
      if (existingMembership) throw { status: 409, error: 'أنت مسجل بالفعل في هذه الجمعية' };

      const turnTaken = await UserAssociation.findOne({
        where: { AssociationId: associationId, turnNumber },
        transaction
      });
      if (turnTaken) throw { status: 409, error: `الدور رقم ${turnNumber} محجوز بالفعل` };

      const turn = await Turn.findOne({
        where: { associationId: associationId, turnNumber: turnNumber },
        transaction
      });
      if (!turn) throw { status: 404, error: 'هذا الدور غير موجود' };
      if (turn.isTaken) throw { status: 409, error: `هذا الدور محجوز بالفعل` };

      // Dynamic Fee Calculation
      const feeRatios = calculateFeeRatios(association.duration);
      let feeRatio = feeRatios[turnNumber - 1] || 0;
      const totalPayout = association.monthlyAmount * association.duration;
      const feeAmount = totalPayout * feeRatio;

      const newMembership = await UserAssociation.create({
        UserId: userId,
        AssociationId: associationId,
        turnNumber,
        joinDate: new Date(),
        status: 'active',
        remainingAmount: association.monthlyAmount * association.duration
      }, { transaction });

      await Payment.create({
        userId,
        associationId,
        amount: 0,
        feeAmount,
        feePercent: feeRatio,
        paymentDate: new Date()
      }, { transaction });

      await Turn.update({
        isTaken: true,
        userId: userId,
        pickedAt: new Date()
      }, {
        where: { associationId: associationId, turnNumber: turnNumber },
        transaction
      });

      // Set association to active if full
      const memberCount = await UserAssociation.count({
        where: { AssociationId: associationId },
        transaction
      });
      if (memberCount === association.maxMembers) {
        await association.update({
          status: 'active',
        }, { transaction });
      }

      await transaction.commit();
      return {
        success: true,
        message: `تم التسجيل في الجمعية بالدور رقم ${turnNumber}`,
        fee: {
          turnNumber,
          feeAmount,
          feePercent: feeRatio
        },
        membership: {
          turnNumber,
          joinDate: newMembership.joinDate,
          remainingAmount: newMembership.remainingAmount
        }
      };

    } catch (error) {
      await transaction.rollback();
      if (error.status) throw error;
      throw new Error('حدث خطأ أثناء الانضمام إلى الجمعية');
    }
  },

  // My Associations
  async getUserAssociations(userId) {
    const userWithAssociations = await User.findByPk(userId, {
      include: [{
        model: Association,
        as: 'Associations',
        through: {
          attributes: ['joinDate', 'turnNumber', 'hasReceived', 'lastReceivedDate']
        },
        attributes: ['id', 'name', 'monthlyAmount', 'duration', 'startDate', 'status']
      }]
    });
    if (!userWithAssociations) {
      throw new Error('المستخدم غير موجود');
    }
    const formattedData = userWithAssociations.Associations.map(association => ({
      id: association.id,
      name: association.name,
      monthlyAmount: association.monthlyAmount,
      duration: association.duration,
      startDate: association.startDate,
      status: association.status,
      joinDate: association.UserAssociation.joinDate,
      turnNumber: association.UserAssociation.turnNumber,
      hasReceived: association.UserAssociation.hasReceived,
      lastReceivedDate: association.UserAssociation.lastReceivedDate
    }));
    return { success: true, data: formattedData };
  },

  // Association Members
  async getAssociationMembers(associationId) {
    const members = await UserAssociation.findAll({
      where: { AssociationId: associationId },
      include: [{
        model: User,
        attributes: ['id', 'fullName', 'phone']
      }],
      order: [['turnNumber', 'ASC']]
    });
    const result = members.map(member => ({
      userId: member.User.id,
      name: member.User.fullName,
      phone: member.User.phone,
      hasReceived: member.hasReceived,
      turnNumber: member.turnNumber,
      lastReceivedDate: member.lastReceivedDate
    }));
    return { success: true, data: result };
  },

  // Preview Fee
  async previewFee(associationId, turnNumber) {
    if (!turnNumber) {
      throw { status: 400, error: 'رقم الدور مطلوب' };
    }
    const association = await Association.findByPk(associationId);
    if (!association) {
      throw { status: 404, error: 'الجمعية غير موجودة' };
    }
    const feeRatios = calculateFeeRatios(association.duration);
    let feeRatio = feeRatios[turnNumber - 1] || 0;
    const totalPayout = association.monthlyAmount * association.duration;
    const feeAmount = totalPayout * feeRatio;
    return {
      success: true,
      feePercent: feeRatio,
      feeAmount,
      turnNumber,
      monthlyAmount: association.monthlyAmount
    };
  },

  // Available Turns
  async getAvailableTurns(associationId) {
    const association = await Association.findByPk(associationId);
    if (!association) {
      throw { status: 404, error: 'الجمعية غير موجودة' };
    }
    const existingTurns = await UserAssociation.findAll({
      where: { AssociationId: associationId },
      attributes: ['turnNumber']
    });
    const takenTurns = new Set(existingTurns.map(t => t.turnNumber));
    const maxTurns = association.duration;
    const feeRatios = calculateFeeRatios(maxTurns);
    const totalPayout = association.monthlyAmount * maxTurns;
    const availableTurns = [];

    for (let i = 1; i <= maxTurns; i++) {
      if (!takenTurns.has(i)) {
        let feeRatio = feeRatios[i - 1] || 0;
        const feeAmount = totalPayout * feeRatio;
        availableTurns.push({
          turnNumber: i,
          feePercent: feeRatio,
          feeAmount,
          monthlyAmount: association.monthlyAmount,
          category: i <= Math.ceil(maxTurns * 0.5)
            ? 'early'
            : i <= Math.ceil(maxTurns * 0.7)
              ? 'middle'
              : 'late'
        });
      }
    }
    return {
      success: true,
      availableTurns
    };
  },

  // Get Association By ID
  async getAssociationById(associationId) {
    const association = await Association.findByPk(associationId);
    if (!association) {
      throw { status: 404, error: 'الجمعية غير موجودة' };
    }
    return { success: true, data: association };
  },

  // Manual Payout Cycle
  async triggerCycleForAssociation(associationId) {
    // Assumes your existing service function
    return await triggerCycleForAssociation(associationId);
  },
};
