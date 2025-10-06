const User = require('../models/User');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const { stripe } = require('../config/stripe');
const { sendSubscriptionEmail } = require('../utils/email');
const { ErrorResponse, asyncHandler } = require('../utils/errorHandler');

// Helper function to create payment record
const createPaymentRecord = async (paymentData) => {
  try {
    console.log('🔍 Attempting to create payment with data:', JSON.stringify(paymentData, null, 2));
    
    // Test database connection
    console.log('🔍 Testing database connection...');
    const paymentCount = await Payment.countDocuments();
    console.log(`📊 Current payment count in database: ${paymentCount}`);
    
    const payment = await Payment.create(paymentData);
    console.log(`✅ Payment created successfully: ${payment._id}`);
    console.log('📊 Payment details:', {
      id: payment._id,
      user: payment.user,
      subscription: payment.subscription,
      amount: payment.amount,
      status: payment.status,
      paymentType: payment.paymentType
    });
    
    // Verify the payment was actually saved
    const savedPayment = await Payment.findById(payment._id);
    if (savedPayment) {
      console.log('✅ Payment verified in database:', savedPayment._id);
    } else {
      console.error('❌ Payment not found in database after creation!');
    }
    
    return payment;
  } catch (error) {
    console.error('❌ Error creating payment record:', error);
    console.error('❌ Payment data that failed:', JSON.stringify(paymentData, null, 2));
    console.error('❌ Error stack:', error.stack);
    throw error;
  }
};

// Session storage for webhook data coordination
const webhookDataStore = new Map();

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

    // Retrieve payment intent with payment method and charges expanded
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['payment_method', 'charges.data.payment_method_details.card'],
    });

    console.log('✅ Payment intent retrieved:', paymentIntent.id);
    console.log('📋 Payment method type:', paymentIntent.payment_method?.type);
    console.log('📊 Charges count:', paymentIntent.charges?.data?.length || 0);

    let cardDetails = {};
    let paymentMethodId = null;

    // Method 1: Try to get card details from payment method
    if (paymentIntent.payment_method && typeof paymentIntent.payment_method === 'object') {
      const paymentMethod = paymentIntent.payment_method;
      paymentMethodId = paymentMethod.id;

      if (paymentMethod.type === 'card' && paymentMethod.card) {
        const card = paymentMethod.card;
        cardDetails = {
          brand: card.brand || null,
          last4: card.last4 || null,
          expMonth: card.exp_month || null,
          expYear: card.exp_year || null,
          funding: card.funding || null,
          country: card.country || null
        };
        console.log('✅ Card details from payment method:', cardDetails);
      }
    }

    // Method 2: If no card details from payment method, try charges
    if (Object.keys(cardDetails).length === 0 && paymentIntent.charges?.data?.length > 0) {
      console.log('🔍 Trying to extract card details from charges...');
      const charge = paymentIntent.charges.data[0];
      
      if (charge.payment_method_details?.card) {
        const card = charge.payment_method_details.card;
        cardDetails = {
          brand: card.brand || null,
          last4: card.last4 || null,
          expMonth: card.exp_month || null,
          expYear: card.exp_year || null,
          funding: card.funding || null,
          country: card.country || null
        };
        console.log('✅ Card details from charge:', cardDetails);
      }
      
      if (!paymentMethodId && charge.payment_method) {
        paymentMethodId = charge.payment_method;
      }
    }

    // Method 3: If still no card details, try to get payment method separately
    if (Object.keys(cardDetails).length === 0 && paymentIntent.payment_method && typeof paymentIntent.payment_method === 'string') {
      console.log('🔍 Payment method is string, retrieving separately...');
      try {
        const paymentMethod = await stripe.paymentMethods.retrieve(paymentIntent.payment_method);
        paymentMethodId = paymentMethod.id;
        
        if (paymentMethod.type === 'card' && paymentMethod.card) {
          const card = paymentMethod.card;
          cardDetails = {
            brand: card.brand || null,
            last4: card.last4 || null,
            expMonth: card.exp_month || null,
            expYear: card.exp_year || null,
            funding: card.funding || null,
            country: card.country || null
          };
          console.log('✅ Card details from separate payment method retrieval:', cardDetails);
        }
      } catch (pmError) {
        console.error('❌ Error retrieving payment method separately:', pmError.message);
      }
    }

    if (Object.keys(cardDetails).length === 0) {
      console.warn('⚠️ No card details found in payment intent');
      return { cardDetails: null, paymentMethodId };
    }

    console.log('✅ Final card details extracted:', JSON.stringify(cardDetails, null, 2));
    return { cardDetails, paymentMethodId };
  } catch (error) {
    console.error('❌ Error extracting card details from payment intent:', error.message);
    console.error('❌ Error stack:', error.stack);
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

      case 'setup_intent.succeeded':
        await handleSetupIntentSucceeded(event.data.object);
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

  console.log(`✅ Checkout completed for user ${user.email}, planType: ${planType}`);
};

