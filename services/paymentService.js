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
    if (!enter || isNaN(enter)) throw { status: 400, error: 'المبلغ الإجمالي غير صالح أو مفقود' };
    const inputTotal = parseFloat(enter);
    const lowerBound = inputTotal - 1000;
    const upperBound = inputTotal + 1000;

    const userTurns = await Turn.findAll({
      where: { userId },
      attributes: ['associationId']
    });
    const joinedAssociationIds = userTurns.map(t => t.associationId);

    const associations = await Association.findAll({
      where: {
        status: 'pending',
        id: { [Op.notIn]: joinedAssociationIds.length > 0 ? joinedAssociationIds : [0] }
      },
      order: [['monthlyAmount', 'ASC']],
      limit: 100
    });

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

    const message = fallback
      ? `لا توجد جمعيات بقيمة إجمالية بين ${lowerBound} و ${upperBound} ريال. هذه أقرب الخيارات المتاحة.`
      : `تم العثور على جمعيات بقيمة إجمالية قريبة من ${inputTotal} ريال`;

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
