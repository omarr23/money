const { User, Association, UserAssociation, Notification } = require('../models');
const Payment = require('../models/payment');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');

// Helper to delete files
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const deleteOldFile = async (filePath) => {
  if (!filePath) return;
  const fullPath = path.join(UPLOAD_DIR, path.basename(filePath));
  if (fs.existsSync(fullPath)) {
    try { await fs.promises.unlink(fullPath); }
    catch (e) { console.error('Delete file error', e); }
  }
};

module.exports = {
  async uploadDocuments(req, res) {
    const { userId } = req.body;
    if (!userId) throw { status: 400, error: 'معرّف المستخدم مفقود في بيانات الطلب.' };
    if (!req.files || !req.files.salarySlipImage)
      throw { status: 400, error: 'لم يتم تحميل أي ملف.' };

    const user = await User.findByPk(userId);
    if (!user) {
      await deleteOldFile(req.files.salarySlipImage[0].path);
      throw { status: 404, error: 'المستخدم غير موجود.' };
    }

    if (user.salarySlipImage) await deleteOldFile(user.salarySlipImage);

    const relativePath = path.relative(path.join(__dirname, '..'), req.files.salarySlipImage[0].path);
    user.salarySlipImage = relativePath;
    user.profileApproved = false;
    user.profileRejectedReason = null;
    await user.save();

    // Notify admin via socket.io
    const io = req.app?.get('io');
    if (io) {
      io.sockets.sockets.forEach((socket) => {
        if (socket.role === 'admin') {
          socket.emit('new-document-upload', {
            userId: user.id,
            fullName: user.fullName,
            salarySlipImage: user.salarySlipImage
          });
        }
      });
    }

    await Notification.create({
      userId: user.id,
      message: 'تم تحميل المستندات. ملفك الشخصي قيد مراجعة الإدارة.',
      isRead: false,
      category: 'registration'
    });

    return {
      message: 'تم تحميل المستند بنجاح. في انتظار موافقة الإدارة.',
      user: { salarySlipImage: user.salarySlipImage }
    };
  },

  async serveUpload(req, res, uploadDir) {
    const { file } = req.params;
    const filePath = path.join(uploadDir, file);
    if (!fs.existsSync(filePath)) throw { status: 404, error: 'File not found' };
    res.sendFile(filePath);
  },

  async getWallet(userId) {
    const user = await User.findByPk(userId);
    if (!user) throw { status: 404, error: 'User not found' };
    return { walletBalance: user.walletBalance };
  },

  async getTransactions(userId) {
    const transactions = await Payment.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'amount', 'feeAmount', 'feePercent', 'paymentDate', 'createdAt']
    });
    const formatted = transactions.map(t => ({
      id: t.id,
      type: t.amount > 0 ? 'PAYOUT' : 'PAYMENT',
      amount: Math.abs(t.amount),
      fees: t.feeAmount,
      feePercent: t.feePercent,
      netAmount: Math.abs(t.amount) - t.feeAmount,
      date: t.paymentDate || t.createdAt
    }));
    return { success: true, data: formatted };
  },

  async getProfile(userId) {
    const user = await User.findByPk(userId, {
      attributes: [
        'id', 'fullName', 'nationalId', 'phone', 'profileImage',
        'salarySlipImage', 'profileApproved', 'profileRejectedReason'
      ]
    });
    if (!user) throw { status: 404, error: 'User not found' };
    return user;
  },

  async updateProfile(userId, req, res) {
    const user = await User.findByPk(userId);
    if (!user) throw { status: 404, error: 'User not found' };
    if (req.body.password)
      user.password = await bcrypt.hash(req.body.password, 10);

    if (req.file) {
      if (user.profileImage) await deleteOldFile(user.profileImage);
      user.profileImage = path.relative(path.join(__dirname, '..'), req.file.path);
    }
    ['fullName', 'phone', 'address'].forEach((field) => {
      if (req.body[field]) user[field] = req.body[field];
    });

    await user.save();
    return {
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        fullName: user.fullName,
        phone: user.phone,
        address: user.address,
        profileImage: user.profileImage,
      },
    };
  },

  async createUser(data) {
    const { fullName, nationalId, phone, address, role, password } = data;
    if (!fullName || !nationalId || !phone || !password || !role)
      throw { status: 400, error: 'Missing required fields' };

    const existingUser = await User.findOne({
      where: { [Op.or]: [{ phone }, { nationalId }] }
    });
    if (existingUser) throw { status: 409, error: 'User already exists with given phone or nationalId' };

    const newUser = await User.create({ fullName, nationalId, phone, address, role, password });
    return { message: 'User created successfully', user: newUser };
  },

  async adminUpdateUser(id, data) {
    const user = await User.findByPk(id);
    if (!user) throw { status: 404, error: 'User not found' };

    ['fullName', 'nationalId', 'phone', 'address', 'role'].forEach(field => {
      if (data[field]) user[field] = data[field];
    });
    if (data.password)
      user.password = await bcrypt.hash(data.password, 10);
    await user.save();
    return { message: 'User updated successfully', user };
  },

  async approveProfile(req, res) {
    const { id } = req.params;
    const { approved, reason } = req.body;
    const user = await User.findByPk(id);
    if (!user) throw { status: 404, error: 'User not found' };
    user.profileApproved = !!approved;
    user.profileRejectedReason = approved ? null : (reason || 'Your profile was not approved.');
    await user.save();

    const io = req.app?.get('io');
    if (io) {
      io.sockets.sockets.forEach((socket) => {
        if (socket.userId == user.id) {
          socket.emit('profile-reviewed', {
            approved: user.profileApproved,
            reason: user.profileRejectedReason,
          });
        }
      });
    }
    const notificationMessage = approved
      ? 'Your profile has been approved! You can now use all features of the platform.'
      : `Your profile has been rejected. Reason: ${user.profileRejectedReason}`;
    await Notification.create({
      userId: user.id,
      message: notificationMessage,
      isRead: false,
      category: 'profile'
    });
    return {
      message: `Profile ${approved ? 'approved' : 'rejected'} successfully.`,
      user: {
        id: user.id,
        profileApproved: user.profileApproved,
        profileRejectedReason: user.profileRejectedReason
      }
    };
  },

  async getUserById(id) {
    const user = await User.findByPk(id, {
      attributes: { exclude: ['password'] }
    });
    if (!user) throw { status: 404, error: 'User not found' };
    return user;
  },

  async deleteUser(id) {
    const user = await User.findByPk(id);
    if (!user) throw { status: 404, error: 'User not found' };
    await user.destroy();
    return { message: 'User deleted successfully' };
  },

  async getAllUsers() {
    return await User.findAll({ attributes: { exclude: ['password'] } });
  },

  // Notifications
  async getNotifications(req) {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const where = { userId: req.user.id };
    if (req.query.category && req.query.category !== 'all')
      where.category = req.query.category;

    const { count, rows: notifications } = await Notification.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'message', 'isRead', 'createdAt', 'associationId', 'category'],
      limit,
      offset
    });

    return {
      notifications,
      pagination: {
        total: count,
        page,
        totalPages: Math.ceil(count / limit),
        hasMore: offset + notifications.length < count
      }
    };
  },

  async markNotificationRead(userId, id) {
    const notification = await Notification.findOne({
      where: { id, userId }
    });
    if (!notification) throw { status: 404, error: 'Notification not found' };
    notification.isRead = true;
    await notification.save();
    return { message: 'Notification marked as read', notification };
  },

  async markAllNotificationsRead(userId) {
    await Notification.update(
      { isRead: true },
      { where: { userId, isRead: false } }
    );
    return { message: 'All notifications marked as read' };
  },

  async deleteNotification(userId, id) {
    const notification = await Notification.findOne({
      where: { id, userId }
    });
    if (!notification) throw { status: 404, error: 'Notification not found' };
    await notification.destroy();
    return { message: 'Notification deleted successfully' };
  },

  async deleteAllNotifications(userId) {
    await Notification.destroy({ where: { userId } });
    return { message: 'All notifications deleted successfully' };
  },

  async createNotification(req, res) {
    const { message, associationId, userId, category } = req.body;
    let targetUserId = req.user.id;
    if (userId && req.user.role === 'admin') targetUserId = userId;
    if (!message) throw { status: 400, error: 'Message is required' };

    let assoc = null;
    if (associationId) {
      assoc = await Association.findByPk(associationId);
      if (!assoc) throw { status: 404, error: 'Association not found' };
    }

    const notification = await Notification.create({
      userId: targetUserId,
      message,
      associationId: associationId || null,
      isRead: false,
      category: category || 'general',
    });

    return { message: 'Notification created', notification };
  },

  async getSalarySlip(userId) {
    const user = await User.findByPk(userId, { attributes: ['id', 'salarySlipImage'] });
    if (!user) throw { status: 404, error: 'User not found' };
    if (!user.salarySlipImage) throw { status: 404, error: 'Salary slip not uploaded' };
    return { salarySlipImage: user.salarySlipImage };
  },

  async getUserHistory(userId) {
    const user = await User.findByPk(userId, { attributes: { exclude: ['password'] } });
    if (!user) throw { status: 404, error: 'User not found' };

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
    const associations = (userWithAssociations.Associations || []).map(association => ({
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

    const transactions = await Payment.findAll({
      where: { UserId: userId },
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'amount', 'feeAmount', 'feePercent', 'paymentDate', 'createdAt']
    });
    const formattedTransactions = transactions.map(t => ({
      id: t.id,
      type: t.amount > 0 ? 'PAYOUT' : 'PAYMENT',
      amount: Math.abs(t.amount),
      fees: t.feeAmount,
      feePercent: t.feePercent,
      netAmount: Math.abs(t.amount) - t.feeAmount,
      date: t.paymentDate || t.createdAt
    }));

    return { user, associations, transactions: formattedTransactions };
  },

  async adminTopUpWallet(userId, amount) {
    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      throw { status: 400, error: 'Invalid top-up amount' };
    }
    const user = await User.findByPk(userId);
    if (!user) throw { status: 404, error: 'User not found' };
    user.walletBalance += Number(amount);
    await user.save();
    return { message: 'Wallet topped up successfully', walletBalance: user.walletBalance };
  }
};
