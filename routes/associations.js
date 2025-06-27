const express = require('express');
const router = express.Router();
const { User, Association, UserAssociation, Payment, Turn } = require('../models');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const { Op } = require('sequelize');
const sequelize = require('../config/db');
const { triggerCycleForAssociation } = require('../services/roscaService');
const { calculateFeeRatios } = require('../services/feeService');

// ========== Create Association ==========
router.post('/', [auth, admin], async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { name, monthlyAmount, maxMembers, startDate, type } = req.body;
    const errors = [];

    if (!name || name.trim().length < 3) {
      errors.push('الاسم مطلوب ويجب أن يكون على الأقل 3 أحرف');
    }
    if (!monthlyAmount || isNaN(monthlyAmount) || parseFloat(monthlyAmount) <= 0) {
      errors.push('المبلغ الشهري مطلوب ويجب أن يكون رقمًا');
    }
    const parsedMaxMembers = parseInt(maxMembers) || 10;
    if (parsedMaxMembers < 2 || parsedMaxMembers > 100) {
      errors.push('عدد الأعضاء يجب أن يكون بين 1 و 100');
    }
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    const processedData = {
      name: name.trim(),
      monthlyAmount: parseFloat(monthlyAmount),
      duration: parsedMaxMembers,
      startDate: startDate ? new Date(startDate) : new Date(),
      status: 'pending',
      type: type || 'B',
      maxMembers: parsedMaxMembers
    };
    if (isNaN(processedData.startDate.getTime())) {
      return res.status(400).json({ error: 'تاريخ بداية غير صحيح' });
    }

    const existingAssociation = await Association.findOne({ where: { name: processedData.name } });
    if (existingAssociation) {
      return res.status(409).json({
        error: 'اسم الجمعية موجود مسبقًا',
        existingId: existingAssociation.id
      });
    }

    const association = await Association.create(processedData, { transaction });
    const feeRatios = calculateFeeRatios(parsedMaxMembers);
    const turns = [];
    const startDateObj = new Date(processedData.startDate);

    for (let i = 1; i <= parsedMaxMembers; i++) {
      const turnDate = new Date(startDateObj);
      turnDate.setMonth(turnDate.getMonth() + (i - 1));
      const totalAssociationValue = processedData.monthlyAmount * parsedMaxMembers;
      const feeRatio = feeRatios[i - 1] || 0;
      const feeAmount = totalAssociationValue * feeRatio;

      turns.push({
        turnName: `الدور ${i}`,
        scheduledDate: turnDate,
        feeAmount,
        isTaken: false,
        associationId: association.id,
        turnNumber: i
      });
    }

    await Turn.bulkCreate(turns, { transaction });
    await transaction.commit();

    // Calculate total payout
    const totalPayout = association.monthlyAmount * association.duration;

    res.status(201).json({
      message: 'تم إنشاء الجمعية بنجاح',
      association: {
        id: association.id,
        name: association.name,
        monthlyAmount: association.monthlyAmount,
        status: association.status,
        duration: association.duration,
        startDate: association.startDate.toISOString().split('T')[0],
        type: association.type,
<<<<<<< HEAD
        maxMembers: association.maxMembers
      }
=======
        maxMembers: association.maxMembers,
        total: totalPayout
      },
      turns: turns.map(turn => ({
        turnName: turn.turnName,
        scheduledDate: turn.scheduledDate,
        feeAmount: turn.feeAmount,
        turnNumber: turn.turnNumber
      }))
>>>>>>> origin/dev
    });

  } catch (error) {
    if (transaction.finished !== 'commit') await transaction.rollback();
    console.error('تفاصيل الخطأ:', error);
    res.status(500).json({
      error: 'فشل في إنشاء الجمعية',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, pageSize = 10, status } = req.query;
    const parsedPage = Math.max(1, parseInt(page, 10));
    const parsedPageSize = Math.min(Math.max(1, parseInt(pageSize, 10)), 100);

    const whereClause = {};
    if (status) {
      whereClause.status = status;
    }

    const { count, rows } = await Association.findAndCountAll({
      where: whereClause,
      limit: parsedPageSize,
      offset: (parsedPage - 1) * parsedPageSize,
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      total: count,
      currentPage: parsedPage,
      totalPages: Math.ceil(count / parsedPageSize),
      data: rows
    });

  } catch (error) {
    console.error('Error fetching associations:', error);
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
    // Prevent updates to associations that have started or finished ?
    if (association.status === 'active' || association.status === 'completed') {
      return res.status(400).json({ error: 'Cannot modify an association that is active or completed.' });
    }

    // Only allow specific fields to be updated to prevent unwanted changes.
    const { name, monthlyAmount, startDate, type } = req.body;
    const updateData = {};
    if (name) updateData.name = name.trim();
    if (monthlyAmount) updateData.monthlyAmount = parseFloat(monthlyAmount);
    if (startDate) updateData.startDate = new Date(startDate);
    if (type) updateData.type = type;

    await association.update(updateData);

    res.json({
      message: 'Association updated successsfully.',
      association
    });

  } catch (error) {
    res.status(500).json({ error: 'خطأ في التحديث' });
  }
});

