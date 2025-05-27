const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Turn = require('../models/turn');
const User = require('../models/user');
const sequelize = require('../config/db');
const { Op } = require('sequelize');

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
    const turn = await Turn.findOne({
      where: {
        userId: req.user.id,
        isTaken: true
      }
    });

    if (!turn) {
      return res.status(404).json({
        success: false,
        error: 'لا يوجد لديك دور محجوز'
      });
    }

    res.status(200).json({
      success: true,
      turn: {
        id: turn.id,
        turnName: turn.turnName,
        scheduledDate: turn.scheduledDate,
        feeAmount: turn.feeAmount,
        pickedAt: turn.pickedAt
      }
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



module.exports = router; 