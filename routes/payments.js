const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const paymentService = require('../services/paymentService');

// Error helper
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

// Pay association
router.post('/pay', auth, async (req, res) => {
  try {
    const result = await paymentService.payAssociation(req.user.id, req.body.associationId);
    res.status(201).json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Suggest association by amount
router.post('/pay/suggest', auth, async (req, res) => {
  try {
    const result = await paymentService.suggestAssociation(req.user.id, req.body.enter);
    res.json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Top up wallet
router.post('/topup', auth, async (req, res) => {
  try {
    const result = await paymentService.topUp(req.user.id, req.body.amount);
    res.status(200).json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Create payment method
router.post('/payment-method', auth, async (req, res) => {
  try {
    const result = await paymentService.createPaymentMethod(req.user.id, req.body);
    res.status(201).json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Update payment method
router.patch('/update-payment-method/:id', auth, async (req, res) => {
  try {
    const result = await paymentService.updatePaymentMethod(req.user.id, req.params.id, req.body);
    res.status(200).json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Get user's most recent payment method
router.get('/payment-method/my', auth, async (req, res) => {
  try {
    const result = await paymentService.getMyPaymentMethod(req.user.id);
    res.status(200).json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Get all user's payment methods
router.get('/method', auth, async (req, res) => {
  try {
    const result = await paymentService.getAllPaymentMethods(req.user.id);
    res.status(200).json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

// Get a specific payment method by id
router.get('/payment-method/:id', auth, async (req, res) => {
  try {
    const result = await paymentService.getPaymentMethodById(req.user.id, req.params.id);
    res.status(200).json(result);
  } catch (error) {
    handleServiceError(error, res);
  }
});

module.exports = router;
