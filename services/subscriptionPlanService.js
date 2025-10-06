const User = require('../models/User');
const Subscription = require('../models/Subscription');
const SubscriptionPlan = require('../models/SubscriptionPlan');

/**
 * Determine which subscription plan a user should get
 * @param {Object} user - User object
 * @returns {Object} - Plan recommendation and reasoning
 */
const getRecommendedPlan = async (user) => {
  try {
    console.log(`🔍 Determining plan for user: ${user.email}`);

    // Check if user has ever had a subscription (including cancelled ones)
    const hasEverSubscribed = user.hasEverSubscribed;
    
    // Check if user has any active subscriptions
    const activeSubscription = await Subscription.findOne({
      user: user._id,
      status: { $in: ['active', 'trialing'] }
    });

    if (activeSubscription) {
      console.log('ℹ️ User already has active subscription');
      return {
        planType: 'existing',
        reason: 'user_has_active_subscription',
        subscription: activeSubscription
      };
    }

    // Check if user has ever had any subscription (including cancelled)
    const hasAnySubscription = await Subscription.findOne({
      user: user._id
    });

    if (hasAnySubscription || hasEverSubscribed) {
      console.log('🔄 Returning user - should go directly to recurring plan');
      return {
        planType: 'recurring',
        reason: 'returning_user',
        skipInitial: true
      };
    }

    console.log('🆕 New user - should get initial plan with trial');
    return {
      planType: 'initial',
      reason: 'new_user',
      skipInitial: false
    };
  } catch (error) {
    console.error('❌ Error determining plan:', error);
    return {
      planType: 'initial',
      reason: 'error_fallback',
      skipInitial: false,
      error: error.message
    };
  }
};

/**
 * Get the appropriate plan for a user
 * @param {Object} user - User object
 * @returns {Object} - Subscription plan object
 */
const getPlanForUser = async (user) => {
  try {
    const recommendation = await getRecommendedPlan(user);
    
    if (recommendation.planType === 'recurring') {
      const recurringPlan = await SubscriptionPlan.getRecurringPlan();
      return {
        plan: recurringPlan,
        isReturningUser: true,
        reason: recommendation.reason
      };
    } else if (recommendation.planType === 'initial') {
      const initialPlan = await SubscriptionPlan.getInitialPlan();
      return {
        plan: initialPlan,
        isReturningUser: false,
        reason: recommendation.reason
      };
    } else {
      // User has existing subscription
      return {
        plan: null,
        isReturningUser: false,
        reason: recommendation.reason,
        existingSubscription: recommendation.subscription
      };
    }
  } catch (error) {
    console.error('❌ Error getting plan for user:', error);
    // Fallback to initial plan
    const initialPlan = await SubscriptionPlan.getInitialPlan();
    return {
      plan: initialPlan,
      isReturningUser: false,
      reason: 'error_fallback'
    };
  }
};

/**
 * Check if user should skip initial payment
 * @param {Object} user - User object
 * @returns {boolean} - Whether to skip initial payment
 */
const shouldSkipInitialPayment = async (user) => {
  const recommendation = await getRecommendedPlan(user);
  return recommendation.planType === 'recurring';
};

/**
 * Mark user as having ever subscribed
 * @param {Object} user - User object
 */
const markUserAsEverSubscribed = async (user) => {
  try {
    if (!user.hasEverSubscribed) {
      user.hasEverSubscribed = true;
      await user.save();
      console.log(`✅ Marked user ${user.email} as having ever subscribed`);
    }
  } catch (error) {
    console.error('❌ Error marking user as ever subscribed:', error);
  }
};

module.exports = {
  getRecommendedPlan,
  getPlanForUser,
  shouldSkipInitialPayment,
  markUserAsEverSubscribed
};

