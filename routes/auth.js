const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();
const { Op } = require('sequelize');

const path = require('path');
const upload = multer({ dest: 'uploads/' });

// Email validation function
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

router.post('/register', upload.fields([
  { name: 'profileImage', maxCount: 1 },
  { name: 'salarySlipImage', maxCount: 1 }
]), async (req, res) => {
  try {
    const userData = { ...req.body };

    // Validate required fields - either email or nationalId is required
    if (!userData.password || !userData.fullName || !userData.phone) {
      return res.status(400).json({ error: 'جميع الحقول مطلوبة: كلمة المرور، الاسم الكامل، رقم الهاتف' });
    }

    // Check if user provided email or nationalId
    if (!userData.email && !userData.nationalId) {
      return res.status(400).json({ error: 'يجب إدخال البريد الإلكتروني أو رقم البطاقة الوطنية' });
    }

    // Validate email format if provided
    if (userData.email && !validateEmail(userData.email)) {
      return res.status(400).json({ error: 'صيغة البريد الإلكتروني غير صحيحة' });
    }

    // Handle profile image if provided
    if (req.files && req.files['profileImage']) {
      const profileImageFile = req.files['profileImage'][0];
      const profileImageExt = path.extname(profileImageFile.originalname);
      const newProfileImagePath = profileImageFile.path + profileImageExt;
      fs.renameSync(profileImageFile.path, newProfileImagePath);
      userData.profileImage = newProfileImagePath.replace(/\\/g, '/');
    }

    // Handle salary slip image if provided
    if (req.files && req.files['salarySlipImage']) {
      const salarySlipImageFile = req.files['salarySlipImage'][0];
      const salarySlipImageExt = path.extname(salarySlipImageFile.originalname);
      const newSalarySlipImagePath = salarySlipImageFile.path + salarySlipImageExt;
      fs.renameSync(salarySlipImageFile.path, newSalarySlipImagePath);
      userData.salarySlipImage = newSalarySlipImagePath.replace(/\\/g, '/');
    }

    // Check for existing user by email, nationalId, or phone
    const existingUserConditions = [{ phone: userData.phone }];
    if (userData.email) existingUserConditions.push({ email: userData.email });
    if (userData.nationalId) existingUserConditions.push({ nationalId: userData.nationalId });

    const existingUser = await User.findOne({
      where: { [Op.or]: existingUserConditions }
    });
      
    if (existingUser) {
      if (existingUser.email === userData.email) {
        return res.status(400).json({ error: 'البريد الإلكتروني مسجل مسبقًا' });
      } else if (existingUser.nationalId === userData.nationalId) {
        return res.status(400).json({ error: 'رقم البطاقة الوطنية مسجل مسبقًا' });
      } else {
        return res.status(400).json({ error: 'رقم الهاتف مسجل مسبقًا' });
      }
    }

    const user = await User.create(userData);
    const identifier = user.email || user.nationalId;
    console.log('User created:', identifier);
    res.status(200).json(user);

  } catch (err) {
    console.error('Error in /register:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء التسجيل' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, nationalId, password } = req.body;
    
    // Check if user provided email or nationalId
    if (!email && !nationalId) {
      return res.status(400).send('يجب إدخال البريد الإلكتروني أو رقم البطاقة الوطنية وكلمة المرور');
    }

    if (!password) {
      return res.status(400).send('يجب إدخال كلمة المرور');
    }

    // Find user by email or nationalId
    let user;
    if (email) {
      user = await User.findOne({ where: { email } });
      console.log('Login attempt with email:', email);
    } else {
      user = await User.findOne({ where: { nationalId } });
      console.log('Login attempt with nationalId:', nationalId);
    }

    if (!user) {
      return res.status(404).send('بيانات تسجيل الدخول غير صحيحة');
    }

    console.log('Found user:', user.email || user.nationalId);
    console.log('Stored hash:', user.password);
    const validPassword = await bcrypt.compare(password, user.password);
    console.log('Password valid:', validPassword);

    if (!validPassword) {
      return res.status(400).send('بيانات تسجيل الدخول غير صحيحة');
    }

    // إنشاء التوكن
    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        walletBalance: user.walletBalance
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.send({ 
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        role: user.role,
        walletBalance: user.walletBalance
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).send('حدث خطأ أثناء تسجيل الدخول');
  }
});

router.post('/register-admin', async (req, res) => {
  try {
    const { secretKey, fullName, email, nationalId, password, phone } = req.body;
    
    // Validate required fields - either email or nationalId is required
    if (!password || !fullName || !phone) {
      return res.status(400).send('جميع الحقول مطلوبة: كلمة المرور، الاسم الكامل، رقم الهاتف');
    }

    // Check if user provided email or nationalId
    if (!email && !nationalId) {
      return res.status(400).send('يجب إدخال البريد الإلكتروني أو رقم البطاقة الوطنية');
    }

    // Validate email format if provided
    if (email && !validateEmail(email)) {
      return res.status(400).send('صيغة البريد الإلكتروني غير صحيحة');
    }
    
    // تحقق من وجود الكود السري
    if (!secretKey) {
      return res.status(400).send('مطلوب كود سري');
    }

    // تحقق من تطابق الكود السري
    if (secretKey !== process.env.ADMIN_SECRET) {
      console.log('الكود المُرسل:', secretKey);
      console.log('الكود الصحيح:', process.env.ADMIN_SECRET);
      return res.status(403).send('غير مصرح به - كود سري خاطئ');
    }

    // Check for existing user by email, nationalId, or phone
    const existingUserConditions = [{ phone }];
    if (email) existingUserConditions.push({ email });
    if (nationalId) existingUserConditions.push({ nationalId });

    const existingUser = await User.findOne({ where: { [Op.or]: existingUserConditions } });
    if (existingUser) {
      if (existingUser.email === email) {
        return res.status(400).send('البريد الإلكتروني مسجل مسبقًا');
      } else if (existingUser.nationalId === nationalId) {
        return res.status(400).send('رقم البطاقة الوطنية مسجل مسبقًا');
      } else {
        return res.status(400).send('رقم الهاتف مسجل مسبقًا');
      }
    }

    // Create admin user
    const adminData = {
      fullName,
      password: password,
      phone,
      role: 'admin'
    };
    
    if (email) adminData.email = email;
    if (nationalId) adminData.nationalId = nationalId;

    const adminUser = await User.create(adminData);

    res.status(201).json({
      message: 'تم إنشاء المدير بنجاح',
      user: {
        id: adminUser.id,
        fullName: adminUser.fullName,
        role: adminUser.role
      }
    });

  } catch (error) {
    console.error('خطأ في إنشاء المدير:', error);
    res.status(500).send('خطأ داخلي في الخادم');
  }
});

module.exports = router;