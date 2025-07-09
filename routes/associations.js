const express = require('express');
const router = express.Router();
const { User, Association, UserAssociation, Payment, Turn } = require('../models');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const { Op } = require('sequelize');
const sequelize = require('../config/db');
const { triggerCycleForAssociation } = require('../services/roscaService');

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

// ========== Create Association ==========
router.post('/', [auth, admin], async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { name, monthlyAmount, maxMembers, startDate, type, duration } = req.body;
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
      return res.status(400).json({ errors });
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
      return res.status(400).json({ error: 'تاريخ بداية غير صحيح' });
    }

    const existingAssociation = await Association.findOne({
      where: { name: processedData.name }
    });
    if (existingAssociation) {
      return res.status(409).json({
        error: 'اسم الجمعية موجود مسبقًا',
        existingId: existingAssociation.id
      });
    }

    const association = await Association.create(processedData, { transaction });

    // ======= Use Dynamic Fee Logic Here ========
    const feeRatios = calculateFeeRatios(actualDuration);
    const turns = [];
    const startDateObj = new Date(processedData.startDate);
    const totalPayout = processedData.monthlyAmount * actualDuration; // FEE BASED ON TOTAL

    for (let i = 1; i <= actualDuration; i++) {
      const turnDate = new Date(startDateObj);
      turnDate.setMonth(turnDate.getMonth() + (i - 1));
      let feeRatio = feeRatios[i - 1] || 0;
      let feeAmount = totalPayout * feeRatio; // FEE BASED ON TOTAL
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

    res.status(201).json({
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
    });

  } catch (error) {
    await transaction.rollback();
    console.error('تفاصيل الخطأ:', error);
    if (error.name === 'SequelizeValidationError') {
      const errors = error.errors.map(err => ({
        field: err.path,
        message: err.message
      }));
      return res.status(400).json({ errors });
    }
    res.status(500).json({
      error: 'فشل في إنشاء الجمعية',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, pageSize = 10, status } = req.query;
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

    res.json({
      success: true,
      total: count,
      currentPage: parsedPage,
      totalPages: totalPages,
      data: rows
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في الاسترجاع',
      details: process.env.NODE_ENV === 'development' ? error.message : null
    });
  }
});

// تحديث الجمعية (للمدير فقط)
router.put('/:id', [auth, admin], async (req, res) => {
  try {
    const association = await Association.findByPk(req.params.id);
    if (!association) return res.status(404).send('الجمعية غير موجودة');
    if (association.status === 'completed') {
      return res.status(400).json({ error: 'لا يمكن تعديل جمعية مكتملة' });
    }
    await association.update(req.body);
    res.json(association);
  } catch (error) {
    res.status(500).json({ error: 'خطأ في التحديث' });
  }
});

// حذف الجمعية (للمدير فقط)
router.delete('/:id', [auth, admin], async (req, res) => {
  try {
    const association = await Association.findByPk(req.params.id);
    if (!association) return res.status(404).json({ error: 'الجمعية غير موجودة' });
    await association.destroy();
    res.json({ message: 'تم حذف الجمعية بنجاح' });
  } catch (error) {
    res.status(500).json({ error: 'خطأ في الحذف' });
  }
});

// التسجيل في جمعية (للمستخدمين العاديين)
router.post('/:id/join', auth, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const associationId = req.params.id;
    const { turnNumber } = req.body;
    const userId = req.user.id;
    if (!turnNumber) {
      await transaction.rollback();
      return res.status(400).json({ error: 'رقم الدور مطلوب' });
    }

    // Fetch association and user
    const [association, user] = await Promise.all([
      Association.findByPk(associationId, { transaction }),
      User.findByPk(userId, { transaction })
    ]);
    if (!association) {
      await transaction.rollback();
      return res.status(404).json({ error: 'الجمعية غير موجودة' });
    }
    if (!user) {
      await transaction.rollback();
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }
    if (association.status !== 'pending') {
      await transaction.rollback();
      return res.status(400).json({ error: 'لا يمكن الانضمام لجمعية غير نشطة' });
    }
    const existingMembership = await UserAssociation.findOne({
      where: { userId, AssociationId: associationId },
      transaction
    });
    if (existingMembership) {
      await transaction.rollback();
      return res.status(409).json({ error: 'أنت مسجل بالفعل في هذه الجمعية' });
    }
    const turnTaken = await UserAssociation.findOne({
      where: { AssociationId: associationId, turnNumber },
      transaction
    });
    if (turnTaken) {
      await transaction.rollback();
      return res.status(409).json({ error: `الدور رقم ${turnNumber} محجوز بالفعل` });
    }
    const turn = await Turn.findOne({
      where: { associationId: associationId, turnNumber: turnNumber },
      transaction
    });
    if (!turn) {
      await transaction.rollback();
      return res.status(404).json({ error: 'هذا الدور غير موجود' });
    }
    if (turn.isTaken) {
      await transaction.rollback();
      return res.status(409).json({ error: `هذا الدور محجوز بالفعل` });
    }

    // ======= Dynamic Fee Calculation Here =======
    const feeRatios = calculateFeeRatios(association.duration);
    let feeRatio = feeRatios[turnNumber - 1] || 0;
    const totalPayout = association.monthlyAmount * association.duration; // FEE BASED ON TOTAL
    const feeAmount = totalPayout * feeRatio; // FEE BASED ON TOTAL

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

    await transaction.commit();
    return res.status(201).json({
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
    });

  } catch (error) {
    await transaction.rollback();
    console.error('Error joining association:', error);
    return res.status(500).json({ error: 'حدث خطأ أثناء الانضمام إلى الجمعية' });
  }
});

