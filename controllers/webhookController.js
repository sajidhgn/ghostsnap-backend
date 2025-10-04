const User = require('../models/User');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const { stripe } = require('../config/stripe');
const { sendSubscriptionEmail } = require('../utils/email');
const { ErrorResponse, asyncHandler } = require('../utils/errorHandler');

let obj = {};

// Helpers to safely handle Stripe UNIX timestamps (in seconds)
const toDateFromUnix = (value) => {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  const d = new Date(num * 1000);
  return isNaN(d.getTime()) ? null : d;
};

// Ensure we have full subscription object with current_period_* populated
const ensureStripeSubscription = async (maybeSubscription) => {
  if (maybeSubscription && toDateFromUnix(maybeSubscription.current_period_start) && toDateFromUnix(maybeSubscription.current_period_end)) {
    return maybeSubscription;
  }
  try {
    return await stripe.subscriptions.retrieve(maybeSubscription.id);
  } catch (e) {
    console.error('Failed to retrieve subscription from Stripe:', e);
    return maybeSubscription;
  }
};

/**
 * Extract complete card details and payment method from payment intent
 * This is the most reliable way to get card information
 */
async function extractCardDetailsFromPaymentIntent(paymentIntentId) {
  try {

    console.log('💳 Extracting card details from payment intent:', paymentIntentId);

    // Retrieve payment intent with payment method expanded
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['payment_method'],
    });

    console.log('✅ Payment intent retrieved:', paymentIntent.id);
    console.log('📋 Payment method type:', paymentIntent.payment_method?.type);

   

    if (!paymentIntent.payment_method) {
      console.warn('⚠️ No payment method attached to payment intent');
      return { cardDetails: null, paymentMethodId: null };
    }

    const paymentMethod = paymentIntent.payment_method;
    const paymentMethodId = typeof paymentMethod === 'string' ? paymentMethod : paymentMethod.id;

    // Check if it's a card payment
    if (paymentMethod.type !== 'card' || !paymentMethod.card) {
      console.warn('⚠️ Payment method is not a card:', paymentMethod.type);
      return { cardDetails: null, paymentMethodId };
    }

    console.warn('⚠️ Payment method');
    console.log(paymentMethod);
    console.warn('⚠️ Payment method');

    const card = paymentMethod.card;
    const cardDetails = {
      brand: card.brand || null,
      last4: card.last4 || null,
      expMonth: card.exp_month || null,
      expYear: card.exp_year || null,
      funding: card.funding || null,
      country: card.country || null
    };

    Object.assign(obj, { 
    paymentIntentId: paymentIntent.id, 
    paymentType: paymentIntent.payment_method?.type, 
    paymentMethod: paymentIntent.payment_method,
    brand: card.brand,
    last4: card.last4,
    expMonth: card.exp_month,
    expYear: card.exp_year,
    funding: card.funding,
    country: card.country
  });

    console.log('✅ Card details extracted:', JSON.stringify(cardDetails, null, 2));
    return { cardDetails, paymentMethodId };
  } catch (error) {
    console.error('❌ Error extracting card details from payment intent:', error.message);
    return { cardDetails: null, paymentMethodId: null };
  }
}

/**
 * Get invoice payment context (payment intent ID)
 * Simplified to just get the payment intent ID
 */
async function getInvoicePaymentIntentId(invoice) {
  try {
    console.log('🔍 Getting payment intent from invoice:', invoice.id);

    let paymentIntentId = invoice.payment_intent;

    // If not directly available, try to get from charge
    if (!paymentIntentId && invoice.charge) {
      try {
        const charge = await stripe.charges.retrieve(invoice.charge);
        paymentIntentId = charge.payment_intent;
        console.log('💡 Payment intent found from charge:', paymentIntentId);
      } catch (chargeError) {
        console.error('⚠️ Error retrieving charge:', chargeError.message);
      }
    }

    if (paymentIntentId) {
      console.log('✅ Payment intent ID resolved:', paymentIntentId);
    } else {
      console.warn('⚠️ No payment intent ID found for invoice:', invoice.id);
    }

    return paymentIntentId;
  } catch (err) {
    console.error('❌ Error getting payment intent from invoice:', err.message);
    return null;
  }
}