// حذف الجمعية (للمدير فقط)
router.delete('/:id', [auth, admin], async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const association = await Association.findByPk(req.params.id, { transaction });
    if (!association) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Association not found.' });
    }

    // Only allow deletion of 'pending' associations ?
    if (association.status !== 'pending') {
      await transaction.rollback();
      return res.status(400).json({ error: 'Cannot delete an association that is not in pending state. Preserve financial records.' });
    }

    await Turn.destroy({ where: { associationId: association.id }, transaction });
    await association.destroy({ transaction });

    await transaction.commit();

    res.json({ message: 'تم حذف الجمعية بنجاح' });

  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ error: 'خطأ في الحذف' });
  }
});



router.get('/:id', auth, async (req, res) => {
  try {
    const associationId = req.params.id;
    const association = await Association.findByPk(associationId);
    if (!association) {
      return res.status(404).json({ success: false, error: 'Association not found' });
    }
    res.json({ success: true, data: association });
  } catch (error) {
    console.error('Error fetching association:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve association' });
  }
});


// ========== Join an Association ==========
router.post('/:id/join', auth, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const associationId = req.params.id;
    const { turnNumber } = req.body;
    const userId = req.user.id;
    if (!turnNumber) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Turn number is required.' });
    }

    const [association, user] = await Promise.all([
      Association.findByPk(associationId, { transaction }),
      User.findByPk(userId, { transaction })
    ]);
    if (!association) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Association not found.' });
    }
    if (!user) {
      await transaction.rollback();
      return res.status(404).json({ error: 'User not found.' });
    }

    // --- CRITICAL CHECK: User must be approved by admin ---
    if (!user.profileApproved) {
      await transaction.rollback();
      return res.status(403).json({
        error: 'Your profile has not been approved by the admin. You cannot join an association yet.'
      });
    }

    if (association.status !== 'pending') {
      await transaction.rollback();
      return res.status(400).json({ error: 'You can only join associations that are pending (not yet started).' });
    }

    const [existingMembership, turnTaken] = await Promise.all([
      UserAssociation.findOne({ where: { userId, AssociationId: associationId }, transaction }),
      UserAssociation.findOne({ where: { AssociationId: associationId, turnNumber }, transaction })
    ]);

    if (existingMembership) {
      await transaction.rollback();
      return res.status(409).json({ error: 'You are already a member of this association.' });
    }
    if (turnTaken) {
      await transaction.rollback();
      return res.status(409).json({ error: `Turn number ${turnNumber} is already taken.` });
    }

    // --- Create membership, payment record, and update turn status ---
    await UserAssociation.create({
      UserId: userId,
      AssociationId: associationId,
      turnNumber,
      joinDate: new Date(),
      status: 'active',
      remainingAmount: association.monthlyAmount * association.duration
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
      membership: { turnNumber, associationId }
    });

  } catch (error) {
    if (transaction.finished !== 'commit') await transaction.rollback();
    console.error('Error joining association:', error);
    return res.status(500).json({ error: 'حدث خطأ أثناء الانضمام إلى الجمعية' });
  }
});

router.get('/my-associations', auth, async (req, res) => {
  try {
    const userWithAssociations = await User.findByPk(req.user.id, {
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
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, data: userWithAssociations.Associations });
  } catch (error) {
    console.error('Error fetching my-associations:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في الاسترجاع',
      details: process.env.NODE_ENV === 'development' ? error.message : null
    });
  }
});

// Get members of an association with their payout info
router.get('/:id/members', auth, async (req, res) => {
  try {
    const associationId = req.params.id;
    const members = await UserAssociation.findAll({
      where: { AssociationId: associationId },
      include: [{
        model: User,
        attributes: ['id', 'fullName', 'phone', 'profileImage']
      }],
      order: [['turnNumber', 'ASC']]
    });
    const result = members.map(member => ({
      userId: member.User.id,
      name: member.User.fullName,
      phone: member.User.phone,
      profileImage: member.User.profileImage,
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


// ========== AVAILABLE TURNS ==========
router.get('/:id/available-turns', auth, async (req, res) => {
  try {
    const associationId = req.params.id;
    const association = await Association.findByPk(associationId);
    if (!association) {
      return res.status(404).json({ success: false, error: 'الجمعية غير موجودة' });
    }

    const takenTurnsResult = await UserAssociation.findAll({
      where: { AssociationId: associationId },
      attributes: ['turnNumber']
    });
    const takenTurns = new Set(takenTurnsResult.map(t => t.turnNumber));
    const maxTurns = association.duration;
    const feeRatios = calculateFeeRatios(maxTurns);
    const availableTurns = [];

    for (let i = 1; i <= maxTurns; i++) {
      if (!takenTurns.has(i)) {
        const totalAssociationValue = association.monthlyAmount * maxTurns;
        const feeRatio = feeRatios[i - 1] || 0;
        const feeAmount = totalAssociationValue * feeRatio;
        availableTurns.push({
          turnNumber: i,
          feePercent: feeRatio,
          feeAmount,
        });
      }
    }
    res.status(200).json({ success: true, availableTurns });
  } catch (err) {
    console.error('Error fetching available turns:', err);
    res.status(500).json({ success: false, error: 'خطأ في جلب الأدوار المتاحة' });
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


module.exports = router;