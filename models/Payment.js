const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  subscription: {
    type: mongoose.Schema.ObjectId,
    ref: 'Subscription',
    required: true
  },
  stripePaymentIntentId: {
    type: String,
    required: true,
    unique: true
  },
  stripeInvoiceId: {
    type: String,
    default: null
  },
  amount: {
    type: Number,
    required: true // Amount in cents
  },
  currency: {
    type: String,
    default: 'eur'
  },
  status: {
    type: String,
    enum: [
      'requires_payment_method',
      'requires_confirmation',
      'requires_action',
      'processing',
      'requires_capture',
      'canceled',
      'succeeded'
    ],
    required: true
  },
  paymentMethod: {
    type: String,
    default: null
  },
  cardDetails: {
    brand: {
      type: String,
      default: null // visa, mastercard, etc.
    },
    last4: {
      type: String,
      default: null // last 4 digits
    },
    expMonth: {
      type: Number,
      default: null
    },
    expYear: {
      type: Number,
      default: null
    },
    funding: {
      type: String,
      default: null // credit, debit, prepaid
    },
    country: {
      type: String,
      default: null
    }
  },
  paymentType: {
    type: String,
    enum: ['initial_payment', 'recurring_payment', 'upgrade_payment'],
    required: true
  },
  description: {
    type: String,
    required: true
  },
  receiptUrl: {
    type: String,
    default: null
  },
  failureReason: {
    type: String,
    default: null
  },
  refunded: {
    type: Boolean,
    default: false
  },
  refundAmount: {
    type: Number,
    default: 0
  },
  metadata: {
    type: Object,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
paymentSchema.index({ user: 1, status: 1 });
paymentSchema.index({ subscription: 1 });
paymentSchema.index({ stripePaymentIntentId: 1 });
paymentSchema.index({ createdAt: -1 });

// Virtual for checking if payment is successful
paymentSchema.virtual('isSuccessful').get(function() {
  return this.status === 'succeeded';
});

// Virtual for checking if payment failed
paymentSchema.virtual('isFailed').get(function() {
  return ['canceled'].includes(this.status) || this.failureReason;
});

// Method to get formatted amount
paymentSchema.methods.getFormattedAmount = function() {
  return (this.amount / 100).toFixed(2);
};

module.exports = mongoose.model('Payment', paymentSchema);
