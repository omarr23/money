const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Payment = require('../models/payment');
const User = require('../models/user');
const { Association, UserAssociation } = require('../models/association');
const sequelize = require('../config/db');
const { Op } = require('sequelize');
const Turn = require('../models/turn');

router.post('/pay', auth, async (req, res) => {
  const transaction = await sequelize.transaction(); // بدء معاملة
  
  try {
    // التحقق من البيانات المدخلة
    const { associationId } = req.body;
    if (!associationId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        error: 'معرّف الجمعية مطلوب'
      });
    }

    // التحقق من وجود الجمعية
    const association = await Association.findByPk(associationId, { transaction });
    if (!association) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        error: 'الجمعية غير موجودة'
      });
    }

    // Always use the user's remaining amount as the payment amount
    const amount = userAssociation.remainingAmount;
    if (amount <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        error: 'لا يوجد مبلغ متبقي للدفع'
      });
    }

    const userAssociation = await UserAssociation.findOne({
      where: {
        userId: req.user.id,
        associationId: associationId
      }
    });

    if (!userAssociation) {
      return res.status(404).json({
        success: false,
        error: 'المستخدم غير مرتبط بهذه الجمعية'
      });
    }

    // التحقق من رصيد المحفظة
    const user = await User.findByPk(req.user.id, { transaction });
    if (user.walletBalance < amount) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        error: 'الرصيد غير كافي'
      });
    }

    const remainingAmount = userAssociation.remainingAmount;
    if (remainingAmount === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        error: 'تم دفع المبلغ كاملاً لا داعي للدفع مرة اخري'
      });
    } else if (remainingAmount < amount) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        error: `المبلغ المتبقي للدفع ${remainingAmount} جنيه فقط`
      });
    } 

    // ===== Admin Cut Logic =====
    // Get user's turn number in this association
    const turnNumber = userAssociation.turnNumber;
    let feeAmount = 0;
    let feePercent = 0;
    if (association && typeof turnNumber === 'number' && association.duration) {
      const feeRatios = require('./associations').calculateFeeRatios
        ? require('./associations').calculateFeeRatios(association.duration)
        : [0];
      const total = association.monthlyAmount * association.duration;
      feePercent = feeRatios[turnNumber - 1] || 0;
      feeAmount = association.monthlyAmount * feePercent;
    }
    // The actual payment to association is amount - feeAmount
    const actualPayment = amount - feeAmount;
    if (actualPayment < 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        error: 'المبلغ المدفوع أقل من الرسوم المطلوبة'
      });
    }
    // Deduct total amount from user
    await User.update(
      { walletBalance: sequelize.literal(`walletBalance - ${amount}`) },
      {
        where: { id: req.user.id },
        transaction
      }
    );
    // Credit fee to first admin
    if (feeAmount > 0) {
      const firstAdmin = await User.findOne({ where: { role: 'admin' }, order: [['createdAt', 'ASC']], transaction });
      if (firstAdmin) {
        await User.update(
          { walletBalance: sequelize.literal(`walletBalance + ${feeAmount}`) },
          { where: { id: firstAdmin.id }, transaction }
        );
      }
    }
    // Update user's remaining amount (only actual payment, not fee)
    await userAssociation.update(
      { remainingAmount: userAssociation.remainingAmount - actualPayment },
      { transaction }
    );
    // Record payment (store both fee and payment)
    const payment = await Payment.create({
      userId: req.user.id,
      associationId: associationId,
      amount: actualPayment,
      feeAmount,
      feePercent,
      paymentDate: new Date()
    }, { transaction });
    await transaction.commit(); // تأكيد المعاملة
    res.status(201).json({
      success: true,
      message: 'تمت عملية الدفع بنجاح',
      payment: {
        id: payment.id,
        amount: payment.amount,
        feeAmount: payment.feeAmount,
        feePercent: payment.feePercent,
        date: payment.paymentDate
      }
    });

  } catch (error) {
    await transaction.rollback(); // تراجع عن المعاملة في حالة الخطأ
    console.error('خطأ في الدفع:', error);
    
    res.status(500).json({
      success: false,
      error: 'فشل في عملية الدفع',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/pay/suggest', auth, async (req, res) => {
  try {
    const { enter } = req.body;
    const userId = req.user.id; // Your auth middleware must set req.user!

    if (!enter || isNaN(enter)) {
      return res.status(400).json({
        success: false,
        error: 'المبلغ الإجمالي غير صالح أو مفقود'
      });
    }

    const inputTotal = parseFloat(enter);
    const lowerBound = inputTotal - 1000;
    const upperBound = inputTotal + 1000;

    // 1. Get the list of association IDs this user has already joined
    const userTurns = await Turn.findAll({
      where: { userId },
      attributes: ['associationId']
    });
    const joinedAssociationIds = userTurns.map(t => t.associationId);

    // 2. Query associations, EXCLUDING already joined
    const associations = await Association.findAll({
      where: {
        status: 'pending',
        id: { [Op.notIn]: joinedAssociationIds.length > 0 ? joinedAssociationIds : [0] } // [0] for no-joins edge case
      },
      order: [['monthlyAmount', 'ASC']],
      limit: 100 // fetch more to filter in JS
    });

    // 3. First filter within the ±1000 range
    let suggestions = associations
      .filter(a => {
        const total = a.monthlyAmount * a.duration;
        return total >= lowerBound && total <= upperBound;
      })
      .map(a => ({
        id: a.id,
        name: a.name,
        monthlyAmount: a.monthlyAmount,
        duration: a.duration,
        type: a.type,
        totalPayout: a.monthlyAmount * a.duration
      }));

    // 4. If none, return 3 closest by total payout (whether higher or lower)
    let fallback = false;
    if (suggestions.length === 0 && associations.length > 0) {
      fallback = true;
      suggestions = associations
        .map(a => ({
          id: a.id,
          name: a.name,
          monthlyAmount: a.monthlyAmount,
          duration: a.duration,
          type: a.type,
          totalPayout: a.monthlyAmount * a.duration,
          _diff: Math.abs((a.monthlyAmount * a.duration) - inputTotal)
        }))
        .sort((a, b) => a._diff - b._diff)
        .slice(0, 3)
        .map(a => {
          delete a._diff;
          return a;
        });
    }

    if (suggestions.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'لا توجد جمعيات متاحة حالياً',
        suggestions: []
      });
    }

    const message = fallback
      ? `لا توجد جمعيات بقيمة إجمالية بين ${lowerBound} و ${upperBound} جنيه. هذه أقرب الخيارات المتاحة.`
      : `تم العثور على جمعيات بقيمة إجمالية قريبة من ${inputTotal} جنيه`;

    return res.status(200).json({
      success: true,
      message,
      suggestions
    });

  } catch (error) {
    console.error('خطأ في اقتراح الجمعية:', error);
    res.status(500).json({
      success: false,
      error: 'فشل في اقتراح الجمعية',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/topup', auth, async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { amount } = req.body;

    if (!amount || isNaN(amount) || amount <= 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        error: 'المبلغ مطلوب ويجب أن يكون رقمًا صحيحًا أكبر من صفر'
      });
    }

    const user = await User.findByPk(req.user.id, { transaction });

    if (!user) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        error: 'المستخدم غير موجود'
      });
    }

    const updatedUser = await user.update(
      { walletBalance: sequelize.literal(`walletBalance + ${amount}`) },
      { transaction }
    );

    await transaction.commit();

    res.status(200).json({
      success: true,
      message: 'تمت عملية الشحن بنجاح',
      newBalance: updatedUser.walletBalance
    });

  } catch (error) {
    await transaction.rollback();
    console.error('خطأ في الشحن:', error);

    res.status(500).json({
      success: false,
      error: 'فشل في عملية الشحن',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Endpoint to create/store a payment method for a user
// routes/payments.js

router.post('/payment-method', auth, async (req, res) => {
  try {
    const {
      paymentChoice,        // Only this is required
      eGateway,
      notificationCategory,
      qabdMethod,
      eWalletProvider,
      eWalletPhone
    } = req.body;

    if (!paymentChoice) {
      return res.status(400).json({
        success: false,
        error: 'حقل paymentChoice مطلوب فقط عند الإنشاء'
      });
    }

    const paymentMethod = await Payment.create({
      UserId: req.user.id,
      amount: 0,
      paymentDate: new Date(),
      paymentChoice,
      eGateway,
      notificationCategory,
      qabdMethod,
      eWalletProvider,
      eWalletPhone
    });

    res.status(201).json({
      success: true,
      message: 'تم حفظ طريقة الدفع بنجاح',
      paymentMethod
    });

  } catch (error) {
    console.error('خطأ في حفظ طريقة الدفع:', error);
    res.status(500).json({
      success: false,
      error: 'فشل في حفظ طريقة الدفع',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// routes/payments.js

// Update a payment method (by id)
router.patch('/update-payment-method/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    // Only allow updating fields that are present in req.body
    const updatableFields = [
      'paymentChoice',
      'eGateway',
      'notificationCategory',
      'qabdMethod',
      'eWalletProvider',
      'eWalletPhone'
    ];

    // Build an update object from fields present in req.body
    const updateData = {};
    updatableFields.forEach(field => {
      if (req.body[field] !== undefined) updateData[field] = req.body[field];
    });

    // Must have at least one field to update
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'لم يتم إرسال أي حقل للتعديل'
      });
    }

    const paymentMethod = await Payment.findOne({
      where: { id, UserId: req.user.id, amount: 0 }
    });

    if (!paymentMethod) {
      return res.status(404).json({
        success: false,
        error: 'طريقة الدفع غير موجودة'
      });
    }

    await paymentMethod.update(updateData);

    res.status(200).json({
      success: true,
      message: 'تم تحديث طريقة الدفع بنجاح',
      paymentMethod
    });

  } catch (error) {
    console.error('خطأ في تحديث طريقة الدفع:', error);
    res.status(500).json({
      success: false,
      error: 'فشل في تحديث طريقة الدفع',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Endpoint to get all payment methods for the current user


// Endpoint to get the most recent payment method for the current user
// routes/payments.js

router.get('/payment-method/my', auth, async (req, res) => {
  try {
    const paymentMethod = await Payment.findOne({
      where: {
        UserId: req.user.id,
        amount: 0
      },
      order: [['createdAt', 'DESC']],
      attributes: [
        'id',
        'paymentChoice',
        'eGateway',
        'notificationCategory',
        'qabdMethod',         // هنا اسم العمود الجديد
        'eWalletProvider',
        'eWalletPhone',
        'paymentDate',
        'createdAt',
        'updatedAt'
      ]
    });

    if (!paymentMethod) {
      return res.status(404).json({
        success: false,
        error: 'لا توجد طريقة دفع محفوظة لهذا المستخدم'
      });
    }

    res.status(200).json({
      success: true,
      paymentMethod
    });

  } catch (error) {
    console.error('خطأ في جلب طريقة الدفع:', error);
    res.status(500).json({
      success: false,
      error: 'فشل في جلب طريقة الدفع',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


router.get('/method', auth, async (req, res) => {
  try {
    const paymentMethods = await Payment.findAll({
      where: {
        UserId: req.user.id,
        amount: 0
      },
      order: [['createdAt', 'DESC']]
    });
    res.status(200).json({
      success: true,
      paymentMethods
    });
  } catch (error) {
    console.error('خطأ في جلب طرق الدفع:', error);
    res.status(500).json({
      success: false,
      error: 'فشل في جلب طرق الدفع',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get a single payment method by ID for the current user
router.get('/payment-method/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const paymentMethod = await Payment.findOne({
      where: {
        id,
        UserId: req.user.id,
        amount: 0
      },
      attributes: [
        'id',
        'paymentChoice',
        'eGateway',
        'notificationCategory',
        'qabdMethod',
        'eWalletProvider',
        'eWalletPhone',
        'paymentDate',
        'createdAt',
        'updatedAt'
      ]
    });
    if (!paymentMethod) {
      return res.status(404).json({
        success: false,
        error: 'طريقة الدفع غير موجودة'
      });
    }
    res.status(200).json({
      success: true,
      paymentMethod
    });
  } catch (error) {
    console.error('خطأ في جلب طريقة الدفع:', error);
    res.status(500).json({
      success: false,
      error: 'فشل في جلب طريقة الدفع',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;