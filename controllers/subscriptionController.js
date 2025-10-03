const User = require('../models/User');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const { ErrorResponse, asyncHandler } = require('../utils/errorHandler');
const { stripe, getOrCreateCustomer } = require('../config/stripe');
const { sendSubscriptionEmail } = require('../utils/email');

// @desc    Get subscription plans
// @route   GET /api/subscriptions/plans
// @access  Public
const getSubscriptionPlans = asyncHandler(async (req, res, next) => {
  const plans = await SubscriptionPlan.find({ isActive: true }).sort({ amount: 1 });

  res.status(200).json({
    success: true,
    count: plans.length,
    data: plans
  });
});

// @desc    Create subscription checkout session
// @route   POST /api/subscriptions/create-checkout-session
// @access  Private
const createCheckoutSession = asyncHandler(async (req, res, next) => {
  const user = req.user;

  // Get or create Stripe customer
  const customer = await getOrCreateCustomer(user);

  // Check if user already has an active subscription
  const existingSubscription = await Subscription.findOne({
    user: user._id,
    status: { $in: ['active', 'trialing'] }
  });

  if (existingSubscription) {
    return next(new ErrorResponse('User already has an active subscription', 400));
  }

  // Determine which plan to use based on user's subscription history
  let plan;
  if (user.hasEverSubscribed) {
    // User has subscribed before, use recurring plan (10€ weekly)
    plan = await SubscriptionPlan.getRecurringPlan();
  } else {
    // First-time subscriber, use initial plan (2€ with 3-day trial)
    plan = await SubscriptionPlan.getInitialPlan();
  }

  if (!plan) {
    return next(new ErrorResponse('Subscription plan not found', 404));
  }

  try {
    // Configure subscription data based on plan type
    let subscriptionData = {
      metadata: {
        userId: user._id.toString(),
        planType: plan.planType,
        isFirstSubscription: (!user.hasEverSubscribed).toString()
      }
    };

    // For initial plan, set up trial period
    if (plan.planType === 'initial' && plan.trialPeriodDays > 0) {
      subscriptionData.trial_period_days = plan.trialPeriodDays;
      console.log(`Setting up ${plan.trialPeriodDays}-day trial for initial subscription`);
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      payment_method_types: ['card'],
      line_items: [
        {
          price: plan.stripePriceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: process.env.CANCEL_URL,
      metadata: {
        userId: user._id.toString(),
        planType: plan.planType,
        isFirstSubscription: (!user.hasEverSubscribed).toString()
      },
      subscription_data: subscriptionData
    });

    res.status(200).json({
      success: true,
      data: {
        sessionId: session.id,
        url: session.url,
        plan: {
          name: plan.name,
          amount: plan.formattedAmount,
          interval: plan.interval,
          trialPeriodDays: plan.trialPeriodDays
        }
      }
    });
  } catch (error) {
    console.error('Stripe checkout session creation error:', error);
    return next(new ErrorResponse('Failed to create checkout session', 500));
  }
});

// @desc    Get user's current subscription
// @route   GET /api/subscriptions/current
// @access  Private
const getCurrentSubscription = asyncHandler(async (req, res, next) => {
  const subscription = await Subscription.findOne({
    user: req.user._id,
    status: { $in: ['active', 'trialing', 'past_due'] }
  }).populate('user', 'name email');

  if (!subscription) {
    return res.status(200).json({
      success: true,
      data: null,
      message: 'No active subscription found'
    });
  }

  // Get latest payment for this subscription
  const latestPayment = await Payment.findOne({
    subscription: subscription._id
  }).sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    data: {
      subscription,
      latestPayment,
      isActive: subscription.isActive,
      isInTrial: subscription.isInTrial
    }
  });
});