// @desc    Handle Stripe webhooks
// @route   POST /api/webhooks/stripe
// @access  Public (but verified by Stripe signature)
const handleStripeWebhook = asyncHandler(async (req, res, next) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('🎯 Received Stripe webhook:', event.type);

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object);
        break;

      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;

      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object);
        break;

      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object);
        break;

      case 'customer.subscription.trial_will_end':
        await handleTrialWillEnd(event.data.object);
        break;

      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Handle checkout session completed
const handleCheckoutSessionCompleted = async (session) => {
  console.log('✅ Processing checkout.session.completed:', session.id);

  const userId = session.metadata.userId;
  const planType = session.metadata.planType;
  const isFirstSubscription = session.metadata.isFirstSubscription === 'true';

 

  if (!userId) {
    console.error('❌ No userId in session metadata');
    return;
  }

  const user = await User.findById(userId);
  if (!user) {
    console.error('❌ User not found:', userId);
    return;
  }

  if (isFirstSubscription) {
    user.hasEverSubscribed = true;
    await user.save();
  }

   Object.assign(obj, {
    sessionId: session.id,
    userId: session.metadata.userId,
    planType: session.metadata.planType,
    userEmail: user.email
  });

  console.log(`✅ Checkout completed for user ${user.email}, planType: ${planType}`);
};

// Handle subscription created
const handleSubscriptionCreated = async (stripeSubscription) => {
  console.log('✅ Processing customer.subscription.created:', stripeSubscription.id);

 

  const userId = stripeSubscription.metadata.userId;
  const planType = stripeSubscription.metadata.planType;
  const isFirstSubscription = stripeSubscription.metadata.isFirstSubscription === 'true';

   Object.assign(obj, {
    stripeSubscriptionId: stripeSubscription.id
  });

  if (!userId) {
    console.error('❌ No userId in subscription metadata');
    return;
  }

  const user = await User.findById(userId);
  if (!user) {
    console.error('❌ User not found:', userId);
    return;
  }

  const priceId = stripeSubscription.items.data[0].price.id;
  console.log('🔍 Looking for plan with price ID:', priceId);
  
  const plan = await SubscriptionPlan.findOne({ 
    stripePriceId: priceId 
  });

  if (!plan) {
    console.error('❌ Plan not found for price:', priceId);
    return;
  }

  console.log('✅ Found plan:', plan.name, 'Type:', plan.planType);

  try {
    const fullStripeSub = await ensureStripeSubscription(stripeSubscription);
    const currentPeriodStart = toDateFromUnix(fullStripeSub.current_period_start) || new Date();
    const currentPeriodEnd = toDateFromUnix(fullStripeSub.current_period_end) || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const trialStart = toDateFromUnix(fullStripeSub.trial_start);
    const trialEnd = toDateFromUnix(fullStripeSub.trial_end);

    const subscription = await Subscription.create({
      user: user._id,
      stripeSubscriptionId: stripeSubscription.id,
      stripeCustomerId: stripeSubscription.customer,
      stripePriceId: plan.stripePriceId,
      status: stripeSubscription.status,
      currentPeriodStart: currentPeriodStart,
      currentPeriodEnd: currentPeriodEnd,
      trialStart: trialStart,
      trialEnd: trialEnd,
      isFirstSubscription,
      subscriptionType: planType,
      amount: plan.amount,
      currency: plan.currency,
      interval: plan.interval || 'week', // Default to 'week' if not set
      intervalCount: plan.intervalCount || 1,
      metadata: stripeSubscription.metadata
    });

    console.log(`✅ Subscription created: ${subscription._id} for user ${user.email}`);
  } catch (error) {
    console.error('❌ Error creating subscription:', error);
    throw error;
  }

  try {
    await sendSubscriptionEmail(
      user.email, 
      user.name, 
      planType === 'initial' ? 'Initial Subscription' : 'Weekly Subscription',
      plan.amount
    );
  } catch (error) {
    console.error('⚠️ Failed to send subscription email:', error);
  }
};

