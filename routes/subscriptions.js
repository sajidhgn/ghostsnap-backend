const express = require('express');
const {
  getSubscriptionPlans,
  createCheckoutSession,
  getCurrentSubscription,
  cancelSubscription,
  reactivateSubscription,
  getSubscriptionHistory,
  getPaymentHistory,
  handleCheckoutSuccess
} = require('../controllers/subscriptionController');

const { protect, requireEmailVerification } = require('../middleware/auth');
const { subscriptionLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Public routes
router.get('/plans', getSubscriptionPlans);
router.get('/success', handleCheckoutSuccess);

// Protected routes
router.use(protect); // All routes below require authentication

router.post('/create-checkout-session', 
  requireEmailVerification, 
  subscriptionLimiter, 
  createCheckoutSession
);

router.get('/current', getCurrentSubscription);
router.post('/cancel', cancelSubscription);
router.post('/reactivate', reactivateSubscription);
router.get('/history', getSubscriptionHistory);
router.get('/payments', getPaymentHistory);

module.exports = router;
