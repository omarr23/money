const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { User, Association, UserAssociation, Notification } = require('../models');
const auth = require('../middleware/auth');
const { Op } = require('sequelize');
const isAdmin = require('../middleware/admin');
const bcrypt = require('bcryptjs');

// --- Multer Configuration for File Uploads ---
const UPLOAD_DIR = 'uploads/';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_FILE_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, and PDF files are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_FILE_SIZE
  },
  fileFilter: fileFilter
});

// Helper function to delete old file
const deleteOldFile = async (filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    try {
      await fs.promises.unlink(filePath);
    } catch (error) {
      console.error('Error deleting old file:', error);
    }
  }
};

// --- User Document Upload ---
router.post('/upload-documents', upload.fields([
  { name: 'salarySlipImage', maxCount: 1 }
]), async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'Missing userId in request body' });
    }

    if (!req.files || !req.files.salarySlipImage) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      // Clean up uploaded file if user not found
      await deleteOldFile(req.files.salarySlipImage[0].path);
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete old file if exists
    if (user.salarySlipImage) {
      await deleteOldFile(user.salarySlipImage);
    }

    // Update user with new file path
    user.salarySlipImage = req.files.salarySlipImage[0].path;
    user.profileApproved = false;
    user.profileRejectedReason = null;

    await user.save();

    // --- SOCKET.IO ADMIN NOTIFICATION ---
    const io = req.app.get('io');
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
      message: 'Documents uploaded. Your profile is pending admin approval.',
      isRead: false
    });

    res.json({
      message: 'Document uploaded successfully. Awaiting admin approval.',
      user: {
        salarySlipImage: user.salarySlipImage
      }
    });

  } catch (error) {
    // Clean up uploaded file in case of error
    if (req.files && req.files.salarySlipImage) {
      await deleteOldFile(req.files.salarySlipImage[0].path);
    }

    console.error('File upload error:', error);
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File size too large. Maximum size is 5MB.' });
      }
      return res.status(400).json({ error: 'File upload error: ' + error.message });
    }
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

router.get('/uploads/:file', auth, async (req, res) => {
    try {
        const { file } = req.params;
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
          attributes: { exclude: ['password'] }
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

    // --- SOCKET.IO: Notify the user in real-time ---
    const io = req.app.get('io');
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
    // --- END SOCKET.IO ---

    const notificationMessage = approved 
      ? 'Your profile has been approved! You can now use all features of the platform.'
      : `Your profile has been rejected. Reason: ${user.profileRejectedReason}`;

    await Notification.create({
      userId: user.id,
      message: notificationMessage,
      isRead: false
    });

    res.json({
      message: `Profile ${approved ? 'approved' : 'rejected'} successfully.`,
      user: {
          id: user.id,
          profileApproved: user.profileApproved,
          profileRejectedReason: user.profileRejectedReason
      }
    });
  } catch (err) {
    console.error('Profile approval error:', err);
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

// Notifications endpoints
router.get('/notifications', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const { count, rows: notifications } = await Notification.findAndCountAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'message', 'isRead', 'createdAt'],
      limit,
      offset
    });
    
    res.json({
      notifications,
      pagination: {
        total: count,
        page,
        totalPages: Math.ceil(count / limit),
        hasMore: offset + notifications.length < count
      }
    });
  } catch (error) {
    console.error('Fetch notifications error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/notifications/:id/read', auth, async (req, res) => {
  try {
    const notification = await Notification.findOne({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    notification.isRead = true;
    await notification.save();

    res.json({ message: 'Notification marked as read', notification });
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/notifications/read-all', auth, async (req, res) => {
  try {
    await Notification.update(
      { isRead: true },
      {
        where: {
          userId: req.user.id,
          isRead: false
        }
      }
    );

    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/notifications/:id', auth, async (req, res) => {
  try {
    const notification = await Notification.findOne({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    await notification.destroy();
    res.json({ message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/notifications', auth, async (req, res) => {
  try {
    await Notification.destroy({
      where: {
        userId: req.user.id
      }
    });

    res.json({ message: 'All notifications deleted successfully' });
  } catch (error) {
    console.error('Delete all notifications error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- CHANGED: Create notification for the current user only ---
router.post('/notifications', auth, async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.user.id; // Always use the logged-in user's ID

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const notification = await Notification.create({
      userId,
      message,
      isRead: false
    });

    res.status(201).json({ message: 'Notification created', notification });
  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});


// ...existing code...

// Get salary slip image path for a user
router.get('/salary-slip/:userId', auth, async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await User.findByPk(userId, {
            attributes: ['id', 'salarySlipImage']
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (!user.salarySlipImage) {
            return res.status(404).json({ error: 'Salary slip not uploaded' });
        }
        res.json({ salarySlipImage: user.salarySlipImage });
    } catch (error) {
        console.error('Get salary slip error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


 





module.exports = router;
