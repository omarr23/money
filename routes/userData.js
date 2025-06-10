const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { User, Association, UserAssociation } = require('../models');
const auth = require('../middleware/auth');
const { Op } = require('sequelize');
const isAdmin = require('../middleware/admin');
const bcrypt = require('bcryptjs');

// --- Multer Configuration for File Uploads ---
// This sets up where to store the uploaded files and how to name them.
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Files will be saved in the 'uploads/' directory.
    // Make sure this directory exists at the root of your project.
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    // To prevent files with the same name from overwriting each other,
    // we add a unique suffix (the current timestamp) to the filename.
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Initialize multer with the storage configuration.
const upload = multer({ storage: storage });

// --- NEW ROUTE: User Document Upload ---
// This endpoint allows a logged-in user to upload their profile and salary images.
// It uses `upload.fields` to handle multiple files from different form fields.
router.post('/upload-documents', upload.fields([
  { name: 'salarySlipImage', maxCount: 1 }
]), async (req, res) => {
  try {
    // For public access, you need to specify which user to update.
    // Let's assume the client sends userId in the body.
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'Missing userId in request body' });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Only handle salary slip image upload
    if (req.files.salarySlipImage) {
      user.salarySlipImage = req.files.salarySlipImage[0].path;
    }

    // The profile is pending approval after new documents are uploaded.
    user.profileApproved = false;
    user.profileRejectedReason = null;

    await user.save();

    res.json({ 
      message: 'Document uploaded successfully. Awaiting admin approval.',
      user: {
        salarySlipImage: user.salarySlipImage
      }
    });

  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: 'Server error during file upload.' });
  }
});


router.get('/wallet', auth, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id);
        if (!user) {
            return res.status(404).json({error:'User not found'});
        }
        res.json({ walletBalance: user.walletBalance });
    } catch (error) {
        console.error(error);
        res.status(500).json({error:'Server error'});
    }
});

router.get('/profile', auth, async (req, res) => {
    try {
        // Updated to include all relevant profile fields for the user to view.
        const user = await User.findByPk(req.user.id, {
            attributes: [
                'id', 
                'fullName', 
                'nationalId', 
                'phone', 
                'profileImage', 
                'salarySlipImage',
                'profileApproved',
                'profileRejectedReason'
            ]
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// This route allows the client to fetch and display the uploaded images.
router.get('/uploads/:file', auth, async (req, res) => {
    try {
        const { file } = req.params;
        // It's important to use path.join to create a safe file path.
        const filePath = path.join(__dirname, '..', 'uploads', file);
        res.sendFile(filePath);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/admin/create-user', auth, isAdmin, async (req, res) => {
    const {
      fullName,
      nationalId,
      phone,
      address,
      role,
      password
    } = req.body;
  
    if (!fullName || !nationalId || !phone || !password || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
  
    try {
      const existingUser = await User.findOne({
        where: {
          [Op.or]: [{ phone }, { nationalId }]
        }
      });
  
      if (existingUser) {
        return res.status(409).json({ error: 'User already exists with given phone or nationalId' });
      }
  
      // The beforeCreate hook in your model will handle hashing, so no need to hash here.
      const newUser = await User.create({
        fullName,
        nationalId,
        phone,
        address,
        role,
        password
      });
  
      res.status(201).json({ message: 'User created successfully', user: newUser });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Server error' });
    }
  });
  
  router.get('/users', auth, async (req, res) => {
    try {
      const users = await User.findAll({
          attributes: { exclude: ['password'] } // Exclude passwords from the list
      });
      res.status(200).json(users);
    } catch (err) {
      console.error('Get all users error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });
  
router.put('/admin/update-user/:id', [auth, isAdmin], async (req, res) => {
  const { id } = req.params;
  const { fullName, nationalId, phone, address, role, password } = req.body;

  try {
      const user = await User.findByPk(id);
      if (!user) {
          return res.status(404).json({ error: 'User not found' });
      }

      if (fullName) user.fullName = fullName;
      if (nationalId) user.nationalId = nationalId;
      if (phone) user.phone = phone;
      if (address) user.address = address;
      if (role) user.role = role;
      if (password) {
          // You should hash the password on update as well.
          user.password = await bcrypt.hash(password, 10);
      }

      await user.save();
      res.json({ message: 'User updated successfully', user });

  } catch (error) {
      console.error('Update user error:', error);
      res.status(500).json({ error: 'Server error' });
  }
});

router.post('/admin/approve-profile/:id', [auth, isAdmin], async (req, res) => {
  const { id } = req.params;
  const { approved, reason } = req.body; 

  try {
    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.profileApproved = !!approved;
    user.profileRejectedReason = approved ? null : (reason || 'Your profile was not approved.');
    await user.save();

    res.json({
      message: `Profile ${approved ? 'approved' : 'rejected'} successfully.`,
      user: {
          id: user.id,
          profileApproved: user.profileApproved,
          profileRejectedReason: user.profileRejectedReason
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/user/:id', [auth, isAdmin], async (req, res) => {
  const { id } = req.params;
  try {
    const user = await User.findByPk(id, {
      attributes: { exclude: ['password'] } 
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/admin/delete-user/:id', [auth, isAdmin], async (req, res) => {
  const { id } = req.params;

  try {
      const user = await User.findByPk(id);
      if (!user) {
          return res.status(404).json({ error: 'User not found' });
      }

      await user.destroy();
      res.json({ message: 'User deleted successfully' });

  } catch (error) {
      console.error('Delete user error:', error);
      res.status(500).json({ error: 'Server error' });
  }
});


module.exports = router;
