const express = require('express');
const router = express.Router();
const { User, Association, UserAssociation, Payment, Turn } = require('../models');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const { Op } = require('sequelize');
const sequelize = require('../config/db');

router.post('/', [auth, admin], async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { name, monthlyAmount, maxMembers, startDate, type } = req.body;

    // ================ التحقق من البيانات المدخلة ================
    const errors = [];
    
    if (!name || name.trim().length < 3) {
      errors.push('الاسم مطلوب ويجب أن يكون على الأقل 3 أحرف');
    }

    if (!monthlyAmount || isNaN(monthlyAmount)) {
      errors.push('المبلغ الشهري مطلوب ويجب أن يكون رقمًا');
    }

    const parsedMaxMembers = parseInt(maxMembers) || 10;
    if (parsedMaxMembers < 1 || parsedMaxMembers > 100) {
      errors.push('عدد الأعضاء يجب أن يكون بين 1 و 100');
    }

    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    // ================ معالجة البيانات ================
    const processedData = {
      name: name.trim(),
      monthlyAmount: parseFloat(monthlyAmount),
      duration: parsedMaxMembers, // Set duration equal to maxMembers
      startDate: startDate ? new Date(startDate) : new Date(),
      status: 'pending',
      type: type || 'B',
      maxMembers: parsedMaxMembers
    };

    // ================ التحقق من التواريخ ================
    if (isNaN(processedData.startDate.getTime())) {
      return res.status(400).json({ error: 'تاريخ بداية غير صحيح' });
    }

    // ================ التحقق من التكرار ================
    const existingAssociation = await Association.findOne({
      where: {
        name: processedData.name
      }
    });

    if (existingAssociation) {
      return res.status(409).json({
        error: 'اسم الجمعية موجود مسبقًا',
        existingId: existingAssociation.id
      });
    }

    // ================ إنشاء الجمعية ================
    const association = await Association.create(processedData, { transaction });

    // ================ إنشاء الأدوار ================
    const turns = [];
    const startDateObj = new Date(processedData.startDate);
    
    for (let i = 1; i <= parsedMaxMembers; i++) {
      const turnDate = new Date(startDateObj);
      turnDate.setMonth(turnDate.getMonth() + (i - 1));
      
      // Calculate fee based on turn category
      let feePercent = 0;
      if (i <= 4) {
        // Early turns (1-4): 10% to 40% fee
        feePercent = 0.40 - ((i - 1) * 0.10);
      } else if (i <= 7) {
        // Middle turns (5-7): No fee
        feePercent = 0;
      } else {
        // Late turns (8-10): 5% to 15% discount
        feePercent = -0.05 - ((i - 8) * 0.05);
      }
      
      turns.push({
        turnName: `الدور ${i}`,
        scheduledDate: turnDate,
        feeAmount: processedData.monthlyAmount * feePercent,
        isTaken: false,
        associationId: association.id,
        turnNumber: i
      });
    }

    // Create turns one by one to handle potential errors better
    for (const turnData of turns) {
      await Turn.create(turnData, { transaction });
    }

    await transaction.commit();

    // ================ الرد الناجح ================
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
        maxMembers: association.maxMembers
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
    
    // معالجة أخطاء Sequelize
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
    
    // معالجة القيم الرقمية بشكل آمن
    const parsedPage = Math.max(1, parseInt(page) || 1);
    const parsedPageSize = Math.min(Math.max(1, parseInt(pageSize) || 10), 100);

    // بناء شرط البحث
    const whereClause = {};
    if (status) {
      whereClause.status = {
        [Op.eq]: status || "pending" // استخدام عامل المقارنة Op.eq للتطابق التام
      };
    }

    // استرجاع البيانات
    const { count, rows } = await Association.findAndCountAll({
      where: whereClause,
      limit: parsedPageSize,
      offset: (parsedPage - 1) * parsedPageSize,
      order: [['createdAt', 'DESC']]
    });

    // حساب عدد الصفحات
    const totalPages = Math.ceil(count / parsedPageSize);

    // إرسال النتيجة
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

    // منع تحديث الجمعيات المكتملة
    if (association.status === 'completed') {
      return res.status(400).json({error: 'لا يمكن تعديل جمعية مكتملة'});
    }

    await association.update(req.body);
    res.json(association);
  } catch (error) {
    res.status(500).json({ error: 'خطأ في التحديث'});
  }
});

