const { Payment, User, Association, UserAssociation, Turn } = require('../models');
const sequelize = require('../config/db');
const { Op } = require('sequelize');
const { calculateFeeRatios } = require('./associationService'); // Use the helper from associations

module.exports = {
  // Pay association
  async payAssociation(userId, associationId) {
    const transaction = await sequelize.transaction();
    try {
      if (!associationId) throw { status: 400, error: 'معرّف الجمعية مطلوب' };

      const association = await Association.findByPk(associationId, { transaction });
      if (!association) throw { status: 404, error: 'الجمعية غير موجودة' };

      const userAssociation = await UserAssociation.findOne({
        where: { userId, associationId }
      });

      if (!userAssociation) throw { status: 404, error: 'المستخدم غير مرتبط بهذه الجمعية' };

      const amount = userAssociation.remainingAmount;
      if (amount <= 0) throw { status: 400, error: 'لا يوجد مبلغ متبقي للدفع' };

      const user = await User.findByPk(userId, { transaction });
      if (user.walletBalance < amount) throw { status: 400, error: 'الرصيد غير كافي' };

      const remainingAmount = userAssociation.remainingAmount;
      if (remainingAmount === 0) throw { status: 400, error: 'تم دفع المبلغ كاملاً لا داعي للدفع مرة اخري' };
      if (remainingAmount < amount) throw { status: 400, error: `المبلغ المتبقي للدفع ${remainingAmount} جنيه فقط` };

      // ===== Fee Logic =====
      const turnNumber = userAssociation.turnNumber;
      let feeAmount = 0;
      let feePercent = 0;
      if (association && typeof turnNumber === 'number' && association.duration) {
        const feeRatios = calculateFeeRatios(association.duration);
        feePercent = feeRatios[turnNumber - 1] || 0;
        feeAmount = association.monthlyAmount * feePercent;
      }
      const actualPayment = amount - feeAmount;
      if (actualPayment < 0) throw { status: 400, error: 'المبلغ المدفوع أقل من الرسوم المطلوبة' };

      // Deduct from user wallet
      await User.update(
        { walletBalance: sequelize.literal(`"walletBalance" - ${amount}`) },
        { where: { id: userId }, transaction }
      );
      // Credit fee to first admin
      if (feeAmount > 0) {
        const firstAdmin = await User.findOne({ where: { role: 'admin' }, order: [['createdAt', 'ASC']], transaction });
        if (firstAdmin) {
          await User.update(
            { walletBalance: sequelize.literal(`"walletBalance" + ${feeAmount}`) },
            { where: { id: firstAdmin.id }, transaction }
          );
        }
      }
      // Update user's remaining amount
      await userAssociation.update(
        { remainingAmount: userAssociation.remainingAmount - actualPayment },
        { transaction }
      );
      // Record payment
      const payment = await Payment.create({
        userId,
        associationId,
        amount: actualPayment,
        feeAmount,
        feePercent,
        paymentDate: new Date()
      }, { transaction });

      await transaction.commit();
      return {
        success: true,
        message: 'تمت عملية الدفع بنجاح',
        payment: {
          id: payment.id,
          amount: payment.amount,
          feeAmount: payment.feeAmount,
          feePercent: payment.feePercent,
          date: payment.paymentDate
        }
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  // Suggest associations by total amount
  async suggestAssociation(userId, enter) {
    if (!enter || isNaN(enter)) {
      throw { status: 400, error: 'المبلغ الإجمالي غير صالح أو مفقود' };
    }
    const inputTotal = Number(enter);
  
    const userTurns = await Turn.findAll({
      where: { userId },
      attributes: ['associationId']
    });
    const joinedAssociationIds = userTurns.map(t => t.associationId);
  
    const associations = await Association.findAll({
      where: {
        status: 'pending',
        id: { [Op.notIn]: joinedAssociationIds.length > 0 ? joinedAssociationIds : [0] }
      }
    });
  
    const sixMonth = associations
      .filter(a => Number(a.duration) === 6)
      .map(a => ({
        ...a.dataValues,
        totalPayout: Number(a.monthlyAmount) * 6
      }));
  
    const tenMonth = associations
      .filter(a => Number(a.duration) === 10)
      .map(a => ({
        ...a.dataValues,
        totalPayout: Number(a.monthlyAmount) * 10
      }));
  
    // Gather exact matches
    const exactSix = sixMonth.find(s => s.totalPayout === inputTotal);
    const exactTen = tenMonth.find(t => t.totalPayout === inputTotal);
  
    // Build suggestions array for exact matches
    let suggestions = [];
    if (exactSix) suggestions.push({
      id: exactSix.id,
      name: exactSix.name,
      monthlyAmount: exactSix.monthlyAmount,
      duration: exactSix.duration,
      type: exactSix.type,
      totalPayout: exactSix.totalPayout
    });
    if (exactTen) suggestions.push({
      id: exactTen.id,
      name: exactTen.name,
      monthlyAmount: exactTen.monthlyAmount,
      duration: exactTen.duration,
      type: exactTen.type,
      totalPayout: exactTen.totalPayout
    });
  
    // If any exact match found, return it
    if (suggestions.length > 0) {
      let message = '';
      if (exactSix && exactTen) {
        message = `تم العثور على جمعيتين (6 أشهر و10 أشهر) بنفس القيمة الإجمالية المدخلة (${inputTotal} ريال).`;
      } else if (exactSix) {
        message = `تم العثور على جمعية 6 أشهر بنفس القيمة الإجمالية المدخلة (${inputTotal} ريال).`;
      } else {
        message = `تم العثور على جمعية 10 أشهر بنفس القيمة الإجمالية المدخلة (${inputTotal} ريال).`;
      }
      return {
        success: true,
        message,
        suggestions
      };
    }
  
    // Fallback: get closest for each type
    let closestSix = sixMonth.reduce((acc, curr) =>
      (!acc || Math.abs(curr.totalPayout - inputTotal) < Math.abs(acc.totalPayout - inputTotal)) ? curr : acc
    , null);
    let closestTen = tenMonth.reduce((acc, curr) =>
      (!acc || Math.abs(curr.totalPayout - inputTotal) < Math.abs(acc.totalPayout - inputTotal)) ? curr : acc
    , null);
  
    suggestions = [];
    if (closestSix) suggestions.push({
      id: closestSix.id,
      name: closestSix.name,
      monthlyAmount: closestSix.monthlyAmount,
      duration: closestSix.duration,
      type: closestSix.type,
      totalPayout: closestSix.totalPayout
    });
    if (closestTen) suggestions.push({
      id: closestTen.id,
      name: closestTen.name,
      monthlyAmount: closestTen.monthlyAmount,
      duration: closestTen.duration,
      type: closestTen.type,
      totalPayout: closestTen.totalPayout
    });
  
    let message = '';
    if (closestSix && closestTen) {
      message = `لم يتم العثور على جمعيتين بنفس القيمة الإجمالية المدخلة. تم اقتراح جمعية 6 أشهر وجمعية 10 أشهر بأقرب قيمة ممكنة.`;
    } else if (closestSix) {
      message = `لا يوجد جمعيات 10 أشهر مناسبة. تم اقتراح جمعية 6 أشهر بأقرب قيمة ممكنة.`;
    } else if (closestTen) {
      message = `لا يوجد جمعيات 6 أشهر مناسبة. تم اقتراح جمعية 10 أشهر بأقرب قيمة ممكنة.`;
    } else {
      message = `عذراً، لا توجد جمعيات 6 أو 10 أشهر متاحة حالياً.`;
    }
  
    return {
      success: true,
      message,
      suggestions
    };
  },
  
  
  

  // Top up wallet
  async topUp(userId, amount) {
    const transaction = await sequelize.transaction();
    try {
      if (!amount || isNaN(amount) || amount <= 0) throw { status: 400, error: 'المبلغ مطلوب ويجب أن يكون رقمًا صحيحًا أكبر من صفر' };
      const user = await User.findByPk(userId, { transaction });
      if (!user) throw { status: 404, error: 'المستخدم غير موجود' };
      const updatedUser = await user.update(
        { walletBalance: sequelize.literal(`"walletBalance" + ${amount}`) },
        { transaction }
      );
      await transaction.commit();
      return {
        success: true,
        message: 'تمت عملية الشحن بنجاح',
        newBalance: updatedUser.walletBalance
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  // Create payment method
  async createPaymentMethod(userId, data) {
    if (!data.paymentChoice) throw { status: 400, error: 'حقل paymentChoice مطلوب فقط عند الإنشاء' };
    const paymentMethod = await Payment.create({
      UserId: userId,
      amount: 0,
      paymentDate: new Date(),
      ...data
    });
    return {
      success: true,
      message: 'تم حفظ طريقة الدفع بنجاح',
      paymentMethod
    };
  },

  // Update payment method
  async updatePaymentMethod(userId, id, data) {
    const updatableFields = [
      'paymentChoice', 'eGateway', 'notificationCategory',
      'qabdMethod', 'eWalletProvider', 'eWalletPhone'
    ];
    const updateData = {};
    updatableFields.forEach(field => {
      if (data[field] !== undefined) updateData[field] = data[field];
    });
    if (Object.keys(updateData).length === 0) throw { status: 400, error: 'لم يتم إرسال أي حقل للتعديل' };
    const paymentMethod = await Payment.findOne({
      where: { id, UserId: userId, amount: 0 }
    });
    if (!paymentMethod) throw { status: 404, error: 'طريقة الدفع غير موجودة' };
    await paymentMethod.update(updateData);
    return {
      success: true,
      message: 'تم تحديث طريقة الدفع بنجاح',
      paymentMethod
    };
  },

  // Get most recent payment method
  async getMyPaymentMethod(userId) {
    const paymentMethod = await Payment.findOne({
      where: { UserId: userId, amount: 0 },
      order: [['createdAt', 'DESC']],
      attributes: [
        'id', 'paymentChoice', 'eGateway', 'notificationCategory',
        'qabdMethod', 'eWalletProvider', 'eWalletPhone',
        'paymentDate', 'createdAt', 'updatedAt'
      ]
    });
    if (!paymentMethod) throw { status: 404, error: 'لا توجد طريقة دفع محفوظة لهذا المستخدم' };
    return { success: true, paymentMethod };
  },

  // Get all payment methods for the user
  async getAllPaymentMethods(userId) {
    const paymentMethods = await Payment.findAll({
      where: { UserId: userId, amount: 0 },
      order: [['createdAt', 'DESC']]
    });
    return { success: true, paymentMethods };
  },

  // Get a single payment method by id for the user
  async getPaymentMethodById(userId, id) {
    const paymentMethod = await Payment.findOne({
      where: { id, UserId: userId, amount: 0 },
      attributes: [
        'id', 'paymentChoice', 'eGateway', 'notificationCategory',
        'qabdMethod', 'eWalletProvider', 'eWalletPhone',
        'paymentDate', 'createdAt', 'updatedAt'
      ]
    });
    if (!paymentMethod) throw { status: 404, error: 'طريقة الدفع غير موجودة' };
    return { success: true, paymentMethod };
  },
};
