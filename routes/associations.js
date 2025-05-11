const express = require('express');
const router = express.Router();
const { User, Association, UserAssociation } = require('../models');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const { Op } = require('sequelize');
const startPayoutCycle = require('../utils/payoutCycle');
const sequelize = require('../config/db');

router.post('/', [auth, admin], async (req, res) => {
  try {
    const { name, monthlyAmount, duration, startDate , type } = req.body;

    // ================ التحقق من البيانات المدخلة ================
    const errors = [];
    
    if (!name || name.trim().length < 3) {
      errors.push('الاسم مطلوب ويجب أن يكون على الأقل 3 أحرف');
    }

    if (!monthlyAmount || isNaN(monthlyAmount)) {
      errors.push('المبلغ الشهري مطلوب ويجب أن يكون رقمًا');
    }

    if (!duration || !Number.isInteger(Number(duration))) {
      errors.push('المدة مطلوبة ويجب أن تكون عددًا صحيحًا');
    }

    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    // ================ معالجة البيانات ================
    const processedData = {
      name: name.trim(),
      monthlyAmount: parseFloat(monthlyAmount),
      duration: parseInt(duration),
      startDate: startDate ? new Date(startDate) : new Date(),
      status: 'pending',
      type: type || 'B' // تعيين النوع إلى 'B' بشكل افتراضي
      
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
    const association = await Association.create(processedData);

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
        type: association.type
      }
    });

  } catch (error) {
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
router.post('/:id/join', auth, async (req, res) => {
  try {
    const association = await Association.findByPk(req.params.id);
    const user = req.user;

    // التحقق من وجود الجمعية
    if (!association) {
      return res.status(404).json({ 
        success: false,
        error: 'الجمعية غير موجودة' 
      });
    }

    // التحقق من حالة الجمعية
    if (association.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'لا يمكن الانضمام لجمعية غير نشطة'
      });
    }

    // التحقق من العضوية المسبقة
    const existingMembership = await UserAssociation.findOne({
      where: { 
        userId: user.id,
        associationId: association.id 
      }
    });

    if (existingMembership) {
      return res.status(409).json({
        success: false,
        error: 'أنت مسجل بالفعل في هذه الجمعية'
      });
    }

    // Get the count of existing members to determine turn number
    const memberCount = await UserAssociation.count({
      where: { AssociationId: association.id }
    });

    // Calculate the next turn number (1-based index)
    const turnNumber = memberCount + 1;

    // التسجيل في الجمعية مع التحقق من البيانات
    const newMembership = await UserAssociation.create({
      UserId: user.id,
      AssociationId: association.id,
      remainingAmount: association.monthlyAmount * association.duration,
      joinDate: new Date(),
      status: 'active',
      turnNumber: turnNumber // Assign the turn number
    });

    // الرد الناجح مع بيانات العضوية
    res.status(201).json({
      success: true,
      message: 'تم التسجيل بنجاح',
      membership: {
        id: newMembership.id,
        joinDate: newMembership.joinDate,
        status: newMembership.status,
        turnNumber: newMembership.turnNumber // Include turn number in response
      }
    });

  } catch (error) {
    console.error('تفاصيل الخطأ:', error);
    
    // معالجة أخطاء قاعدة البيانات
    let errorMessage = 'حدث خطأ أثناء التسجيل';
    if (error.name === 'SequelizeForeignKeyConstraintError') {
      errorMessage = 'معلومات المستخدم أو الجمعية غير صالحة';
    }
    
    res.status(500).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        stack: error.stack
      } : null
    });
  }
});

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
  try {
    const { associationId } = req.body;
    const interval = 50000; // 50 seconds
    let turn = 1;

    if (!associationId) {
      return res.status(400).json({ error: 'associationId is required' });
    }

    const users = await UserAssociation.findAll({
      where: { AssociationId: associationId },
      order: [['turnNumber', 'ASC']]
    });

    if (users.length === 0) {
      return res.status(404).json({ error: 'No users found for this association' });
    }

    console.log(`Starting test cycle for Association ID ${associationId}`);

    const payout = async () => {
      if (turn > users.length) {
        console.log('All users have been paid. Ending test cycle.');
        return;
      }

      const user = users[turn - 1];
      user.hasReceived = true;
      user.lastReceivedDate = new Date();
      await user.save();

      console.log(`Paid user ID ${user.UserId} (turn ${turn})`);

      turn++;
      if (turn <= users.length) {
        setTimeout(payout, interval);
      }
    };

    setTimeout(payout, interval);

    return res.status(200).json({ message: 'Test cycle started. Payouts will occur every 50 seconds.' });

  } catch (error) {
    console.error('Error starting test cycle:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
);

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

// router.post('/:id/register-and-start', auth, async (req, res) => {
//   const t = await sequelize.transaction();
//   try {
//     const association = await Association.findByPk(req.params.id, { transaction: t });
//     const user        = await User.findByPk(req.user.id, { lock: t.LOCK.UPDATE, transaction: t });

//     if (!association) throw { status:404, msg:'الجمعية غير موجودة' };
//     if (association.status !== 'pending') throw { status:400, msg:'لا يمكن الانضمام لجمعية غير نشطة' };

//     // == affordability check ==
//     if (+user.walletBalance < +association.monthlyAmount) {
//       throw { status:400, msg:'رصيدك لا يكفي للمساهمة الأولى' };
//     }

//     // == turn number & duplicate check ==
//     const memberCount = await UserAssociation.count({ where:{ AssociationId:association.id }, lock:true, transaction:t });
//     if (memberCount >= 3) throw { status:400, msg:'الجمعية مكتملة (٣ أعضاء فقط)' };
//     const turnNumber  = memberCount + 1;

//     // == first debit ==
//     user.walletBalance -= association.monthlyAmount;
//     await user.save({ transaction:t });

//     // == record membership ==
//     const payoutAmount = association.monthlyAmount * 3;   // pot with 3 members
//     const newMember = await UserAssociation.create({
//       UserId: user.id,
//       AssociationId: association.id,
//       remainingAmount: association.monthlyAmount * association.duration,
//       payoutAmount,
//       joinDate: new Date(),
//       status: 'active',
//       turnNumber
//     }, { transaction:t });

//     // == activate when full ==
//     if (turnNumber === 3) {
//       association.status = 'active';
//       await association.save({ transaction:t });
//       startPayoutCycle(association.id);        // you already have this util
//     }

//     await t.commit();
//     return res.status(201).json({ success:true, membership:{ id:newMember.id, turnNumber } });

//   } catch (e) {
//     await t.rollback();
//     const code = e.status || 500;
//     return res.status(code).json({ success:false, error:e.msg || 'حدث خطأ في التسجيل' });
//   }
// });



module.exports = router;