// Handle subscription updated
const handleSubscriptionUpdated = async (stripeSubscription) => {
  console.log('✅ Processing customer.subscription.updated:', stripeSubscription.id);

  const subscription = await Subscription.findOne({
    stripeSubscriptionId: stripeSubscription.id
  });

  if (!subscription) {
    console.error('❌ Subscription not found:', stripeSubscription.id);
    return;
  }

  const currentPriceId = stripeSubscription.items.data[0].price.id;
  const recurringPlan = await SubscriptionPlan.getRecurringPlan();
  
  if (subscription.subscriptionType === 'initial' && 
      currentPriceId === recurringPlan.stripePriceId &&
      stripeSubscription.status === 'active') {
    console.log('🔄 Subscription upgraded from initial to recurring plan');
    
    subscription.subscriptionType = 'recurring';
    subscription.stripePriceId = recurringPlan.stripePriceId;
    subscription.amount = recurringPlan.amount;
    subscription.isFirstSubscription = false;
  }

  const fullStripeSub = await ensureStripeSubscription(stripeSubscription);
  const updCurrentPeriodStart = toDateFromUnix(fullStripeSub.current_period_start) || subscription.currentPeriodStart || new Date();
  const updCurrentPeriodEnd = toDateFromUnix(fullStripeSub.current_period_end) || subscription.currentPeriodEnd || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  subscription.status = fullStripeSub.status || subscription.status;
  subscription.currentPeriodStart = updCurrentPeriodStart;
  subscription.currentPeriodEnd = updCurrentPeriodEnd;
  subscription.cancelAtPeriodEnd = stripeSubscription.cancel_at_period_end;
  
  if (fullStripeSub.canceled_at) {
    const canceledAtDate = toDateFromUnix(fullStripeSub.canceled_at);
    if (canceledAtDate) subscription.canceledAt = canceledAtDate;
  }

  await subscription.save();

  Object.assign(obj, {
    subscriptionStatus: subscription.status
  });

  console.log(`✅ Subscription updated: ${subscription._id}, status: ${subscription.status}`);
};

// Handle subscription deleted
const handleSubscriptionDeleted = async (stripeSubscription) => {
  console.log('✅ Processing customer.subscription.deleted:', stripeSubscription.id);

  const subscription = await Subscription.findOne({
    stripeSubscriptionId: stripeSubscription.id
  });

  if (!subscription) {
    console.error('❌ Subscription not found:', stripeSubscription.id);
    return;
  }

  subscription.status = 'canceled';
  subscription.canceledAt = new Date();
  await subscription.save();

  console.log(`✅ Subscription canceled: ${subscription._id}`);
};

/**
 * Handle invoice.payment_succeeded
 * Creates payment record WITHOUT card details initially
 * Card details will be added by payment_intent.succeeded event
 */