// @desc    Cancel subscription
// @route   POST /api/subscriptions/cancel
// @access  Private
const cancelSubscription = asyncHandler(async (req, res, next) => {
  const subscription = await Subscription.findOne({
    user: req.user._id,
    status: { $in: ['active', 'trialing'] }
  });

  if (!subscription) {
    return next(new ErrorResponse('No active subscription found', 404));
  }

  try {
    // Cancel subscription in Stripe
    const stripeSubscription = await stripe.subscriptions.update(
      subscription.stripeSubscriptionId,
      {
        cancel_at_period_end: true
      }
    );

    // Update local subscription
    subscription.cancelAtPeriodEnd = true;
    subscription.canceledAt = new Date();
    await subscription.save();

    res.status(200).json({
      success: true,
      message: 'Subscription will be canceled at the end of the current period',
      data: {
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        currentPeriodEnd: subscription.currentPeriodEnd
      }
    });
  } catch (error) {
    console.error('Stripe subscription cancellation error:', error);
    return next(new ErrorResponse('Failed to cancel subscription', 500));
  }
});

// @desc    Reactivate subscription
// @route   POST /api/subscriptions/reactivate
// @access  Private
const reactivateSubscription = asyncHandler(async (req, res, next) => {
  const subscription = await Subscription.findOne({
    user: req.user._id,
    status: { $in: ['active', 'trialing'] },
    cancelAtPeriodEnd: true
  });

  if (!subscription) {
    return next(new ErrorResponse('No canceled subscription found', 404));
  }

  try {
    // Reactivate subscription in Stripe
    const stripeSubscription = await stripe.subscriptions.update(
      subscription.stripeSubscriptionId,
      {
        cancel_at_period_end: false
      }
    );

    // Update local subscription
    subscription.cancelAtPeriodEnd = false;
    subscription.canceledAt = null;
    await subscription.save();

    res.status(200).json({
      success: true,
      message: 'Subscription reactivated successfully',
      data: subscription
    });
  } catch (error) {
    console.error('Stripe subscription reactivation error:', error);
    return next(new ErrorResponse('Failed to reactivate subscription', 500));
  }
});

// @desc    Get subscription history
// @route   GET /api/subscriptions/history
// @access  Private
const getSubscriptionHistory = asyncHandler(async (req, res, next) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const startIndex = (page - 1) * limit;

  const subscriptions = await Subscription.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip(startIndex);

  const total = await Subscription.countDocuments({ user: req.user._id });

  res.status(200).json({
    success: true,
    count: subscriptions.length,
    total,
    page,
    pages: Math.ceil(total / limit),
    data: subscriptions
  });
});

// @desc    Get payment history
// @route   GET /api/subscriptions/payments
// @access  Private
const getPaymentHistory = asyncHandler(async (req, res, next) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const startIndex = (page - 1) * limit;

  const payments = await Payment.find({ user: req.user._id })
    .populate('subscription', 'subscriptionType status')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip(startIndex);

  const total = await Payment.countDocuments({ user: req.user._id });

  res.status(200).json({
    success: true,
    count: payments.length,
    total,
    page,
    pages: Math.ceil(total / limit),
    data: payments
  });
});

// @desc    Handle successful checkout
// @route   GET /api/subscriptions/success
// @access  Public
const handleCheckoutSuccess = asyncHandler(async (req, res, next) => {
  const { session_id } = req.query;

  if (!session_id) {
    return next(new ErrorResponse('Session ID is required', 400));
  }

  try {
    // Retrieve the checkout session
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (!session) {
      return next(new ErrorResponse('Invalid session', 400));
    }

    // Redirect to frontend success page with session info
    const redirectUrl = `${process.env.FRONTEND_URL}/success?session_id=${session_id}&status=success`;
    
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('Checkout success handling error:', error);
    const redirectUrl = `${process.env.FRONTEND_URL}/error?message=checkout_error`;
    res.redirect(redirectUrl);
  }
});

module.exports = {
  getSubscriptionPlans,
  createCheckoutSession,
  getCurrentSubscription,
  cancelSubscription,
  reactivateSubscription,
  getSubscriptionHistory,
  getPaymentHistory,
  handleCheckoutSuccess
};
