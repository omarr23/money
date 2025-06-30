const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure the nationalID folder exists
const nationalIDFolder = path.join(__dirname, '../nationalID');
if (!fs.existsSync(nationalIDFolder)) {
  fs.mkdirSync(nationalIDFolder);
}

// Multer storage config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, nationalIDFolder);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
  }
});

// POST /api/nationalID/upload
router.post('/upload', upload.single('nationalIdImage'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({
    message: 'National ID image uploaded successfully',
    filePath: `/nationalID/${req.file.filename}`
  });
});

// GET /api/nationalID/all
router.get('/all', (req, res) => {
  fs.readdir(nationalIDFolder, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Unable to read nationalID folder' });
    }
    // Filter only image files (basic check)
    const imageFiles = files.filter(file => /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(file));
    res.json({ images: imageFiles });
  });
});

// GET /api/nationalID/:filename
router.get('/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(nationalIDFolder, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.sendFile(filePath);
});

module.exports = router; 