const handleInvoicePaymentSucceeded = async (invoice) => {
  console.log('⚡ Processing invoice.payment_succeeded:', invoice.id);

   Object.assign(obj, {
    InvoiceId: invoice.id
  });

  console.log("----------------------");
  console.log(obj);
  console.log("----------------------");

  if (!invoice.subscription) {
    console.log('ℹ️ Invoice is not for a subscription');
    return;
  }

  const subscription = await Subscription.findOne({
    stripeSubscriptionId: invoice.subscription,
  }).populate('user');

  if (!subscription) {
    console.error('❌ Subscription not found for invoice:', invoice.subscription);
    return;
  }

  // Determine payment type
  let paymentType = 'recurring_payment';
  if (invoice.billing_reason === 'subscription_create') {
    paymentType = subscription.subscriptionType === 'initial'
      ? 'initial_payment'
      : 'recurring_payment';
  } else if (invoice.billing_reason === 'subscription_update') {
    paymentType = 'upgrade_payment';
  }

  // Get payment intent ID
  const paymentIntentId = await getInvoicePaymentIntentId(invoice);

  if (!paymentIntentId) {
    console.warn('⚠️ No payment_intent found for invoice:', invoice.id);
    // Use invoice ID as fallback
    const fallbackId = `invoice_${obj.InvoiceId}`;
    
    try {
      // Check if payment already exists with this fallback ID
      const existingPayment = await Payment.findOne({
        stripePaymentIntentId: fallbackId
      });

      if (existingPayment) {
        console.log('ℹ️ Payment already exists with fallback ID');
        return;
      }

      // Create payment with fallback ID
      const payment = await Payment.create({
        user: subscription.user._id,
        subscription: subscription._id,
        stripePaymentIntentId: fallbackId,
        stripeInvoiceId: invoice.id,
        amount: invoice.amount_paid || invoice.amount_due || 0,
        currency: invoice.currency || 'eur',
        status: 'succeeded',
        paymentMethod: null,
        cardDetails: null,
        paymentType: paymentType,
        description: `Payment for ${subscription.subscriptionType} subscription`,
        receiptUrl: null,
        failureReason: null,
        refunded: false,
        refundAmount: 0,
        metadata: invoice.metadata || {}
      });

      console.log(`✅ Payment created with fallback ID: ${payment._id}`);
    } catch (error) {
      console.error('❌ Error creating payment with fallback ID:', error);
    }
    return;
  }

  // Check if payment already exists
  const existingPayment = await Payment.findOne({
    stripePaymentIntentId: paymentIntentId
  });

  if (existingPayment) {
    console.log('ℹ️ Payment record already exists:', existingPayment._id);
    // Update invoice ID if not set
    if (!existingPayment.stripeInvoiceId) {
      existingPayment.stripeInvoiceId = invoice.id;
      await existingPayment.save();
      console.log('✅ Updated existing payment with invoice ID');
    }
    return;
  }

  // Create payment record (card details will be added by payment_intent.succeeded)
  try {
    const payment = await Payment.create({
      user: subscription.user._id,
      subscription: subscription._id,
      stripePaymentIntentId: paymentIntentId,
      stripeInvoiceId: invoice.id,
      amount: invoice.amount_paid || invoice.amount_due || 0,
      currency: invoice.currency || 'eur',
      status: 'succeeded',
      paymentMethod: null,
      cardDetails: null, // Will be added by payment_intent.succeeded
      paymentType: paymentType,
      description: `Payment for ${subscription.subscriptionType} subscription`,
      receiptUrl: null,
      failureReason: null,
      refunded: false,
      refundAmount: 0,
      metadata: invoice.metadata || {}
    });

    console.log(`✅ Payment created: ${payment._id} (card details will be added by payment_intent.succeeded)`);
  } catch (error) {
    if (error.code === 11000) {
      console.log('ℹ️ Payment already exists (duplicate key), skipping creation');
    } else {
      console.error('❌ Error creating payment record:', error);
      throw error;
    }
  }

  // Handle trial-to-recurring upgrade
  if (subscription.shouldUpgradeToRecurring && subscription.shouldUpgradeToRecurring()) {
    console.log('🔄 Trial period ended, upgrading to recurring subscription');
    await upgradeToRecurringSubscription(subscription);
  }
};

/**
 * Handle payment_intent.succeeded
 * This event fires when payment is successful and contains card details
 * Updates the existing payment record with card information
 * 
 * CRITICAL: This is the PRIMARY source for complete payment data including card details
 */
