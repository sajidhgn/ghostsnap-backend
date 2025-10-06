const { shouldChargeUser } = require('../services/trialService');
const { asyncHandler } = require('../utils/errorHandler');

/**
 * Middleware to check trial status and handle auto-upgrade
 * Should be used after authentication middleware
 */
const checkTrialOnLogin = asyncHandler(async (req, res, next) => {
  try {
    // Only check for authenticated users
    if (!req.user) {
      return next();
    }

    console.log(`🔍 Checking trial status for user: ${req.user.email}`);
    
    const chargeDecision = await shouldChargeUser(req.user);
    
    // Add trial info to request object
    req.trialInfo = {
      shouldCharge: chargeDecision.shouldCharge,
      reason: chargeDecision.reason,
      trialEnd: chargeDecision.trialEnd,
      subscription: chargeDecision.subscription
    };

    // If user should be charged, we can handle it here or pass to next middleware
    if (chargeDecision.shouldCharge) {
      console.log(`⚠️ User ${req.user.email} should be charged - trial ended`);
      // You can redirect to payment page or handle billing here
      req.requiresPayment = true;
    }

    next();
  } catch (error) {
    console.error('❌ Error in trial check middleware:', error);
    // Don't block the request if trial check fails
    req.trialInfo = {
      shouldCharge: false,
      reason: 'error',
      error: error.message
    };
    next();
  }
});

/**
 * Middleware to require payment if trial ended
 * Should be used after checkTrialOnLogin
 */
const requirePaymentIfTrialEnded = asyncHandler(async (req, res, next) => {
  if (req.requiresPayment) {
    return res.status(402).json({
      success: false,
      message: 'Trial period ended. Payment required to continue.',
      requiresPayment: true,
      trialInfo: req.trialInfo
    });
  }
  next();
});

/**
 * Middleware to provide trial info without blocking
 * Useful for API endpoints that need trial status
 */
const provideTrialInfo = asyncHandler(async (req, res, next) => {
  try {
    if (!req.user) {
      req.trialInfo = null;
      return next();
    }

    const chargeDecision = await shouldChargeUser(req.user);
    req.trialInfo = {
      shouldCharge: chargeDecision.shouldCharge,
      reason: chargeDecision.reason,
      trialEnd: chargeDecision.trialEnd,
      subscription: chargeDecision.subscription
    };

    next();
  } catch (error) {
    console.error('❌ Error providing trial info:', error);
    req.trialInfo = null;
    next();
  }
});

module.exports = {
  checkTrialOnLogin,
  requirePaymentIfTrialEnded,
  provideTrialInfo
};

