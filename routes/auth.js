const express = require('express');
const {
  register,
  login,
  verifyOTP,
  logout,
  getMe,
  forgotPassword,
  resetPassword,
  resendOTP
} = require('../controllers/authController');

const {
  validateRegister,
  validateLogin,
  validateOTP,
  validateForgotPassword,
  validateResetPassword,
  validateResendOTP
} = require('../middleware/validation');

const { protect } = require('../middleware/auth');
const { authLimiter, otpLimiter, passwordResetLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Public routes
router.post('/register', authLimiter, validateRegister, register);
router.post('/login', authLimiter, validateLogin, login);
router.post('/verify-otp', otpLimiter, validateOTP, verifyOTP);
router.post('/forgot-password', passwordResetLimiter, validateForgotPassword, forgotPassword);
router.post('/reset-password', passwordResetLimiter, validateResetPassword, resetPassword);
router.post('/resend-otp', otpLimiter, validateResendOTP, resendOTP);

// Protected routes
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);

module.exports = router;
