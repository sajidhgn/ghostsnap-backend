require('dotenv').config();
const mongoose = require('mongoose');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const { createStripeProducts } = require('../config/stripe');


const setupStripe = async () => {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');

    // Create Stripe products and prices
    console.log('Creating Stripe products...');
    const stripeProducts = await createStripeProducts();

    // Clear existing plans
    await SubscriptionPlan.deleteMany({});
    console.log('Cleared existing subscription plans');

    // Create initial subscription plan (2€ with 3-day trial)
    const initialPlan = await SubscriptionPlan.create({
      name: 'Initial Subscription',
      description: '2€ initial subscription with 3-day free trial',
      stripePriceId: stripeProducts.initialPriceId,
      stripeProductId: stripeProducts.initialProductId,
      amount: 200, // 2€ in cents
      currency: 'eur',
      interval: 'week', // Set interval for initial plan
      intervalCount: 1,
      planType: 'initial',
      trialPeriodDays: 3,
      isActive: true,
      features: [
        'Access to all features',
        '3-day free trial',
        'Email support'
      ]
    });

    // Create recurring subscription plan (10€ weekly)
    const recurringPlan = await SubscriptionPlan.create({
      name: 'Weekly Subscription',
      description: '10€ weekly subscription',
      stripePriceId: stripeProducts.recurringPriceId,
      stripeProductId: stripeProducts.recurringProductId,
      amount: 1000, // 10€ in cents
      currency: 'eur',
      interval: 'week',
      intervalCount: 1,
      planType: 'recurring',
      trialPeriodDays: 0,
      isActive: true,
      features: [
        'Access to all features',
        'Priority support',
        'Advanced analytics'
      ]
    });

    console.log('✅ Subscription plans created successfully:');
    console.log(`Initial Plan: ${initialPlan.name} - €${initialPlan.formattedAmount}`);
    console.log(`Recurring Plan: ${recurringPlan.name} - €${recurringPlan.formattedAmount}`);

    console.log('\n📋 Setup Summary:');
    console.log('- Stripe products and prices created');
    console.log('- Database subscription plans created');
    console.log('- Initial plan: 2€ with 3-day trial');
    console.log('- Recurring plan: 10€ weekly');

    console.log('\n🔧 Next Steps:');
    console.log('1. Update your .env file with the Stripe keys');
    console.log('2. Set up your Stripe webhook endpoint');
    console.log('3. Configure your email settings');
    console.log('4. Start the server with: npm run dev');

    process.exit(0);
  } catch (error) {
    console.error('Setup failed:', error);
    process.exit(1);
  }
};

// Run setup if called directly
if (require.main === module) {
  setupStripe();
}

module.exports = setupStripe;
