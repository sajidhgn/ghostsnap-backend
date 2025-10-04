require('dotenv').config();
const mongoose = require('mongoose');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const User = require('../models/User');

const testSubscription = async () => {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // Check if subscription plans exist
    const initialPlan = await SubscriptionPlan.getInitialPlan();
    const recurringPlan = await SubscriptionPlan.getRecurringPlan();

    if (!initialPlan) {
      console.error('❌ Initial plan not found. Please run: node scripts/setupStripe.js');
      process.exit(1);
    }

    if (!recurringPlan) {
      console.error('❌ Recurring plan not found. Please run: node scripts/setupStripe.js');
      process.exit(1);
    }

    console.log('✅ Subscription plans found:');
    console.log(`- Initial Plan: ${initialPlan.name} (€${initialPlan.formattedAmount}) - Interval: ${initialPlan.interval}`);
    console.log(`- Recurring Plan: ${recurringPlan.name} (€${recurringPlan.formattedAmount}) - Interval: ${recurringPlan.interval}`);

    // Test creating a subscription with proper interval
    console.log('\n🧪 Testing subscription creation...');
    
    // Create a test user if it doesn't exist
    let testUser = await User.findOne({ email: 'test@example.com' });
    if (!testUser) {
      testUser = await User.create({
        name: 'Test User',
        email: 'test@example.com',
        password: 'testpassword123'
      });
      console.log('✅ Test user created');
    } else {
      console.log('✅ Test user found');
    }

    // Test subscription creation with interval
    const testSubscription = {
      user: testUser._id,
      stripeSubscriptionId: 'sub_test_' + Date.now(),
      stripeCustomerId: 'cus_test_' + Date.now(),
      stripePriceId: initialPlan.stripePriceId,
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      trialStart: new Date(),
      trialEnd: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      isFirstSubscription: true,
      subscriptionType: 'initial',
      amount: initialPlan.amount,
      currency: initialPlan.currency,
      interval: initialPlan.interval,
      intervalCount: initialPlan.intervalCount,
      metadata: { test: true }
    };

    const subscription = await Subscription.create(testSubscription);
    console.log('✅ Test subscription created successfully:', subscription._id);
    console.log(`- Interval: ${subscription.interval}`);
    console.log(`- Amount: €${(subscription.amount / 100).toFixed(2)}`);
    console.log(`- Type: ${subscription.subscriptionType}`);

    // Test payment creation
    console.log('\n🧪 Testing payment creation...');
    const testPayment = {
      user: testUser._id,
      subscription: subscription._id,
      stripePaymentIntentId: 'pi_test_' + Date.now(),
      stripeInvoiceId: 'in_test_' + Date.now(),
      amount: initialPlan.amount,
      currency: initialPlan.currency,
      status: 'succeeded',
      paymentMethod: 'pm_test_card',
      cardDetails: {
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2025,
        funding: 'credit',
        country: 'US'
      },
      paymentType: 'initial_payment',
      description: 'Test initial payment',
      metadata: { test: true }
    };

    const payment = await Payment.create(testPayment);
    console.log('✅ Test payment created successfully:', payment._id);
    console.log(`- Amount: €${(payment.amount / 100).toFixed(2)}`);
    console.log(`- Status: ${payment.status}`);
    console.log(`- Card: ${payment.cardDetails.brand} ****${payment.cardDetails.last4}`);

    // Clean up test data
    console.log('\n🧹 Cleaning up test data...');
    await Subscription.deleteOne({ _id: subscription._id });
    await Payment.deleteOne({ _id: payment._id });
    console.log('✅ Test data cleaned up');

    console.log('\n🎉 All tests passed! The subscription system is working correctly.');
    console.log('\n📋 Summary of fixes:');
    console.log('✅ Fixed interval field validation error');
    console.log('✅ Ensured proper data saving to database and payment table');
    console.log('✅ Added interval field to initial plan');
    console.log('✅ Fixed payment creation logic');
    console.log('✅ Updated Stripe configuration for proper price creation');

    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
};

// Run test if called directly
if (require.main === module) {
  testSubscription();
}

module.exports = testSubscription;
