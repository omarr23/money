const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Turn = require('../models/turn');
const User = require('../models/user');
const { Association } = require('../models/association');
const sequelize = require('../config/db');
const { Op } = require('sequelize');
const { UserAssociation } = require('../models');
const admin = require('../middleware/admin');

// Pick/Lock a turn
router.post('/pick/:turnId', auth, async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { turnId } = req.params;
    const userId = req.user.id;

    // Check if user already has a turn
    const existingTurn = await Turn.findOne({
      where: {
        userId: userId,
        isTaken: true
      },
      transaction
    });

    if (existingTurn) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        error: 'لديك دور محجوز بالفعل',
        existingTurn: {
          id: existingTurn.id,
          turnName: existingTurn.turnName,
          scheduledDate: existingTurn.scheduledDate
        }
      });
    }

    // Find the turn
    const turn = await Turn.findByPk(turnId, { 
      transaction,
      lock: true // Add row-level locking
    });

    if (!turn) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        error: 'الدور غير موجود'
      });
    }

    // Check if turn is already taken
    if (turn.isTaken) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        error: 'هذا الدور محجوز بالفعل'
      });
    }

    // Get user's current balance
    const user = await User.findByPk(userId, { 
      transaction,
      lock: true // Add row-level locking
    });

    if (!user) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        error: 'المستخدم غير موجود'
      });
    }

    // Check if user has sufficient balance
    if (user.walletBalance < turn.feeAmount) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        error: 'رصيد المحفظة غير كافي',
        requiredAmount: turn.feeAmount,
        currentBalance: user.walletBalance
      });
    }

    // Lock the turn for the user
    await turn.update({
      isTaken: true,
      userId: userId,
      pickedAt: new Date()
    }, { transaction });

    // Deduct the fee from user's wallet
    await user.update({
      walletBalance: sequelize.literal(`walletBalance - ${turn.feeAmount}`)
    }, { transaction });

    await transaction.commit();

    res.status(200).json({
      success: true,
      message: 'تم حجز الدور بنجاح',
      turn: {
        id: turn.id,
        turnName: turn.turnName,
        scheduledDate: turn.scheduledDate,
        feeAmount: turn.feeAmount,
        pickedAt: turn.pickedAt
      }
    });

  } catch (error) {
    await transaction.rollback();
    console.error('خطأ في حجز الدور:', error);
    
    // Handle specific error cases
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({
        success: false,
        error: 'هذا الدور محجوز بالفعل'
      });
    }

    res.status(500).json({
      success: false,
      error: 'فشل في حجز الدور',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get all available turns
router.get('/available', auth, async (req, res) => {
  try {
    const turns = await Turn.findAll({
      where: {
        isTaken: false,
        scheduledDate: {
          [Op.gt]: new Date() // Only show future turns
        }
      },
      order: [['scheduledDate', 'ASC']]
    });

    res.status(200).json({
      success: true,
      turns: turns.map(turn => ({
        id: turn.id,
        turnName: turn.turnName,
        scheduledDate: turn.scheduledDate,
        feeAmount: turn.feeAmount
      }))
    });

  } catch (error) {
    console.error('خطأ في جلب الأدوار المتاحة:', error);
    res.status(500).json({
      success: false,
      error: 'فشل في جلب الأدوار المتاحة',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get user's current turn
router.get('/my-turn', auth, async (req, res) => {
  try {
    // Fetch ALL turns for this user (not just one)
    const turns = await Turn.findAll({
      where: {
        userId: req.user.id,
        isTaken: true
      },
      include: [
        {
          model: Association,
          as: 'Association'
        }
      ],
      order: [['scheduledDate', 'ASC']]
    });

    if (!turns || turns.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'لا يوجد لديك دور محجوز'
      });
    }

    // Map all user's turns
    const results = turns.map(turn => {
      const assoc = turn.Association;
      const totalPayout = assoc.monthlyAmount * assoc.duration;
      const contractDeliveryFee = assoc.contractDeliveryFee || 0;
      const feePercent = assoc.feePercent || 0;
      const feeAmount = +(totalPayout * feePercent / 100).toFixed(2); // fix floating point
      const finalAmount = +(totalPayout - feeAmount - contractDeliveryFee).toFixed(2);

      // Calculate time left till scheduledDate
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
        currentTurn: {
          currentTurnMember: {
            userId: turn.userId,
            turnNumber: turn.turnNumber,
            hasReceived: turn.hasReceived || false // If you have this field in Turn
          },
          totalPayout,
          feeAmount,
          contractDeliveryFee,
          finalAmount
        }
      };
    });

    res.status(200).json({
      success: true,
      turns: results
    });

  } catch (error) {
    console.error('خطأ في جلب الدور الحالي:', error);
    res.status(500).json({
      success: false,
      error: 'فشل في جلب الدور الحالي',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/', auth, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      include: {
        model: Association,
        as: 'Associations',
        through: { attributes: [] }
      }
    });

    const userAssociation = user.Associations[0];
    if (!userAssociation) {
      return res.status(404).json({ error: 'المستخدم غير منضم إلى أي جمعية' });
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

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'حدث خطأ أثناء تحميل الأدوار' });
  }
});

 
router.post('/select', auth, async (req, res) => {
  const { turnId } = req.body;
  const userId = req.user.id;

  try {
    const turn = await Turn.findByPk(turnId);

    if (!turn || turn.isTaken) {
      return res.status(400).json({ error: 'هذا الدور غير متاح' });
    }

    turn.userId = userId;
    turn.isTaken = true;
    turn.pickedAt = new Date();
    await turn.save();

    res.json({ success: true, message: 'تم حجز الدور بنجاح' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'حدث خطأ أثناء حجز الدور' });
  }
});

// Get all turns for an association
router.get('/:associationId', auth, async (req, res) => {
  try {
    const { associationId } = req.params;
    const userId = req.user.id;

    // Check if user is a member of the association
    const userAssociation = await UserAssociation.findOne({
      where: {
        userId,
        associationId
      }
    });

    if (!userAssociation) {
      return res.status(403).json({ error: 'غير مصرح لك بالوصول إلى هذه الجمعية' });
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
      if (turn.turnNumber <= 4) {
        category = 'early';
      } else if (turn.turnNumber <= 7) {
        category = 'middle';
      } else {
        category = 'late';
      }

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

    res.json({
      success: true,
      turns: enrichedTurns
    });
  } catch (error) {
    console.error('Error fetching turns:', error);
    res.status(500).json({ error: 'فشل في جلب الأدوار' });
  }
});

// Pick a turn
router.post('/:turnId/pick', auth, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { turnId } = req.params;
    const userId = req.user.id;

    const turn = await Turn.findByPk(turnId, {
      include: [{
        model: Association,
        attributes: ['monthlyAmount']
      }]
    });

    if (!turn) {
      await transaction.rollback();
      return res.status(404).json({ error: 'الدور غير موجود' });
    }

    if (turn.isTaken) {
      await transaction.rollback();
      return res.status(400).json({ error: 'هذا الدور محجوز بالفعل' });
    }

    // Check if user is a member of the association
    const userAssociation = await UserAssociation.findOne({
      where: {
        userId,
        associationId: turn.associationId
      }
    });

    if (!userAssociation) {
      await transaction.rollback();
      return res.status(403).json({ error: 'يجب أن تكون عضوًا في الجمعية لاختيار دور' });
    }

    // Update turn
    turn.isTaken = true;
    turn.takenBy = userId;
    await turn.save({ transaction });

    await transaction.commit();
    res.json({ message: 'تم اختيار الدور بنجاح', turn });
  } catch (error) {
    await transaction.rollback();
    console.error('Error picking turn:', error);
    res.status(500).json({ error: 'فشل في اختيار الدور' });
  }
});

// Admin: Create a new turn
router.post('/', [auth, admin], async (req, res) => {
  try {
    const { associationId, turnName, scheduledDate, feeAmount, turnNumber } = req.body;

    // Validate required fields
    if (!associationId || !turnName || !scheduledDate || !turnNumber) {
      return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
    }

    // Check if association exists
    const association = await Association.findByPk(associationId);
    if (!association) {
      return res.status(404).json({ error: 'الجمعية غير موجودة' });
    }

    // Check if turn number already exists for this association
    const existingTurn = await Turn.findOne({
      where: {
        associationId,
        turnNumber
      }
    });

    if (existingTurn) {
      return res.status(400).json({ error: 'رقم الدور موجود بالفعل في هذه الجمعية' });
    }

    const turn = await Turn.create({
      associationId,
      turnName,
      scheduledDate,
      feeAmount: feeAmount || association.monthlyAmount * 0.1,
      turnNumber,
      isTaken: false
    });

    res.status(201).json(turn);
  } catch (error) {
    console.error('Error creating turn:', error);
    res.status(500).json({ error: 'فشل في إنشاء الدور' });
  }
});

// Admin: Update a turn
router.put('/:turnId', [auth, admin], async (req, res) => {
  try {
    const { turnId } = req.params;
    const { turnName, scheduledDate, feeAmount, turnNumber } = req.body;

    const turn = await Turn.findByPk(turnId);
    if (!turn) {
      return res.status(404).json({ error: 'الدور غير موجود' });
    }

    // If changing turn number, check for duplicates
    if (turnNumber && turnNumber !== turn.turnNumber) {
      const existingTurn = await Turn.findOne({
        where: {
          associationId: turn.associationId,
          turnNumber
        }
      });

      if (existingTurn) {
        return res.status(400).json({ error: 'رقم الدور موجود بالفعل في هذه الجمعية' });
      }
    }

    await turn.update({
      turnName: turnName || turn.turnName,
      scheduledDate: scheduledDate || turn.scheduledDate,
      feeAmount: feeAmount || turn.feeAmount,
      turnNumber: turnNumber || turn.turnNumber
    });

    res.json(turn);
  } catch (error) {
    console.error('Error updating turn:', error);
    res.status(500).json({ error: 'فشل في تحديث الدور' });
  }
});

// Admin: Delete a turn
router.delete('/:turnId', [auth, admin], async (req, res) => {
  try {
    const { turnId } = req.params;

    const turn = await Turn.findByPk(turnId);
    if (!turn) {
      return res.status(404).json({ error: 'الدور غير موجود' });
    }

    if (turn.isTaken) {
      return res.status(400).json({ error: 'لا يمكن حذف دور محجوز' });
    }

    await turn.destroy();
    res.json({ message: 'تم حذف الدور بنجاح' });
  } catch (error) {
    console.error('Error deleting turn:', error);
    res.status(500).json({ error: 'فشل في حذف الدور' });
  }
});

// GET all turns with specified details
router.get('/api/turns', auth, async (req, res) => {
  try {
    const turns = await Turn.findAll({ order: [['scheduledDate', 'ASC']] });

    const formattedTurns = turns.map(turn => {
      const isLocked = turn.isTaken; // Assuming locked means taken
      const eligibilityReason = isLocked ? 'Turn is already taken.' : null; // Simple reason for now

      return {
        name: turn.turnName,
        month: new Date(turn.scheduledDate).getMonth() + 1, // getMonth() is 0-indexed
        year: new Date(turn.scheduledDate).getFullYear(),
        fee: turn.feeAmount,
        isLocked: isLocked,
        eligibilityReason: eligibilityReason
      };
    });

    res.json(formattedTurns);
  } catch (error) {
    console.error('Error fetching turns for /api/turns:', error);
    res.status(500).json({ error: 'Failed to fetch turns.' });
  }
});

router.get('/public/:associationId', auth, async (req, res) => {
  try {
    const { associationId } = req.params;

    // Fetch association and members
    const association = await Association.findByPk(associationId);
    if (!association) {
      return res.status(404).json({ error: 'الجمعية غير موجودة' });
    }

    // Get all members (UserAssociation) ordered by turnNumber
    const members = await UserAssociation.findAll({
      where: { AssociationId: associationId },
      order: [['turnNumber', 'ASC']]
    });

    // Find the current turn member (first who has not received)
    const currentTurnMember = members.find(m => !m.hasReceived);

    // Calculate total payout, fee, etc. for the current turn
    let turnInfo = null;
    if (currentTurnMember) {
      const totalPayout = association.monthlyAmount * association.duration;
      // Use the same fee ratio logic as in associations.js
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

    // Get all turns as before
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

    res.status(200).json({
      turns: result,
      currentTurn: turnInfo
    });
  } catch (error) {
    console.error('Error fetching turns:', error);
    res.status(500).json({ error: 'فشل في جلب الأدوار' });
  }
});

// Admin: Get all turns for an association

module.exports = router; 