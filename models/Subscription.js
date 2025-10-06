const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  stripeSubscriptionId: {
    type: String,
    required: true,
    unique: true
  },
  stripeCustomerId: {
    type: String,
    required: true
  },
  stripePriceId: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: [
      'incomplete',
      'incomplete_expired',
      'trialing',
      'active',
      'past_due',
      'canceled',
      'unpaid'
    ],
    required: true
  },
  currentPeriodStart: {
    type: Date,
    required: true
  },
  currentPeriodEnd: {
    type: Date,
    required: true
  },
  trialStart: {
    type: Date,
    default: null
  },
  trialEnd: {
    type: Date,
    default: null
  },
  canceledAt: {
    type: Date,
    default: null
  },
  cancelAtPeriodEnd: {
    type: Boolean,
    default: false
  },
  isFirstSubscription: {
    type: Boolean,
    default: true
  },
  subscriptionType: {
    type: String,
    enum: ['initial', 'recurring'],
    required: true
  },
  amount: {
    type: Number,
    required: true // Amount in cents
  },
  currency: {
    type: String,
    default: 'eur'
  },
  interval: {
    type: String,
    enum: ['day', 'week', 'month', 'year'],
    required: false // Allow undefined for one-time payments
  },
  intervalCount: {
    type: Number,
    default: 1
  },
  metadata: {
    type: Object,
    default: {}
  }
}, {
  timestamps: true
});

// Index for efficient queries
subscriptionSchema.index({ user: 1, status: 1 });
subscriptionSchema.index({ stripeSubscriptionId: 1 });
subscriptionSchema.index({ stripeCustomerId: 1 });

// Virtual for checking if subscription is active
subscriptionSchema.virtual('isActive').get(function() {
  return ['active', 'trialing'].includes(this.status);
});

// Virtual for checking if in trial period
subscriptionSchema.virtual('isInTrial').get(function() {
  return this.status === 'trialing' && 
         this.trialEnd && 
         new Date() < this.trialEnd;
});

// Method to check if subscription should be upgraded to recurring
subscriptionSchema.methods.shouldUpgradeToRecurring = function() {
  return this.isFirstSubscription && 
         this.subscriptionType === 'initial' && 
         this.trialEnd && 
         new Date() >= this.trialEnd;
};

module.exports = mongoose.model('Subscription', subscriptionSchema);