const handlePaymentIntentSucceeded = async (paymentIntent) => {
  console.log('💳 Processing payment_intent.succeeded:', paymentIntent.id);
  console.log('💰 Amount:', paymentIntent.amount, paymentIntent.currency);
  console.log('📋 Status:', paymentIntent.status);

  // Extract card details and payment method from payment intent
  const { cardDetails, paymentMethodId } = await extractCardDetailsFromPaymentIntent(paymentIntent.id);

  // Find the payment record by payment intent ID
  let payment = await Payment.findOne({
    stripePaymentIntentId: paymentIntent.id
  });

   Object.assign(obj, {
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    status: paymentIntent.status
  });


  console.log("paymentIntent");
  console.log(paymentIntent);
  console.log(cardDetails);
  console.log("paymentIntent");

  if (!payment) {
    console.warn('⚠️ No payment record found for payment intent:', paymentIntent.id);
    console.log('🔍 This might be a standalone payment or timing issue');
    
    // Try to find subscription from payment intent metadata or invoice
    let subscription = null;
    
    // Method 1: Check if there's an invoice
    if (paymentIntent.invoice) {
      try {
        const invoice = await stripe.invoices.retrieve(paymentIntent.invoice);
        if (invoice.subscription) {
          subscription = await Subscription.findOne({
            stripeSubscriptionId: invoice.subscription
          }).populate('user');
          console.log('✅ Found subscription from invoice:', subscription?._id);
        }
      } catch (err) {
        console.error('⚠️ Error retrieving invoice:', err.message);
      }
    }

    // Method 2: Check metadata
    if (!subscription && paymentIntent.metadata && paymentIntent.metadata.subscriptionId) {
      subscription = await Subscription.findById(paymentIntent.metadata.subscriptionId).populate('user');
      console.log('✅ Found subscription from metadata:', subscription?._id);
    }

    // If we still don't have a subscription, we can't create a payment record
    if (!subscription) {
      console.error('❌ Cannot create payment record: no subscription found');
      return;
    }

    // Determine payment type
    let paymentType = 'recurring_payment';
    if (paymentIntent.metadata && paymentIntent.metadata.paymentType) {
      paymentType = paymentIntent.metadata.paymentType;
    } else if (subscription.subscriptionType === 'initial') {
      paymentType = 'initial_payment';
    }

    // Create new payment record with all data
    try {
      const payment = await Payment.create({
        user: subscription.user._id,
        subscription: subscription._id,
        stripePaymentIntentId: paymentIntent.id,
        stripeInvoiceId: paymentIntent.invoice || null,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        status: paymentIntent.status,
        paymentMethod: paymentMethodId,
        cardDetails: cardDetails,
        paymentType: paymentType,
        description: `Payment for ${subscription.subscriptionType} subscription`,
        receiptUrl: paymentIntent.charges?.data[0]?.receipt_url || null,
        failureReason: null,
        refunded: false,
        refundAmount: 0,
        metadata: paymentIntent.metadata || {}
      });

      console.log(`✅ New payment record created with complete data: ${payment._id}`);
      if (cardDetails) {
        console.log(`💳 ${cardDetails.brand} ****${cardDetails.last4} (${cardDetails.expMonth}/${cardDetails.expYear})`);
      }
    } catch (error) {
      if (error.code === 11000) {
        console.log('ℹ️ Payment already exists (duplicate key)');
        // Try to find and update it
        payment = await Payment.findOne({
          stripePaymentIntentId: paymentIntent.id
        });
      } else {
        console.error('❌ Error creating payment record:', error);
        throw error;
      }
    }
  }

  // Update existing payment with card details and other info
  if (payment) {
    try {
      let updated = false;

      // Update card details if available and not already set
      if (cardDetails && !payment.cardDetails) {
        payment.cardDetails = cardDetails;
        updated = true;
        console.log('✅ Card details added to payment');
      }

      // Update payment method if available and not already set
      if (paymentMethodId && !payment.paymentMethod) {
        payment.paymentMethod = paymentMethodId;
        updated = true;
        console.log('✅ Payment method added to payment');
      }

      // Update status if needed
      if (paymentIntent.status && payment.status !== paymentIntent.status) {
        payment.status = paymentIntent.status;
        updated = true;
        console.log('✅ Payment status updated to:', paymentIntent.status);
      }

      // Update receipt URL if available and not already set
      if (paymentIntent.charges?.data[0]?.receipt_url && !payment.receiptUrl) {
        payment.receiptUrl = paymentIntent.charges.data[0].receipt_url;
        updated = true;
        console.log('✅ Receipt URL added to payment');
      }

      // Update amount if it was zero or not set
      if (paymentIntent.amount && (!payment.amount || payment.amount === 0)) {
        payment.amount = paymentIntent.amount;
        updated = true;
        console.log('✅ Payment amount updated to:', paymentIntent.amount);
      }

      if (updated) {
        await payment.save();
        console.log(`✅ Payment ${payment._id} updated successfully`);
        
        if (cardDetails) {
          console.log(`💳 ${cardDetails.brand} ****${cardDetails.last4} (${cardDetails.expMonth}/${cardDetails.expYear})`);
        }
      } else {
        console.log('ℹ️ Payment already has all data, no update needed');
      }
    } catch (error) {
      console.error('❌ Error updating payment with card details:', error);
    }
  }
};

