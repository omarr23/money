const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/admin');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const userService = require('../services/userService');

// --- File Upload Config (unchanged, shared for service as well) ---
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const fileFilter = (req, file, cb) => {
  if (ALLOWED_FILE_TYPES.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Invalid file type. Only JPEG, PNG, and PDF allowed.'), false);
};
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter
});

function handleServiceError(error, res) {
  if (error && typeof error === 'object') {
    if (error.status) return res.status(error.status).json(error);
    if (error.message) return res.status(500).json({ error: error.message });
  }
  return res.status(500).json({ error: 'Server error' });
}

// --------- Document Upload ---------
router.post('/upload-documents', upload.fields([
  { name: 'salarySlipImage', maxCount: 1 }
]), async (req, res) => {
  try {
    const result = await userService.uploadDocuments(req, res);
    res.json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Serve uploaded file
router.get('/uploads/:file', auth, async (req, res) => {
  try {
    await userService.serveUpload(req, res, UPLOAD_DIR);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Get wallet balance
router.get('/wallet', auth, async (req, res) => {
  try {
    res.json(await userService.getWallet(req.user.id));
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Get transactions
router.get('/transactions', auth, async (req, res) => {
  try {
    res.json(await userService.getTransactions(req.user.id));
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Get profile
router.get('/profile', auth, async (req, res) => {
  try {
    res.json(await userService.getProfile(req.user.id));
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Update user profile (with optional image and password)
router.put('/user/update', auth, upload.single('profileImage'), async (req, res) => {
  try {
    res.json(await userService.updateProfile(req.user.id, req, res));
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Admin: create user
router.post('/admin/create-user', auth, isAdmin, async (req, res) => {
  try {
    res.status(201).json(await userService.createUser(req.body));
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Admin: update user
router.put('/admin/update-user/:id', auth, isAdmin, async (req, res) => {
  try {
    res.json(await userService.adminUpdateUser(req.params.id, req.body));
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Admin: approve/reject profile
router.post('/admin/approve-profile/:id', auth, isAdmin, async (req, res) => {
  try {
    res.json(await userService.approveProfile(req, res));
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Admin: get single user
router.get('/user/:id', auth, isAdmin, async (req, res) => {
  try {
    res.json(await userService.getUserById(req.params.id));
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Admin: delete user
router.delete('/admin/delete-user/:id', auth, isAdmin, async (req, res) => {
  try {
    res.json(await userService.deleteUser(req.params.id));
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Get all users (no passwords)
router.get('/users', auth, async (req, res) => {
  try {
    res.json(await userService.getAllUsers());
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Notifications (create/read/delete/read-all/get)
router.get('/notifications', auth, async (req, res) => {
  try {
    res.json(await userService.getNotifications(req));
  } catch (error) {
    handleServiceError(error, res);
  }
});
router.put('/notifications/:id/read', auth, async (req, res) => {
  try {
    res.json(await userService.markNotificationRead(req.user.id, req.params.id));
  } catch (error) {
    handleServiceError(error, res);
  }
});
router.put('/notifications/read-all', auth, async (req, res) => {
  try {
    res.json(await userService.markAllNotificationsRead(req.user.id));
  } catch (error) {
    handleServiceError(error, res);
  }
});
router.delete('/notifications/:id', auth, async (req, res) => {
  try {
    res.json(await userService.deleteNotification(req.user.id, req.params.id));
  } catch (error) {
    handleServiceError(error, res);
  }
});
router.delete('/notifications', auth, async (req, res) => {
  try {
    res.json(await userService.deleteAllNotifications(req.user.id));
  } catch (error) {
    handleServiceError(error, res);
  }
});
router.post('/notifications', auth, async (req, res) => {
  try {
    res.status(201).json(await userService.createNotification(req, res));
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Extra: salary slip image path
router.get('/salary-slip/:userId', auth, async (req, res) => {
  try {
    res.json(await userService.getSalarySlip(req.params.userId));
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Detailed user history (for logged-in user)
router.get('/user/history', auth, async (req, res) => {
  try {
    res.json(await userService.getUserHistory(req.user.id));
  } catch (error) {
    handleServiceError(error, res);
  }
});
// For admin
router.get('/user/:id/history', auth, isAdmin, async (req, res) => {
  try {
    res.json(await userService.getUserHistory(req.params.id));
  } catch (error) {
    handleServiceError(error, res);
  }
});

module.exports = router;
