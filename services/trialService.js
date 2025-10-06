const Subscription = require('../models/Subscription');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const { stripe } = require('../config/stripe');

/**
 * Check if user is within trial period and handle auto-upgrade
 * @param {Object} user - User object
 * @returns {Object} - Trial status and action taken
 */
const checkTrialStatus = async (user) => {
  try {
    console.log(`🔍 Checking trial status for user: ${user.email}`);

    // Find user's initial subscription
    const initialSubscription = await Subscription.findOne({
      user: user._id,
      subscriptionType: 'initial',
      status: { $in: ['active', 'trialing'] }
    });

    if (!initialSubscription) {
      console.log('ℹ️ No initial subscription found for user');
      return {
        isInTrial: false,
        shouldCharge: false,
        action: 'none'
      };
    }

    const now = new Date();
    const trialEnd = initialSubscription.trialEnd;
    
    if (!trialEnd) {
      console.log('⚠️ No trial end date found for initial subscription');
      return {
        isInTrial: false,
        shouldCharge: false,
        action: 'none'
      };
    }

    const isInTrial = now < trialEnd;
    
    if (isInTrial) {
      console.log(`✅ User is within trial period (ends: ${trialEnd.toISOString()})`);
      return {
        isInTrial: true,
        shouldCharge: false,
        action: 'trial_active'
      };
    } else {
      console.log(`⏰ Trial period ended (ended: ${trialEnd.toISOString()})`);
      
      // Check if user already has recurring subscription
      const recurringSubscription = await Subscription.findOne({
        user: user._id,
        subscriptionType: 'recurring',
        status: { $in: ['active', 'trialing'] }
      });

      if (recurringSubscription) {
        console.log('ℹ️ User already has recurring subscription');
        return {
          isInTrial: false,
          shouldCharge: false,
          action: 'already_recurring'
        };
      }

      // Auto-upgrade to recurring subscription
      console.log('🔄 Auto-upgrading to recurring subscription...');
      const upgradeResult = await upgradeToRecurringSubscription(initialSubscription);
      
      return {
        isInTrial: false,
        shouldCharge: true,
        action: 'upgraded_to_recurring',
        upgradeResult
      };
    }
  } catch (error) {
    console.error('❌ Error checking trial status:', error);
    return {
      isInTrial: false,
      shouldCharge: false,
      action: 'error',
      error: error.message
    };
  }
};

/**
 * Upgrade initial subscription to recurring subscription
 * @param {Object} initialSubscription - Initial subscription object
 * @returns {Object} - Upgrade result
 */
const upgradeToRecurringSubscription = async (initialSubscription) => {
  try {
    console.log(`🔄 Upgrading subscription ${initialSubscription._id} to recurring`);

    // Get recurring plan
    const recurringPlan = await SubscriptionPlan.getRecurringPlan();
    if (!recurringPlan) {
      throw new Error('Recurring plan not found');
    }

    // Update subscription in database
    initialSubscription.subscriptionType = 'recurring';
    initialSubscription.stripePriceId = recurringPlan.stripePriceId;
    initialSubscription.amount = recurringPlan.amount;
    initialSubscription.interval = recurringPlan.interval;
    initialSubscription.isFirstSubscription = false;
    initialSubscription.trialStart = null;
    initialSubscription.trialEnd = null;
    
    await initialSubscription.save();

    console.log(`✅ Subscription upgraded to recurring: ${initialSubscription._id}`);
    
    return {
      success: true,
      subscriptionId: initialSubscription._id,
      newAmount: recurringPlan.amount,
      newInterval: recurringPlan.interval
    };
  } catch (error) {
    console.error('❌ Error upgrading subscription:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Check if user should be charged for login
 * This is the main function to call when user logs in
 * @param {Object} user - User object
 * @returns {Object} - Charge decision and details
 */
const shouldChargeUser = async (user) => {
  const trialStatus = await checkTrialStatus(user);
  
  if (trialStatus.shouldCharge) {
    console.log(`💰 User should be charged: ${user.email}`);
    return {
      shouldCharge: true,
      reason: 'trial_ended',
      subscription: trialStatus.upgradeResult
    };
  } else if (trialStatus.isInTrial) {
    console.log(`🆓 User is in trial, no charge: ${user.email}`);
    return {
      shouldCharge: false,
      reason: 'in_trial',
      trialEnd: trialStatus.trialEnd
    };
  } else {
    console.log(`ℹ️ No charge needed: ${user.email}`);
    return {
      shouldCharge: false,
      reason: trialStatus.action
    };
  }
};

module.exports = {
  checkTrialStatus,
  upgradeToRecurringSubscription,
  shouldChargeUser
};

