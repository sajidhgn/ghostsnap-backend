const mongoose = require('mongoose');

const subscriptionPlanSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  description: {
    type: String,
    required: true
  },
  stripePriceId: {
    type: String,
    required: false,
  },
  stripeProductId: {
    type: String,
    required: false
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
    required: false
  },
  intervalCount: {
    type: Number,
    default: 1
  },
  planType: {
    type: String,
    enum: ['initial', 'recurring'],
    required: true
  },
  trialPeriodDays: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  features: [{
    type: String
  }],
  metadata: {
    type: Object,
    default: {}
  }
}, {
  timestamps: true
});

// Index for efficient queries
subscriptionPlanSchema.index({ planType: 1, isActive: 1 });
subscriptionPlanSchema.index({ stripePriceId: 1 });

// Virtual for formatted amount
subscriptionPlanSchema.virtual('formattedAmount').get(function() {
  return (this.amount / 100).toFixed(2);
});

// Static method to get initial plan
subscriptionPlanSchema.statics.getInitialPlan = function() {
  return this.findOne({ planType: 'initial', isActive: true });
};

// Static method to get recurring plan
subscriptionPlanSchema.statics.getRecurringPlan = function() {
  return this.findOne({ planType: 'recurring', isActive: true });
};

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
