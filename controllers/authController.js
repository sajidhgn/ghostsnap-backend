const User = require('../models/User');
const OTP = require('../models/OTP');
const { ErrorResponse, asyncHandler } = require('../utils/errorHandler');
const { sendTokenResponse } = require('../utils/jwt');
const { sendOTPEmail, sendWelcomeEmail } = require('../utils/email');
const crypto = require('crypto');

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
const register = asyncHandler(async (req, res, next) => {
  const { name, email, password } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return next(new ErrorResponse('User already exists with this email', 400));
  }

  // Create user
  const user = await User.create({
    name,
    email,
    password
  });

  // Generate OTP for email verification
  const otp = OTP.generateOTP();
  
  // Save OTP to database
  await OTP.create({
    email: user.email,
    otp,
    type: 'email_verification',
    ipAddress: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Send OTP email
  try {
    await sendOTPEmail(user.email, otp, 'email_verification');
  } catch (error) {
    console.error('Failed to send OTP email:', error);
    return next(new ErrorResponse('Failed to send verification email', 500));
  }

  res.status(201).json({
    success: true,
    message: 'User registered successfully. Please check your email for verification OTP.',
    data: {
      userId: user._id,
      email: user.email,
      name: user.name
    }
  });
});

// @desc    Verify email with OTP
// @route   POST /api/auth/verify-otp
// @access  Public
const verifyOTP = asyncHandler(async (req, res, next) => {
  const { email, otp, type } = req.body;

  // Validate request
  if (!email || !otp || !type) {
    return next(new ErrorResponse('Email, OTP, and type are required', 400));
  }

  // Find OTP record
  const otpRecord = await OTP.findOne({
    email,
    type,
    isUsed: false
  });

  if (!otpRecord) {
    return next(new ErrorResponse('Invalid or expired OTP', 400));
  }

  // Verify OTP
  const verificationResult = otpRecord.verifyOTP(otp);
  if (!verificationResult.success) {
    await otpRecord.save(); // save attempt count
    return next(new ErrorResponse(verificationResult.message, 400));
  }

  // Mark OTP as used
  await otpRecord.save();

  // Get user
  const user = await User.findOne({ email });
  if (!user) {
    return next(new ErrorResponse('User not found', 404));
  }

  // Handle type-specific logic
  if (type === 'email_verification') {
    user.isEmailVerified = true;
    await user.save();

    try {
      await sendWelcomeEmail(user.email, user.name);
    } catch (error) {
      console.error('Failed to send welcome email:', error);
    }

    return sendTokenResponse(user, 200, res, 'Email verified successfully');
  }

  if (type === 'login') {
    // If user email was not verified, mark it verified after login OTP
    if (!user.isEmailVerified) {
      user.isEmailVerified = true;
      await user.save();
    }

    return sendTokenResponse(user, 200, res, 'Login successful');
  }

  if (type === 'password_reset') {
    // This endpoint only verifies OTP. Actual reset is handled separately in resetPassword
    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully. You may now reset your password.',
      email: user.email
    });
  }

  return next(new ErrorResponse('Invalid OTP type', 400));
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  // Check for user
  const user = await User.findOne({ email }).select('+password');

  if (!user) {
    return next(new ErrorResponse('Invalid credentials', 401));
  }

  // Check if password matches
  const isMatch = await user.matchPassword(password);

  if (!isMatch) {
    return next(new ErrorResponse('Invalid credentials', 401));
  }

  // Check if user is active
  if (!user.isActive) {
    return next(new ErrorResponse('Account is deactivated', 401));
  }

  // Update last login
  user.lastLogin = new Date();
  await user.save();

  // If email is not verified, send OTP for login
  if (!user.isEmailVerified) {
    const otp = OTP.generateOTP();
    
    await OTP.create({
      email: user.email,
      otp,
      type: 'login',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    try {
      await sendOTPEmail(user.email, otp, 'login');
    } catch (error) {
      console.error('Failed to send OTP email:', error);
      return next(new ErrorResponse('Failed to send OTP email', 500));
    }

    return res.status(200).json({
      success: true,
      message: 'OTP sent to your email for verification',
      requiresOTP: true,
      email: user.email
    });
  }

  // Generate JWT and send response
  sendTokenResponse(user, 200, res, 'Login successful');
});

// @desc    Logout user / clear cookie
// @route   POST /api/auth/logout
// @access  Private
const logout = asyncHandler(async (req, res, next) => {
  res.cookie('token', 'none', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true
  });

  res.status(200).json({
    success: true,
    message: 'Logged out successfully'
  });
});

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
const getMe = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);

  res.status(200).json({
    success: true,
    data: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      isEmailVerified: user.isEmailVerified,
      hasEverSubscribed: user.hasEverSubscribed,
      createdAt: user.createdAt
    }
  });
});

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = asyncHandler(async (req, res, next) => {
  const { email } = req.body;

  const user = await User.findOne({ email });

  if (!user) {
    return next(new ErrorResponse('No user found with that email', 404));
  }

  // Generate OTP
  const otp = OTP.generateOTP();
  
  // Save OTP to database
  await OTP.create({
    email: user.email,
    otp,
    type: 'password_reset',
    ipAddress: req.ip,
    userAgent: req.get('User-Agent')
  });

  try {
    await sendOTPEmail(user.email, otp, 'password_reset');

    res.status(200).json({
      success: true,
      message: 'Password reset OTP sent to email'
    });
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    return next(new ErrorResponse('Email could not be sent', 500));
  }
});

// @desc    Reset password
// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = asyncHandler(async (req, res, next) => {
  const { email, otp, newPassword } = req.body;

  // Find the OTP
  const otpRecord = await OTP.findOne({
    email,
    type: 'password_reset',
    isUsed: false
  });

  if (!otpRecord) {
    return next(new ErrorResponse('Invalid or expired OTP', 400));
  }

  // Verify OTP
  const verificationResult = otpRecord.verifyOTP(otp);
  
  if (!verificationResult.success) {
    await otpRecord.save();
    return next(new ErrorResponse(verificationResult.message, 400));
  }

  // Mark OTP as used
  await otpRecord.save();

  // Get user and update password
  const user = await User.findOne({ email });
  if (!user) {
    return next(new ErrorResponse('User not found', 404));
  }

  user.password = newPassword;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  await user.save();

  res.status(200).json({
    success: true,
    message: 'Password reset successfully'
  });
});

// @desc    Resend OTP
// @route   POST /api/auth/resend-otp
// @access  Public
const resendOTP = asyncHandler(async (req, res, next) => {
  const { email, type } = req.body;

  // Check if user can request new OTP (rate limiting)
  const canRequest = await OTP.canRequestNewOTP(email, type);
  if (!canRequest) {
    return next(new ErrorResponse('Please wait before requesting a new OTP', 429));
  }

  // Verify user exists for certain types
  if (type !== 'email_verification') {
    const user = await User.findOne({ email });
    if (!user) {
      return next(new ErrorResponse('User not found', 404));
    }
  }

  // Generate new OTP
  const otp = OTP.generateOTP();
  
  // Save OTP to database
  await OTP.create({
    email,
    otp,
    type,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent')
  });

  try {
    await sendOTPEmail(email, otp, type);

    res.status(200).json({
      success: true,
      message: 'New OTP sent to your email'
    });
  } catch (error) {
    console.error('Failed to send OTP email:', error);
    return next(new ErrorResponse('Failed to send OTP email', 500));
  }
});

module.exports = {
  register,
  login,
  verifyOTP,
  logout,
  getMe,
  forgotPassword,
  resetPassword,
  resendOTP
};
