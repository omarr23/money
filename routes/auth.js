const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();
const { Op } = require('sequelize');

const path = require('path');
const upload = multer({ dest: 'uploads/' });

router.post('/register', upload.fields([
  { name: 'profileImage', maxCount: 1 },
  { name: 'salarySlipImage', maxCount: 1 }
]), async (req, res) => {
  try {
    const userData = { ...req.body };

    // Validate email
    if (!userData.email || !/^\S+@\S+\.\S+$/.test(userData.email)) {
      return res.status(400).json({ error: 'بريد إلكتروني غير صالح' });
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

    const existingUser = await User.findOne({
      where: {
        [Op.or]: [
          { phone: userData.phone },
          { nationalId: userData.nationalId },
          { email: userData.email }
        ]
      }
    });
      
    if (existingUser) {
      return res.status(400).json({ error: 'البريد الإلكتروني أو رقم الهاتف أو رقم البطاقة مسجل مسبقًا' });
    }

    const user = await User.create(userData);
    console.log('User created:', user.email);
    res.status(200).json(user);

  } catch (err) {
    console.error('Error in /register:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء التسجيل' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('Login attempt with:', { email, password });

    if (!email || !password) {
      return res.status(400).send('يجب إدخال البريد الإلكتروني وكلمة المرور');
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).send('بريد إلكتروني غير صالح');
    }

    const user = await User.findOne({ where: { email } });
    console.log('Found user:', user?.email);

    if (!user) {
      return res.status(404).send('البريد الإلكتروني أو كلمة المرور غير صحيحة');
    }

    console.log('Stored hash:', user.password);
    const validPassword = await bcrypt.compare(password, user.password);
    console.log('Password valid:', validPassword);

    if (!validPassword) {
      return res.status(400).send('البريد الإلكتروني أو كلمة المرور غير صحيحة');
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
    const { secretKey, fullName, nationalId, password, phone, email } = req.body;
    
    // Validate email
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).send('بريد إلكتروني غير صالح');
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

    // تحقق من عدم وجود مستخدم بنفس الرقم القومي أو البريد الإلكتروني
    const existingUser = await User.findOne({ where: { [Op.or]: [{ nationalId }, { email }] } });
    if (existingUser) {
      return res.status(400).send('رقم البطاقة أو البريد الإلكتروني مسجل مسبقًا');
    }

    // إنشاء المدير
    // const hashedPassword = await bcrypt.hash(password, 10);
    const adminUser = await User.create({
      fullName,
      nationalId,
      password: password,
      phone,
      email,
      role: 'admin'
    });

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