// Handle subscription created
const handleSubscriptionCreated = async (stripeSubscription) => {
  console.log('✅ Processing customer.subscription.created:', stripeSubscription.id);

  const userId = stripeSubscription.metadata.userId;
  const planType = stripeSubscription.metadata.planType;
  const isFirstSubscription = stripeSubscription.metadata.isFirstSubscription === 'true';
  const isReturningUser = stripeSubscription.metadata.isReturningUser === 'true';

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
  console.log('🔄 Is returning user:', isReturningUser);
  console.log('🔄 Is first subscription:', isFirstSubscription);

  try {
    const fullStripeSub = await ensureStripeSubscription(stripeSubscription);
    const currentPeriodStart = toDateFromUnix(fullStripeSub.current_period_start) || new Date();
    const currentPeriodEnd = toDateFromUnix(fullStripeSub.current_period_end) || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const trialStart = toDateFromUnix(fullStripeSub.trial_start);
    const trialEnd = toDateFromUnix(fullStripeSub.trial_end);

    // For returning users, don't set trial periods
    const finalTrialStart = isReturningUser ? null : trialStart;
    const finalTrialEnd = isReturningUser ? null : trialEnd;

    const subscription = await Subscription.create({
      user: user._id,
      stripeSubscriptionId: stripeSubscription.id,
      stripeCustomerId: stripeSubscription.customer,
      stripePriceId: plan.stripePriceId,
      status: stripeSubscription.status,
      currentPeriodStart: currentPeriodStart,
      currentPeriodEnd: currentPeriodEnd,
      trialStart: finalTrialStart,
      trialEnd: finalTrialEnd,
      isFirstSubscription,
      subscriptionType: planType,
      amount: plan.amount,
      currency: plan.currency,
      interval: plan.interval || undefined, // Allow undefined for one-time payments
      intervalCount: plan.intervalCount,
      metadata: stripeSubscription.metadata
    });

    // Mark user as having ever subscribed if they're a returning user
    if (isReturningUser && !user.hasEverSubscribed) {
      user.hasEverSubscribed = true;
      await user.save();
      console.log(`✅ Marked returning user ${user.email} as having ever subscribed`);
    }

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

  console.log(`✅ Subscription updated: ${subscription._id}, status: ${subscription.status}`);
};

// Handle subscription deleted
const handleSubscriptionDeleted = async (stripeSubscription) => {
  console.log('✅ Processing customer.subscription.deleted:', stripeSubscription.id);

  const subscription = await Subscription.findOne({
    stripeSubscriptionId: stripeSubscription.id
  }).populate('user');

  if (!subscription) {
    console.error('❌ Subscription not found:', stripeSubscription.id);
    return;
  }

  subscription.status = 'canceled';
  subscription.canceledAt = new Date();
  await subscription.save();

  // Mark user as having ever subscribed (for returning user logic)
  if (subscription.user && !subscription.user.hasEverSubscribed) {
    subscription.user.hasEverSubscribed = true;
    await subscription.user.save();
    console.log(`✅ Marked user ${subscription.user.email} as having ever subscribed`);
  }

  console.log(`✅ Subscription canceled: ${subscription._id}`);
};

/**
 * Handle invoice.payment_succeeded
 * Creates payment record and stores data for payment_intent.succeeded to complete
 */
const handleInvoicePaymentSucceeded = async (invoice) => {
  console.log('⚡ Processing invoice.payment_succeeded:', invoice.id);

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
    return;
  }

  // Try to extract card details immediately from the payment intent
  console.log('🔍 Attempting to extract card details from payment intent:', paymentIntentId);
  const { cardDetails: immediateCardDetails } = await extractCardDetailsFromPaymentIntent(paymentIntentId);
  
  if (immediateCardDetails && Object.keys(immediateCardDetails).length > 0) {
    console.log('✅ Card details extracted immediately:', immediateCardDetails);
  } else {
    console.log('⚠️ No card details found immediately, will be updated by payment_intent.succeeded');
  }

  // Store data for payment_intent.succeeded to use
  webhookDataStore.set(paymentIntentId, {
    userId: subscription.user._id,
    subscriptionId: subscription._id,
    stripeSubscriptionId: subscription.stripeSubscriptionId,
    invoiceId: invoice.id,
    paymentType: paymentType,
    amount: invoice.amount_paid || 0,
    currency: invoice.currency || 'eur'
  });

  console.log(`📦 Stored invoice data for payment intent: ${paymentIntentId}`);

  // Check if payment already exists
  const existingPayment = await Payment.findOne({
    stripePaymentIntentId: paymentIntentId
  });

  if (existingPayment) {
    console.log('ℹ️ Payment record already exists:', existingPayment._id);
    if (!existingPayment.stripeInvoiceId) {
      existingPayment.stripeInvoiceId = invoice.id;
      await existingPayment.save();
      console.log('✅ Updated existing payment with invoice ID');
    }
    return;
  }

  // Create payment record with card details if available
  try {
    const paymentData = {
      user: subscription.user._id,
      subscription: subscription._id,
      stripePaymentIntentId: paymentIntentId,
      stripeInvoiceId: invoice.id,
      amount: invoice.amount_paid || 0,
      currency: invoice.currency || 'eur',
      status: immediateCardDetails && Object.keys(immediateCardDetails).length > 0 ? 'succeeded' : 'processing',
      paymentMethod: null,
      cardDetails: immediateCardDetails || null,
      paymentType: paymentType,
      description: `Payment for ${subscription.subscriptionType} subscription`,
      receiptUrl: invoice.hosted_invoice_url || null,
      failureReason: null,
      refunded: false,
      refundAmount: 0,
      metadata: invoice.metadata || {}
    };

    const payment = await createPaymentRecord(paymentData);

    if (immediateCardDetails && Object.keys(immediateCardDetails).length > 0) {
      console.log(`✅ Payment created with card details: ${payment._id}`);
      console.log(`💳 Card: ${immediateCardDetails.brand} ****${immediateCardDetails.last4}`);
    } else {
      console.log(`✅ Payment created: ${payment._id} (awaiting card details from payment_intent.succeeded)`);
    }
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
 */
const handlePaymentIntentSucceeded = async (paymentIntent) => {
  console.log('💳 Processing payment_intent.succeeded:', paymentIntent.id);
  console.log('💰 Amount:', paymentIntent.amount, paymentIntent.currency);
  console.log('📋 Status:', paymentIntent.status);

  try {
    // Extract card details from payment intent using the reliable method
    console.log('🔍 Extracting card details from payment intent:', paymentIntent.id);
    const { cardDetails, paymentMethodId } = await extractCardDetailsFromPaymentIntent(paymentIntent.id);
    
    console.log('💳 Card details result:', cardDetails);
    console.log('🔑 Payment method ID:', paymentMethodId);

    // Find existing payment record by payment intent ID
    let payment = await Payment.findOne({
      stripePaymentIntentId: paymentIntent.id
    });

    if (payment) {
      console.log('🔄 Updating existing payment record:', payment._id);
      
      let updated = false;

      // Update card details if available and not already set
      if (Object.keys(cardDetails).length > 0 && Object.keys(payment.cardDetails || {}).length === 0) {
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

      // Update status to succeeded
      if (payment.status !== 'succeeded') {
        payment.status = 'succeeded';
        updated = true;
        console.log('✅ Payment status updated to succeeded');
      }

      // Update receipt URL if available
      if (paymentIntent.charges?.data?.[0]?.receipt_url && !payment.receiptUrl) {
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

      // Update invoice ID if available
      if (paymentIntent.invoice && !payment.stripeInvoiceId) {
        payment.stripeInvoiceId = paymentIntent.invoice;
        updated = true;
        console.log('✅ Invoice ID added to payment');
      }

      if (updated) {
        await payment.save();
        console.log(`✅ Payment ${payment._id} updated successfully`);
        
        if (Object.keys(cardDetails).length > 0) {
          console.log(`💳 ${cardDetails.brand} ****${cardDetails.last4} (${cardDetails.expMonth}/${cardDetails.expYear})`);
        }
      } else {
        console.log('ℹ️ Payment already has all data, no update needed');
      }
    } else {
      console.log('⚠️ No existing payment record found for payment intent:', paymentIntent.id);
      
      // Try to find by invoice
      if (paymentIntent.invoice) {
        payment = await Payment.findOne({
          stripeInvoiceId: paymentIntent.invoice
        });
        
        if (payment) {
          console.log('🔄 Found payment by invoice, updating with payment intent ID');
          payment.stripePaymentIntentId = paymentIntent.id;
          payment.status = 'succeeded';
          payment.cardDetails = cardDetails;
          if (paymentMethodId) payment.paymentMethod = paymentMethodId;
          await payment.save();
          console.log('✅ Payment updated with payment intent details');
          return;
        }
      }
      
      // Try to find by customer
      if (paymentIntent.customer) {
        const subscription = await Subscription.findOne({
          stripeCustomerId: paymentIntent.customer
        }).populate('user');
        
        if (subscription) {
          console.log('🔄 Found subscription for customer, looking for processing payment');
          
          // Look for processing payment
          payment = await Payment.findOne({
            subscription: subscription._id,
            status: 'processing'
          });
          
          if (payment) {
            console.log('🔄 Updating processing payment with payment intent details');
            payment.stripePaymentIntentId = paymentIntent.id;
            payment.status = 'succeeded';
            payment.cardDetails = cardDetails;
            if (paymentMethodId) payment.paymentMethod = paymentMethodId;
            if (paymentIntent.invoice) payment.stripeInvoiceId = paymentIntent.invoice;
            await payment.save();
            console.log('✅ Processing payment updated with payment intent details');
            return;
          }
          
          // Create new payment if none found
          console.log('🆕 Creating new payment record for payment intent');
          await createPaymentRecord({
            user: subscription.user._id,
            subscription: subscription._id,
            stripePaymentIntentId: paymentIntent.id,
            stripeInvoiceId: paymentIntent.invoice || null,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency || 'eur',
            status: 'succeeded',
            paymentType: subscription.subscriptionType === 'initial' ? 'initial_payment' : 'recurring_payment',
            description: `Payment for ${subscription.subscriptionType} subscription`,
            cardDetails: cardDetails,
            paymentMethod: paymentMethodId
          });
          console.log('✅ New payment record created for payment intent');
        }
      }
    }
  } catch (error) {
    console.error('❌ Error processing payment_intent.succeeded:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
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
    const paymentData = {
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
    };

    const payment = await createPaymentRecord(paymentData);
    console.log(`⚠️ Failed payment recorded: ${payment._id}`);
  } catch (error) {
    if (error.code === 11000) {
      console.log('ℹ️ Failed payment already exists (duplicate key)');
    } else {
      console.error('❌ Error creating failed payment record:', error);
    }
  }
};

/**
 * Handle setup_intent.succeeded
 * Captures card details stored during checkout for trials/initial plans
 * and updates/creates a Payment record if needed
 */
const handleSetupIntentSucceeded = async (setupIntent) => {
  console.log('🧰 Processing setup_intent.succeeded:', setupIntent.id);

  try {
    // Expand payment method to get card details
    const expanded = await stripe.setupIntents.retrieve(setupIntent.id, {
      expand: ['payment_method']
    });

    const paymentMethod = expanded.payment_method;
    let cardDetails = null;
    if (paymentMethod && typeof paymentMethod === 'object' && paymentMethod.type === 'card' && paymentMethod.card) {
      const card = paymentMethod.card;
      cardDetails = {
        brand: card.brand || null,
        last4: card.last4 || null,
        expMonth: card.exp_month || null,
        expYear: card.exp_year || null,
        funding: card.funding || null,
        country: card.country || null
      };
      console.log('✅ Card details from setup intent payment method:', cardDetails);
    }

    // Try to identify the subscription/customer context
    let subscription = null;
    if (setupIntent.customer) {
      subscription = await Subscription.findOne({
        stripeCustomerId: setupIntent.customer
      }).populate('user');
    }

    if (!subscription) {
      console.log('ℹ️ No subscription found for setup intent; skipping payment update');
      return;
    }

    // Find a recent processing payment for this subscription (created by invoice handler)
    const recentProcessingPayment = await Payment.findOne({
      subscription: subscription._id,
      status: 'processing'
    }).sort({ createdAt: -1 });

    if (recentProcessingPayment) {
      console.log('🔄 Updating processing payment with setup intent card details');
      if (cardDetails) recentProcessingPayment.cardDetails = cardDetails;
      if (paymentMethod?.id && !recentProcessingPayment.paymentMethod) {
        recentProcessingPayment.paymentMethod = paymentMethod.id;
      }
      await recentProcessingPayment.save();
      console.log('✅ Processing payment updated with setup intent details');
      return;
    }

    // If no processing payment exists and we have card details, we don't create a new payment here
    // because amount/timing belongs to invoice/payment_intent events. Just log the card association.
    console.log('ℹ️ No processing payment to update for setup intent');
  } catch (error) {
    console.error('❌ Error processing setup_intent.succeeded:', error);
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
  handleSetupIntentSucceeded,
  upgradeToRecurringSubscription,
  extractCardDetailsFromPaymentIntent,
  getInvoicePaymentIntentId
};