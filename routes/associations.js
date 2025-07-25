const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const associationService = require('../services/associationService');

// Helper for error handling
function handleServiceError(error, res) {
  if (error && typeof error === 'object') {
    // For errors thrown as { status, error } or { status, errors }
    if (error.status) {
      return res.status(error.status).json(error);
    }
    // For plain JS Error
    if (error.message) {
      return res.status(500).json({ error: error.message });
    }
  }
  // Fallback
  return res.status(500).json({ error: 'Internal Server Error' });
}

// Create Association
router.post('/', [auth, admin], async (req, res) => {
  try {
    const result = await associationService.createAssociation(req.body);
    res.status(201).json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Get Associations (List, Paginated)
router.get('/', auth, async (req, res) => {
  try {
    const result = await associationService.getAssociations(req.query);
    res.json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Update Association
router.put('/:id', [auth, admin], async (req, res) => {
  try {
    const result = await associationService.updateAssociation(req.params.id, req.body);
    res.json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Delete Association
router.delete('/:id', [auth, admin], async (req, res) => {
  try {
    await associationService.deleteAssociation(req.params.id);
    res.json({ message: 'تم حذف الجمعية بنجاح' });
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Join Association
router.post('/:id/join', auth, async (req, res) => {
  try {
    const result = await associationService.joinAssociation(req.user.id, req.params.id, req.body.turnNumber);
    res.status(201).json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// My Associations
router.get('/my-associations', auth, async (req, res) => {
  try {
    const result = await associationService.getUserAssociations(req.user.id);
    res.json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Get all available turns grouped by association
router.get('/available-turns', auth, async (req, res) => {
  try {
    const result = await associationService.getAvailableTurnsForAll();
    res.json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Get Association Members
router.get('/:id/members', async (req, res) => {
  try {
    const result = await associationService.getAssociationMembers(req.params.id);
    res.json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Preview Fee
router.post('/:id/preview-fee', auth, async (req, res) => {
  try {
    const result = await associationService.previewFee(req.params.id, req.body.turnNumber);
    res.json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Available Turns
// router.get('/:id/available-turns', auth, async (req, res) => {
//   try {
//     const result = await associationService.getAvailableTurns(req.params.id);
//     res.json(result);
//   } catch (error) {
//     handleServiceError(error, res);
//   }
// });

// Get Association By ID
router.get('/:id', async (req, res) => {
  try {
    const result = await associationService.getAssociationById(req.params.id);
    res.json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Manual Payout Cycle (Test)
router.post('/test-cycle', [auth, admin], async (req, res) => {
  try {
    const result = await associationService.triggerCycleForAssociation(req.body.associationId);
    res.json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

module.exports = router;
