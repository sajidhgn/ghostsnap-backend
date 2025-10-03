const nodemailer = require('nodemailer');

// Create reusable transporter object using SMTP transport
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT, 10), // Ensure it's a number
    secure: false, // true for 465, false for other ports (STARTTLS is used)
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    connectionTimeout: 10000, // 10 seconds timeout
  });
};

// Send OTP email
const sendOTPEmail = async (email, otp, type) => {
  try {
    const transporter = createTransporter();

    let subject, html;

    switch (type) {
      case 'email_verification':
        subject = 'Email Verification - OTP Code';
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Email Verification</h2>
            <p>Thank you for signing up! Please use the following OTP to verify your email address:</p>
            <div style="background-color: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0;">
              <h1 style="color: #007bff; margin: 0; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
            </div>
            <p>This OTP will expire in 10 minutes.</p>
            <p>If you didn't request this verification, please ignore this email.</p>
          </div>
        `;
        break;

      case 'login':
        subject = 'Login Verification - OTP Code';
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Login Verification</h2>
            <p>Please use the following OTP to complete your login:</p>
            <div style="background-color: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0;">
              <h1 style="color: #007bff; margin: 0; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
            </div>
            <p>This OTP will expire in 10 minutes.</p>
            <p>If you didn't attempt to log in, please secure your account immediately.</p>
          </div>
        `;
        break;

      case 'password_reset':
        subject = 'Password Reset - OTP Code';
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Password Reset Request</h2>
            <p>You have requested to reset your password. Please use the following OTP:</p>
            <div style="background-color: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0;">
              <h1 style="color: #007bff; margin: 0; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
            </div>
            <p>This OTP will expire in 10 minutes.</p>
            <p>If you didn't request a password reset, please ignore this email.</p>
          </div>
        `;
        break;

      default:
        throw new Error('Invalid OTP type');
    }

    const mailOptions = {
      from: `"GhostSnap" <${process.env.EMAIL_USER}>`,
      to: email,
      subject,
      html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent: ' + info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email:', error);
    throw new Error('Failed to send email');
  }
};

// Send welcome email
const sendWelcomeEmail = async (email, name) => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: `"Your App" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Welcome to Your App!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Welcome to Your App, ${name}!</h2>
          <p>Thank you for joining us. Your email has been successfully verified.</p>
          <p>You can now start using our services and explore all the features we have to offer.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL}/dashboard" 
               style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">
              Get Started
            </a>
          </div>
          <p>If you have any questions, feel free to contact our support team.</p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Welcome email sent: ' + info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending welcome email:', error);
    throw new Error('Failed to send welcome email');
  }
};

// Send subscription confirmation email
const sendSubscriptionEmail = async (email, name, subscriptionType, amount) => {
  try {
    const transporter = createTransporter();

    const formattedAmount = (amount / 100).toFixed(2);

    const mailOptions = {
      from: `"Your App" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Subscription Confirmation',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Subscription Confirmed!</h2>
          <p>Hi ${name},</p>
          <p>Your ${subscriptionType} subscription has been successfully activated.</p>
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin: 0 0 10px 0;">Subscription Details:</h3>
            <p><strong>Type:</strong> ${subscriptionType}</p>
            <p><strong>Amount:</strong> €${formattedAmount}</p>
            <p><strong>Status:</strong> Active</p>
          </div>
          <p>Thank you for choosing our service!</p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Subscription email sent: ' + info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending subscription email:', error);
    throw new Error('Failed to send subscription email');
  }
};

module.exports = {
  sendOTPEmail,
  sendWelcomeEmail,
  sendSubscriptionEmail,
};
