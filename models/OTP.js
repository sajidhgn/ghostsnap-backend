const mongoose = require('mongoose');
const crypto = require('crypto');

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true
  },
  otp: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['email_verification', 'login', 'password_reset'],
    required: true
  },
  isUsed: {
    type: Boolean,
    default: false
  },
  attempts: {
    type: Number,
    default: 0
  },
  maxAttempts: {
    type: Number,
    default: 3
  },
  expiresAt: {
    type: Date,
    required: true,
    default: function() {
      return new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
    }
  },
  ipAddress: {
    type: String,
    default: null
  },
  userAgent: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Index for automatic deletion of expired OTPs
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index for efficient queries
otpSchema.index({ email: 1, type: 1, isUsed: 1 });
otpSchema.index({ otp: 1, type: 1 });

// Generate OTP
otpSchema.statics.generateOTP = function() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
};

// Verify OTP
otpSchema.methods.verifyOTP = function(inputOTP) {
  // Check if OTP is expired
  if (new Date() > this.expiresAt) {
    return { success: false, message: 'OTP has expired' };
  }

  // Check if OTP is already used
  if (this.isUsed) {
    return { success: false, message: 'OTP has already been used' };
  }

  // Check if max attempts exceeded
  if (this.attempts >= this.maxAttempts) {
    return { success: false, message: 'Maximum attempts exceeded' };
  }

  // Increment attempts
  this.attempts += 1;

  // Check if OTP matches
  if (this.otp !== inputOTP) {
    return { success: false, message: 'Invalid OTP' };
  }

  // Mark as used
  this.isUsed = true;
  return { success: true, message: 'OTP verified successfully' };
};

// Clean up expired and used OTPs
otpSchema.statics.cleanup = async function() {
  const now = new Date();
  await this.deleteMany({
    $or: [
      { expiresAt: { $lt: now } },
      { isUsed: true, createdAt: { $lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } // Delete used OTPs older than 24 hours
    ]
  });
};

// Method to check if user can request new OTP
otpSchema.statics.canRequestNewOTP = async function(email, type) {
  const recentOTP = await this.findOne({
    email,
    type,
    isUsed: false,
    createdAt: { $gt: new Date(Date.now() - 60 * 1000) } // Within last minute
  });

  return !recentOTP;
};

module.exports = mongoose.model('OTP', otpSchema);