// حذف الجمعية (للمدير فقط)
router.delete('/:id', [auth, admin], async (req, res) => {
  try {
    const association = await Association.findByPk(req.params.id);
    if (!association) return res.status(404).json({error:'الجمعية غير موجودة'});

    await association.destroy();
    res.json({ message: 'تم حذف الجمعية بنجاح' });
  } catch (error) {
    res.status(500).json({error:'خطأ في الحذف'});
  }
});

// التسجيل في جمعية (للمستخدمين العاديين)
// ...existing code...

// التسجيل في جمعية (للمستخدمين العاديين) مع شرط موافقة الإدارة على صورة المستخدم
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

    // شرط موافقة الإدارة على صورة المستخدم
    if (!user.profileApproved) {
      await transaction.rollback();
      return res.status(403).json({ 
        error: 'لم تتم الموافقة على صورتك من قبل الإدارة، لا يمكنك الانضمام للجمعية' 
      });
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

    // Check if turn is already taken in UserAssociation
    const turnTaken = await UserAssociation.findOne({
      where: { AssociationId: associationId, turnNumber },
      transaction
    });

    if (turnTaken) {
      await transaction.rollback();
      return res.status(409).json({ error: `الدور رقم ${turnNumber} محجوز بالفعل` });
    }

    // Also verify in the Turn model that it's not marked taken
    const turn = await Turn.findOne({
      where: {
        associationId: associationId,
        turnNumber: turnNumber
      },
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

    // Calculate fee based on turn position
    let feePercent = 0;
    if (turnNumber <= 4) {
      feePercent = 0.40 - ((turnNumber - 1) * 0.10);
    } else if (turnNumber <= 7) {
      feePercent = 0;
    } else {
      feePercent = -0.05 - ((turnNumber - 8) * 0.05);
    }

    const feeAmount = association.monthlyAmount * feePercent;

    // Check wallet balance
    if (user.walletBalance < feeAmount) {
      await transaction.rollback();
      return res.status(400).json({
        error: `رصيد المحفظة غير كافٍ لدفع الرسوم (${feeAmount})`,
        walletBalance: user.walletBalance,
        requiredFee: feeAmount
      });
    }

    // Deduct fee
    await User.update(
      { walletBalance: sequelize.literal(`walletBalance - ${feeAmount}`) },
      { where: { id: userId }, transaction }
    );

    // Create membership
    const newMembership = await UserAssociation.create({
      UserId: userId,
      AssociationId: associationId,
      turnNumber,
      joinDate: new Date(),
      status: 'active',
      remainingAmount: association.monthlyAmount * association.duration
    }, { transaction });

    // Record payment
    await Payment.create({
      userId,
      associationId,
      amount: 0,
      feeAmount,
      feePercent,
      paymentDate: new Date()
    }, { transaction });

    // Update the Turn model
    await Turn.update({
      isTaken: true,
      userId: userId,
      pickedAt: new Date()
    }, {
      where: {
        associationId: associationId,
        turnNumber: turnNumber
      },
      transaction
    });

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: `تم التسجيل في الجمعية بالدور رقم ${turnNumber}`,
      fee: {
        turnNumber,
        feeAmount,
        feePercent
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

// ...existing code...

// استرجاع الجمعيات التي انضم إليها المستخدم
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
      return res.status(404).json({ 
        success: false,
        message: 'المستخدم غير موجود' 
      });
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

router.post('/test-cycle', async (req, res) => {
    let transaction;
    try {
        const { associationId } = req.body;
        const interval = 10000; // 10 seconds
        let turn = 1;

        if (!associationId) {
            return res.status(400).json({ error: 'associationId is required' });
        }

        transaction = await sequelize.transaction();

        const association = await Association.findByPk(associationId, { transaction });
        if (!association) {
            return res.status(404).json({ error: 'Association not found' });
        }

        const userAssociationMembers = await UserAssociation.findAll({
            where: { AssociationId: associationId },
            order: [['joinDate', 'ASC']], // Changed from turnNumber
            transaction
        });

        if (userAssociationMembers.length === 0) {
            return res.status(404).json({ error: 'No users found for this association' });
        }

        const totalPotAmount = association.monthlyAmount * userAssociationMembers.length;

        console.log(`Starting test cycle for Association ID ${associationId}. Pot: ${totalPotAmount}`);

        const payout = async () => {
            if (turn > userAssociationMembers.length) {
                console.log('All users have been paid. Ending test cycle.');
                return;
            }

            const payoutTransaction = await sequelize.transaction();
            try {
                const userAssociationRecord = userAssociationMembers[turn - 1];

                // 1. Update UserAssociation
                userAssociationRecord.hasReceived = true;
                userAssociationRecord.lastReceivedDate = new Date();
                await userAssociationRecord.save({ transaction: payoutTransaction });

                // 2. Update User's Wallet Balance
                await User.increment('walletBalance', {
                    by: totalPotAmount,
                    where: { id: userAssociationRecord.UserId },
                    transaction: payoutTransaction
                });

                await payoutTransaction.commit();
                console.log(`Paid userID ${userAssociationRecord.UserId} (turn ${turn}). Wallet updated by ${totalPotAmount}.`);

                turn++;
                if (turn <= userAssociationMembers.length) {
                    setTimeout(payout, interval);
                }
            } catch (payoutError) {
                await payoutTransaction.rollback();
                console.error(`Error during payout for turn ${turn}, user ID ${userAssociationMembers[turn-1]?.UserId}:`, payoutError);
                // continue to next user after logging the error to not block the rest of the transactions
                turn++;
                if (turn <= userAssociationMembers.length) {
                    setTimeout(payout, interval);
                }
            }
        };

        setTimeout(payout, interval);

        await transaction.commit();
        return res.status(200).json({ message: 'Test cycle started. Payouts will occur every 50 seconds.' });

    } catch (error) {
        if (transaction && transaction.finished !== 'commit' && transaction.finished !== 'rollback') {
            await transaction.rollback();
        }
        console.error('Error starting test cycle:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/available', auth, async (req, res) => {
  try {
    const { amount } = req.query; // Example: /available?amount=3000
    const userAmount = parseFloat(amount);

    if (isNaN(userAmount)) {
      return res.status(400).json({ error: 'المبلغ المدخل غير صالح' });
    }

    let typeFilter = ['B'];
    if (userAmount >= 5000) {
      typeFilter = ['A', 'B'];
    }

    const associations = await Association.findAll({
      where: {
        monthlyAmount: {
          [Op.lte]: userAmount
        },
        type: {
          [Op.in]: typeFilter
        },
        status: 'pending' // Only pending associations
      },
      order: [['monthlyAmount', 'ASC']]
    });

    res.json({ success: true, data: associations });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'فشل في الاسترجاع' });
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
      order: [['joinDate', 'ASC']]
    });

    const result = members.map(member => ({
      userId: member.User.id,
      name: member.User.fullName,
      phone: member.User.phone,
      hasReceived: member.hasReceived,
      lastReceivedDate: member.lastReceivedDate
    }));

    res.json({ success: true, data: result });

  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});


router.post('/:id/preview-fee', auth, async (req, res) => {
  try {
    const { turnNumber } = req.body;
    const associationId = req.params.id;

    if (!turnNumber) {
      return res.status(400).json({ 
        success: false,
        error: 'رقم الدور مطلوب' 
      });
    }

    const association = await Association.findByPk(associationId);
    if (!association) {
      return res.status(404).json({ 
        success: false,
        error: 'الجمعية غير موجودة' 
      });
    }

    // Calculate fee based on turn category
    let feePercent = 0;
    if (turnNumber <= 4) {
      // Early turns (1-4): 10% to 40% fee
      feePercent = 0.40 - ((turnNumber - 1) * 0.10);
    } else if (turnNumber <= 7) {
      // Middle turns (5-7): No fee
      feePercent = 0;
    } else {
      // Late turns (8-10): 5% to 15% discount
      feePercent = -0.05 - ((turnNumber - 8) * 0.05);
    }

    const feeAmount = association.monthlyAmount * feePercent;

    return res.status(200).json({
      success: true,
      feePercent,
      feeAmount,
      turnNumber,
      monthlyAmount: association.monthlyAmount
    });
  } catch (err) {
    console.error('Preview fee error:', err);
    return res.status(500).json({ 
      success: false,
      error: 'خطأ في حساب الرسوم' 
    });
  }
});

// Get available turns with fee info
router.get('/:id/available-turns', auth, async (req, res) => {
  try {
    const associationId = req.params.id;
    const association = await Association.findByPk(associationId);

    if (!association) {
      return res.status(404).json({ 
        success: false,
        error: 'الجمعية غير موجودة' 
      });
    }

    const existingTurns = await UserAssociation.findAll({
      where: { AssociationId: associationId },
      attributes: ['turnNumber']
    });

    const takenTurns = new Set(existingTurns.map(t => t.turnNumber));
    const maxTurns = association.duration;

    const availableTurns = [];

    for (let i = 1; i <= maxTurns; i++) {
      if (!takenTurns.has(i)) {
        // Calculate fee based on turn category
        let feePercent = 0;
        if (i <= 4) {
          // Early turns (1-4): 10% to 40% fee
          feePercent = 0.40 - ((i - 1) * 0.10);
        } else if (i <= 7) {
          // Middle turns (5-7): No fee
          feePercent = 0;
        } else {
          // Late turns (8-10): 5% to 15% discount
          feePercent = -0.05 - ((i - 8) * 0.05);
        }

        const feeAmount = association.monthlyAmount * feePercent;

        availableTurns.push({
          turnNumber: i,
          feePercent,
          feeAmount,
          monthlyAmount: association.monthlyAmount,
          category: i <= 4 ? 'early' : i <= 7 ? 'middle' : 'late'
        });
      }
    }

    res.status(200).json({
      success: true,
      availableTurns
    });
  } catch (err) {
    console.error('Error fetching available turns:', err);
    res.status(500).json({ 
      success: false,
      error: 'خطأ في جلب الأدوار المتاحة' 
    });
  }
});

router.post('/:id/add-user', auth, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { userId, turnNumber } = req.body;
    const associationId = req.params.id;

    if (!userId || !turnNumber) {
      return res.status(400).json({ error: 'userId and turnNumber are required' });
    }

    const [association, user] = await Promise.all([
      Association.findByPk(associationId, { transaction }),
      User.findByPk(userId, { transaction })
    ]);

    if (!association || !user) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Association or User not found' });
    }

    const exists = await UserAssociation.findOne({
      where: { userId, associationId },
      transaction
    });

    if (exists) {
      await transaction.rollback();
      return res.status(409).json({ error: 'User already in this association' });
    }

    // 🧾 Make sure selected turn is still available
    const taken = await UserAssociation.findOne({
      where: { AssociationId: associationId, turnNumber },
      transaction
    });

    if (taken) {
      await transaction.rollback();
      return res.status(409).json({ error: `Turn ${turnNumber} is already taken` });
    }

    // 🧮 Calculate Fee
    const feeMap = { 1: 0.40, 2: 0.30, 3: 0.20, 4: 0.10 };
    const feePercent = feeMap[turnNumber] || 0;
    const feeAmount = association.monthlyAmount * feePercent;

    if (user.walletBalance < feeAmount) {
      await transaction.rollback();
      return res.status(400).json({ error: `Insufficient wallet balance to pay fee of ${feeAmount}` });
    }

    // 💳 Deduct Fee
    await User.update(
      { walletBalance: sequelize.literal(`walletBalance - ${feeAmount}`) },
      { where: { id: userId }, transaction }
    );

    // 📝 Create Membership
    const newMembership = await UserAssociation.create({
      UserId: userId,
      AssociationId: associationId,
      remainingAmount: association.monthlyAmount * association.duration,
      joinDate: new Date(),
      status: 'active',
      turnNumber
    }, { transaction });

    // 💼 Record Fee Payment
    await Payment.create({
      userId: userId,
      associationId: associationId,
      amount: 0,
      feeAmount,
      feePercent,
      paymentDate: new Date()
    }, { transaction });

    await transaction.commit();

    res.status(201).json({
      success: true,
      message: `Joined with turn ${turnNumber}. Fee of ${feeAmount} applied.`,
      fee: {
        turnNumber,
        feePercent,
        feeAmount
      },
      membership: newMembership
    });

  } catch (err) {
    await transaction.rollback();
    console.error('Error adding user with selected turn:', err);
    res.status(500).json({ error: 'Server error' });
  }
});



module.exports = router;