// Handle failed payment
const handleInvoicePaymentFailed = async (invoice) => {
  console.log('⚠️ Processing invoice.payment_failed:', invoice.id);

  if (!invoice.subscription) {
    console.log('ℹ️ Invoice is not for a subscription');
    return;
  }

  const subscription = await Subscription.findOne({
    stripeSubscriptionId: invoice.subscription
  }).populate('user');

  if (!subscription) {
    console.error('❌ Subscription not found for invoice:', invoice.subscription);
    return;
  }

  const paymentIntentId = await getInvoicePaymentIntentId(invoice);
  const finalPaymentIntentId = paymentIntentId || invoice.payment_intent || `failed_${invoice.id}`;

  // Check if payment record already exists
  const existingPayment = await Payment.findOne({
    stripePaymentIntentId: finalPaymentIntentId
  });

  if (existingPayment) {
    console.log('ℹ️ Failed payment record already exists:', existingPayment._id);
    // Update status if needed
    if (existingPayment.status !== 'canceled') {
      existingPayment.status = 'canceled';
      existingPayment.failureReason = invoice.last_finalization_error?.message || 'Payment failed';
      await existingPayment.save();
      console.log('✅ Updated existing payment to failed status');
    }
    return;
  }

  // Create payment record for failed payment
  try {
    const payment = await Payment.create({
      user: subscription.user._id,
      subscription: subscription._id,
      stripePaymentIntentId: finalPaymentIntentId,
      stripeInvoiceId: invoice.id,
      amount: invoice.amount_due || 0,
      currency: invoice.currency || 'eur',
      status: 'canceled',
      paymentMethod: null,
      cardDetails: null,
      paymentType: 'recurring_payment',
      description: `Failed payment for ${subscription.subscriptionType} subscription`,
      receiptUrl: null,
      failureReason: invoice.last_finalization_error?.message || 'Payment failed',
      refunded: false,
      refundAmount: 0,
      metadata: invoice.metadata || {}
    });

    console.log(`⚠️ Failed payment recorded: ${payment._id}`);
  } catch (error) {
    if (error.code === 11000) {
      console.log('ℹ️ Failed payment already exists (duplicate key)');
    } else {
      console.error('❌ Error creating failed payment record:', error);
    }
  }
};

// Handle trial will end
const handleTrialWillEnd = async (stripeSubscription) => {
  console.log('⏰ Processing customer.subscription.trial_will_end:', stripeSubscription.id);

  const subscription = await Subscription.findOne({
    stripeSubscriptionId: stripeSubscription.id
  }).populate('user');

  if (!subscription) {
    console.error('❌ Subscription not found:', stripeSubscription.id);
    return;
  }

  console.log(`⏰ Trial ending soon for subscription: ${subscription._id}`);
  
  if (subscription.subscriptionType === 'initial' && subscription.isFirstSubscription) {
    console.log('🔄 Preparing to upgrade initial subscription to recurring after trial ends');
  }
};

// Upgrade subscription from initial to recurring
const upgradeToRecurringSubscription = async (subscription) => {
  console.log('🔄 Upgrading subscription to recurring:', subscription._id);

  try {
    const recurringPlan = await SubscriptionPlan.getRecurringPlan();
    if (!recurringPlan) {
      console.error('❌ Recurring plan not found');
      return;
    }

    const currentSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const currentItemId = currentSubscription.items.data[0].id;

    await stripe.subscriptions.update(
      subscription.stripeSubscriptionId,
      {
        items: [{
          id: currentItemId,
          price: recurringPlan.stripePriceId,
        }],
        proration_behavior: 'none',
        metadata: {
          ...subscription.metadata,
          planType: 'recurring',
          upgraded: 'true'
        }
      }
    );

    subscription.stripePriceId = recurringPlan.stripePriceId;
    subscription.subscriptionType = 'recurring';
    subscription.amount = recurringPlan.amount;
    subscription.isFirstSubscription = false;
    await subscription.save();

    console.log(`✅ Subscription upgraded to recurring: ${subscription._id}`);
  } catch (error) {
    console.error('❌ Error upgrading subscription:', error);
  }
};

module.exports = {
  handleStripeWebhook,
  handleSubscriptionCreated,
  handleInvoicePaymentSucceeded,
  handlePaymentIntentSucceeded,
  handleCheckoutSessionCompleted,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaymentFailed,
  handleTrialWillEnd,
  upgradeToRecurringSubscription,
  extractCardDetailsFromPaymentIntent,
  getInvoicePaymentIntentId
};
