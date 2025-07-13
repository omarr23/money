const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const turnService = require('../services/turnService');

// Helper for error handling
function handleServiceError(error, res) {
  if (error && typeof error === 'object') {
    if (error.status) {
      return res.status(error.status).json(error);
    }
    if (error.message) {
      return res.status(500).json({ error: error.message });
    }
  }
  return res.status(500).json({ error: 'Internal Server Error' });
}

// Pick/lock a turn for user
router.post('/pick/:turnId', auth, async (req, res) => {
  try {
    const result = await turnService.pickTurn(req.user.id, req.params.turnId);
    res.status(200).json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Get all available turns (future only)
router.get('/available', auth, async (req, res) => {
  try {
    const result = await turnService.getAvailableTurns();
    res.status(200).json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Get all turns for the logged in user
router.get('/my-turn', auth, async (req, res) => {
  try {
    const result = await turnService.getUserTurns(req.user.id);
    res.status(200).json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Get all turns for user's first association
router.get('/', auth, async (req, res) => {
  try {
    const result = await turnService.getTurnsForUserAssociation(req.user.id);
    res.json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Select a turn by body (alternate pick)
router.post('/select', auth, async (req, res) => {
  try {
    const result = await turnService.selectTurn(req.user.id, req.body.turnId);
    res.json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Get all turns for an association (user must be member)
router.get('/:associationId', auth, async (req, res) => {
  try {
    const result = await turnService.getTurnsForAssociation(req.user.id, req.params.associationId);
    res.json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Pick a turn (alt. endpoint)
router.post('/:turnId/pick', auth, async (req, res) => {
  try {
    const result = await turnService.pickTurnForAssociation(req.user.id, req.params.turnId);
    res.json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Admin: Create a new turn
router.post('/', [auth, admin], async (req, res) => {
  try {
    const result = await turnService.createTurn(req.body);
    res.status(201).json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Admin: Update a turn
router.put('/:turnId', [auth, admin], async (req, res) => {
  try {
    const result = await turnService.updateTurn(req.params.turnId, req.body);
    res.json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Admin: Delete a turn
router.delete('/:turnId', [auth, admin], async (req, res) => {
  try {
    const result = await turnService.deleteTurn(req.params.turnId);
    res.json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// GET all turns with specified details (for a dashboard, etc.)
router.get('/api/turns', auth, async (req, res) => {
  try {
    const result = await turnService.getAllTurnsFormatted();
    res.json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Get current turn/public info for an association
router.get('/public/:associationId', auth, async (req, res) => {
  try {
    const result = await turnService.getPublicTurnsInfo(req.params.associationId);
    res.status(200).json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

module.exports = router;
