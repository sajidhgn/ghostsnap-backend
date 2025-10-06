const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { provideTrialInfo } = require('../middleware/trialCheck');
const { 
  getTrialStatus, 
  upgradeTrial, 
  getSubscriptionDetails 
} = require('../controllers/trialController');

// All routes are protected
router.use(protect);

// Get trial status
router.get('/status', provideTrialInfo, getTrialStatus);

// Upgrade trial to recurring
router.post('/upgrade', provideTrialInfo, upgradeTrial);

// Get subscription details
router.get('/subscription', getSubscriptionDetails);

module.exports = router;

