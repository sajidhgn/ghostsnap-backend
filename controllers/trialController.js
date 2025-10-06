const { shouldChargeUser } = require('../services/trialService');
const { asyncHandler, ErrorResponse } = require('../utils/errorHandler');

/**
 * @desc    Check trial status for current user
 * @route   GET /api/trial/status
 * @access  Private
 */
const getTrialStatus = asyncHandler(async (req, res) => {
  const chargeDecision = await shouldChargeUser(req.user);
  
  res.json({
    success: true,
    data: {
      shouldCharge: chargeDecision.shouldCharge,
      reason: chargeDecision.reason,
      trialEnd: chargeDecision.trialEnd,
      subscription: chargeDecision.subscription,
      user: {
        id: req.user._id,
        email: req.user.email
      }
    }
  });
});

/**
 * @desc    Handle trial upgrade to recurring subscription
 * @route   POST /api/trial/upgrade
 * @access  Private
 */
const upgradeTrial = asyncHandler(async (req, res) => {
  const chargeDecision = await shouldChargeUser(req.user);
  
  if (!chargeDecision.shouldCharge) {
    return res.status(400).json({
      success: false,
      message: 'No upgrade needed. User is still in trial or already has recurring subscription.'
    });
  }

  // The upgrade should have already been handled by the trial service
  res.json({
    success: true,
    message: 'Subscription upgraded to recurring',
    data: {
      subscription: chargeDecision.subscription,
      newAmount: chargeDecision.subscription?.newAmount,
      newInterval: chargeDecision.subscription?.newInterval
    }
  });
});

/**
 * @desc    Get user's subscription details
 * @route   GET /api/trial/subscription
 * @access  Private
 */
const getSubscriptionDetails = asyncHandler(async (req, res) => {
  const Subscription = require('../models/Subscription');
  
  const subscription = await Subscription.findOne({
    user: req.user._id,
    status: { $in: ['active', 'trialing'] }
  }).populate('user');

  if (!subscription) {
    return res.status(404).json({
      success: false,
      message: 'No active subscription found'
    });
  }

  res.json({
    success: true,
    data: {
      subscription: {
        id: subscription._id,
        type: subscription.subscriptionType,
        status: subscription.status,
        amount: subscription.amount,
        currency: subscription.currency,
        interval: subscription.interval,
        trialStart: subscription.trialStart,
        trialEnd: subscription.trialEnd,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        isInTrial: subscription.isInTrial,
        shouldUpgrade: subscription.shouldUpgradeToRecurring ? subscription.shouldUpgradeToRecurring() : false
      }
    }
  });
});

module.exports = {
  getTrialStatus,
  upgradeTrial,
  getSubscriptionDetails
};

