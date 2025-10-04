const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe configuration
const stripeConfig = {
  initialPlan: {
    amount: 200, // 2 EUR
    currency: 'eur',
    name: 'Initial Fee',
    description: '2€ subscription fee with 3-day trial'
  },
  recurringPlan: {
    amount: 1000, // 10 EUR
    currency: 'eur',
    interval: 'week',
    intervalCount: 1,
    name: 'Weekly Subscription',
    description: '10€ per week recurring'
  }
};

// Create products and prices
const createStripeProducts = async () => {
  try {
    // Initial product (2€ fee)
    const initialProduct = await stripe.products.create({
      name: stripeConfig.initialPlan.name,
      description: stripeConfig.initialPlan.description,
      metadata: { type: 'initial' }
    });

    const initialPrice = await stripe.prices.create({
      unit_amount: stripeConfig.initialPlan.amount,
      currency: stripeConfig.initialPlan.currency,
      product: initialProduct.id,
      metadata: { type: 'initial' }
    });

    // Recurring product (10€/week)
    const recurringProduct = await stripe.products.create({
      name: stripeConfig.recurringPlan.name,
      description: stripeConfig.recurringPlan.description,
      metadata: { type: 'recurring' }
    });

    const recurringPrice = await stripe.prices.create({
      unit_amount: stripeConfig.recurringPlan.amount,
      currency: stripeConfig.recurringPlan.currency,
      recurring: {
        interval: stripeConfig.recurringPlan.interval,
        interval_count: stripeConfig.recurringPlan.intervalCount
      },
      product: recurringProduct.id,
      metadata: { type: 'recurring' }
    });

    console.log('Stripe products created successfully:');
    console.log('Initial Price ID:', initialPrice.id);
    console.log('Recurring Price ID:', recurringPrice.id);

    return {
      initialPriceId: initialPrice.id,
      recurringPriceId: recurringPrice.id
    };
  } catch (error) {
    console.error('Error creating Stripe products:', error);
    throw error;
  }
};

// Create subscription schedule
const createSubscriptionSchedule = async (customerId, initialPriceId, recurringPriceId) => {
  try {
    const schedule = await stripe.subscriptionSchedules.create({
      customer: customerId,
      start_date: 'now',
      end_behavior: 'release',
      phases: [
        {
          items: [{ price: initialPriceId, quantity: 1 }],
          trial_period_days: 3, // free trial
        },
        {
          items: [{ price: recurringPriceId, quantity: 1 }],
          iterations: null // indefinite until canceled
        }
      ]
    });

    return schedule;
  } catch (error) {
    console.error('Error creating subscription schedule:', error);
    throw error;
  }
};

// Get or create customer
const getOrCreateCustomer = async (user) => {
  try {
    if (user.stripeCustomerId) {
      try {
        const customer = await stripe.customers.retrieve(user.stripeCustomerId);
        return customer;
      } catch (error) {
        console.log('Customer not found, creating new one');
      }
    }

    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: { userId: user._id.toString() }
    });

    user.stripeCustomerId = customer.id;
    await user.save();

    return customer;
  } catch (error) {
    console.error('Error creating/retrieving customer:', error);
    throw error;
  }
};

module.exports = {
  stripe,
  stripeConfig,
  createStripeProducts,
  createSubscriptionSchedule,
  getOrCreateCustomer
};