router.get('/my-associations', auth, async (req, res) => {
  try {
    const user = req.user;
    const userWithAssociations = await User.findByPk(user.id, {
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
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
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
    res.json({ success: true, data: formattedData });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في الاسترجاع',
      details: process.env.NODE_ENV === 'development' ? error.message : null
    });
  }
});

// Get members of an association with their payout info
router.get('/:id/members', async (req, res) => {
  try {
    const associationId = req.params.id;
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
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ========== PREVIEW FEE FOR ANY TURN ==========
router.post('/:id/preview-fee', auth, async (req, res) => {
  try {
    const { turnNumber } = req.body;
    const associationId = req.params.id;
    if (!turnNumber) {
      return res.status(400).json({ success: false, error: 'رقم الدور مطلوب' });
    }
    const association = await Association.findByPk(associationId);
    if (!association) {
      return res.status(404).json({ success: false, error: 'الجمعية غير موجودة' });
    }
    const feeRatios = calculateFeeRatios(association.duration);
    let feeRatio = feeRatios[turnNumber - 1] || 0;
    const totalPayout = association.monthlyAmount * association.duration; // FEE BASED ON TOTAL
    const feeAmount = totalPayout * feeRatio; // FEE BASED ON TOTAL
    return res.status(200).json({
      success: true,
      feePercent: feeRatio,
      feeAmount,
      turnNumber,
      monthlyAmount: association.monthlyAmount
    });
  } catch (err) {
    console.error('Preview fee error:', err);
    return res.status(500).json({ success: false, error: 'خطأ في حساب الرسوم' });
  }
});

// ========== AVAILABLE TURNS ==========
router.get('/:id/available-turns', auth, async (req, res) => {
  try {
    const associationId = req.params.id;
    const association = await Association.findByPk(associationId);
    if (!association) {
      return res.status(404).json({ success: false, error: 'الجمعية غير موجودة' });
    }
    const existingTurns = await UserAssociation.findAll({
      where: { AssociationId: associationId },
      attributes: ['turnNumber']
    });
    const takenTurns = new Set(existingTurns.map(t => t.turnNumber));
    const maxTurns = association.duration;
    const feeRatios = calculateFeeRatios(maxTurns);
    const totalPayout = association.monthlyAmount * maxTurns; // FEE BASED ON TOTAL
    const availableTurns = [];

    for (let i = 1; i <= maxTurns; i++) {
      if (!takenTurns.has(i)) {
        let feeRatio = feeRatios[i - 1] || 0;
        const feeAmount = totalPayout * feeRatio; // FEE BASED ON TOTAL
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
    res.status(200).json({
      success: true,
      availableTurns
    });
  } catch (err) {
    console.error('Error fetching available turns:', err);
    res.status(500).json({ success: false, error: 'خطأ في جلب الأدوار المتاحة' });
  }
});

// Get a single association by ID
router.get('/:id', async (req, res) => {
  try {
    const associationId = req.params.id;
    const association = await Association.findByPk(associationId);
    if (!association) {
      return res.status(404).json({ success: false, error: 'الجمعية غير موجودة' });
    }
    res.json({ success: true, data: association });
  } catch (error) {
    console.error('Error fetching association:', error);
    res.status(500).json({ success: false, error: 'خطأ في جلب الجمعية' });
  }
});
// Trigger payout cycle for testing
router.post('/test-cycle', [auth, admin], async (req, res) => {
  const { associationId } = req.body;
  if (!associationId) {
    return res.status(400).json({ error: 'associationId is required.' });
  }
  try {
    const result = await triggerCycleForAssociation(associationId);
    res.json(result);
  } catch (error) {
    console.error('Manual payout cycle error:', error);
    res.status(500).json({ error: 'Failed to trigger payout cycle.', details: error.message });
  }
});

// ...the rest unchanged (test-cycle, add-user, get by id)
module.exports = router;
