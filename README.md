# Stripe Subscription Backend

A complete Express.js backend system for handling Stripe subscriptions with authentication, OTP verification, and comprehensive subscription management.

## Features

### Authentication System
- ✅ User registration with email/password
- ✅ Email verification via OTP
- ✅ Login with OTP verification for unverified emails
- ✅ JWT-based authentication
- ✅ Forgot password with OTP reset
- ✅ Rate limiting for security

### Subscription System
- ✅ Two-tier subscription model:
  - **Initial**: 2€ with 3-day free trial
  - **Recurring**: 10€ weekly (for returning subscribers)
- ✅ Stripe Checkout integration
- ✅ Webhook handling for real-time updates
- ✅ Subscription management (cancel/reactivate)
- ✅ Payment history tracking

### Database Models
- ✅ User management with Stripe customer integration
- ✅ Subscription tracking with status management
- ✅ Payment history with detailed records
- ✅ OTP system with expiration and rate limiting
- ✅ Subscription plans with Stripe integration

## Quick Start

### 1. Installation

```bash
# Clone or download the project
cd stripe-subscription-backend

# Install dependencies
npm install
```

### 2. Environment Setup

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Update the following variables in `.env`:

```env
# Database
MONGODB_URI=mongodb://localhost:27017/stripe-subscription

# JWT
JWT_SECRET=your-super-secret-jwt-key-here
JWT_EXPIRE=7d

# Stripe (Get from https://dashboard.stripe.com/apikeys)
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_publishable_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password

# Server
PORT=3000
NODE_ENV=development

# Frontend URLs
FRONTEND_URL=http://localhost:3001
SUCCESS_URL=http://localhost:3001/success
CANCEL_URL=http://localhost:3001/cancel
```

### 3. Database Setup

Make sure MongoDB is running, then:

```bash
# Setup Stripe products and database
node scripts/setupStripe.js
```

### 4. Start the Server

```bash
# Development mode
npm run dev

# Production mode
npm start
```

The server will run on `http://localhost:3000`

## API Endpoints

### Authentication Routes (`/api/auth`)

| Method | Endpoint | Description | Body |
|--------|----------|-------------|------|
| POST | `/register` | Register new user | `{name, email, password}` |
| POST | `/verify-email` | Verify email with OTP | `{email, otp}` |
| POST | `/login` | User login | `{email, password}` |
| POST | `/verify-login-otp` | Verify login OTP | `{email, otp}` |
| POST | `/forgot-password` | Request password reset | `{email}` |
| POST | `/reset-password` | Reset password with OTP | `{email, otp, newPassword}` |
| POST | `/resend-otp` | Resend OTP | `{email, type}` |
| POST | `/logout` | Logout user | - |
| GET | `/me` | Get current user | - |

### Subscription Routes (`/api/subscriptions`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/plans` | Get subscription plans | No |
| POST | `/create-checkout-session` | Create Stripe checkout | Yes |
| GET | `/current` | Get current subscription | Yes |
| POST | `/cancel` | Cancel subscription | Yes |
| POST | `/reactivate` | Reactivate subscription | Yes |
| GET | `/history` | Get subscription history | Yes |
| GET | `/payments` | Get payment history | Yes |
| GET | `/success` | Handle checkout success | No |

### Webhook Routes (`/api/webhooks`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/stripe` | Stripe webhook handler |

## Subscription Logic

### For New Users (First-time subscribers):
1. User creates account and verifies email
2. User initiates subscription → gets **Initial Plan** (2€ with 3-day trial)
3. During trial: User has full access
4. After trial: Charged 2€, then automatically upgraded to 10€/week

### For Returning Users (Previously subscribed):
1. User creates account or logs in
2. User initiates subscription → gets **Recurring Plan** (10€/week)
3. No trial period, immediate 10€ charge
4. Continues at 10€/week

### Subscription States:
- `trialing` - In free trial period
- `active` - Active subscription with payments
- `past_due` - Payment failed, grace period
- `canceled` - Subscription canceled
- `unpaid` - Payment failed, access suspended

## Webhook Events Handled

The system handles these Stripe webhook events:

- `checkout.session.completed` - Checkout completed
- `customer.subscription.created` - New subscription
- `customer.subscription.updated` - Subscription changes
- `customer.subscription.deleted` - Subscription canceled
- `invoice.payment_succeeded` - Successful payment
- `invoice.payment_failed` - Failed payment
- `customer.subscription.trial_will_end` - Trial ending soon

## Email Notifications

The system sends emails for:
- ✅ Email verification OTP
- ✅ Login verification OTP
- ✅ Password reset OTP
- ✅ Welcome email after verification
- ✅ Subscription confirmation
- 🔄 Trial ending notification (webhook ready)
- 🔄 Payment failure notification (webhook ready)

## Security Features

- Rate limiting on all endpoints
- JWT authentication with secure cookies
- Password hashing with bcrypt
- Input validation and sanitization
- CORS protection
- Helmet security headers
- OTP expiration and attempt limits
- Stripe webhook signature verification

## Database Schema

### Users
```javascript
{
  name: String,
  email: String (unique),
  password: String (hashed),
  isEmailVerified: Boolean,
  stripeCustomerId: String,
  hasEverSubscribed: Boolean,
  role: String,
  isActive: Boolean,
  lastLogin: Date
}
```

### Subscriptions
```javascript
{
  user: ObjectId,
  stripeSubscriptionId: String,
  stripeCustomerId: String,
  stripePriceId: String,
  status: String,
  currentPeriodStart: Date,
  currentPeriodEnd: Date,
  trialStart: Date,
  trialEnd: Date,
  canceledAt: Date,
  cancelAtPeriodEnd: Boolean,
  isFirstSubscription: Boolean,
  subscriptionType: String, // 'initial' or 'recurring'
  amount: Number,
  currency: String,
  interval: String
}
```

### Payments
```javascript
{
  user: ObjectId,
  subscription: ObjectId,
  stripePaymentIntentId: String,
  stripeInvoiceId: String,
  amount: Number,
  currency: String,
  status: String,
  paymentType: String,
  description: String,
  receiptUrl: String,
  failureReason: String
}
```

### OTPs
```javascript
{
  email: String,
  otp: String,
  type: String, // 'email_verification', 'login', 'password_reset'
  isUsed: Boolean,
  attempts: Number,
  maxAttempts: Number,
  expiresAt: Date,
  ipAddress: String,
  userAgent: String
}
```

## Error Handling

The API returns consistent error responses:

```javascript
{
  success: false,
  error: "Error message",
  stack: "Stack trace (development only)"
}
```

Common HTTP status codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `429` - Too Many Requests
- `500` - Internal Server Error

## Development

### Project Structure
```
├── config/          # Database and Stripe configuration
├── controllers/     # Route controllers
├── middleware/      # Authentication, validation, rate limiting
├── models/          # MongoDB models
├── routes/          # Express routes
├── scripts/         # Setup and utility scripts
├── utils/           # Helper utilities
├── server.js        # Main server file
└── package.json     # Dependencies and scripts
```

### Available Scripts
```bash
npm start          # Start production server
npm run dev        # Start development server with nodemon
npm test           # Run tests (when implemented)
```

### Adding New Features

1. **New Model**: Add to `models/` directory
2. **New Route**: Add controller to `controllers/`, route to `routes/`
3. **New Middleware**: Add to `middleware/` directory
4. **New Utility**: Add to `utils/` directory

## Deployment

### Environment Variables for Production
```env
NODE_ENV=production
MONGODB_URI=mongodb://your-production-db
JWT_SECRET=your-production-jwt-secret
STRIPE_SECRET_KEY=sk_live_your_live_key
STRIPE_WEBHOOK_SECRET=whsec_your_production_webhook_secret
# ... other production values
```

### Stripe Webhook Setup
1. Go to Stripe Dashboard → Webhooks
2. Add endpoint: `https://yourdomain.com/api/webhooks/stripe`
3. Select events: `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_*`
4. Copy webhook secret to `STRIPE_WEBHOOK_SECRET`

## Testing

### Manual Testing with curl

```bash
# Register user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"John Doe","email":"john@example.com","password":"Password123"}'

# Verify email (replace OTP)
curl -X POST http://localhost:3000/api/auth/verify-email \
  -H "Content-Type: application/json" \
  -d '{"email":"john@example.com","otp":"123456"}'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"john@example.com","password":"Password123"}'
```

## Troubleshooting

### Common Issues

1. **MongoDB Connection Error**
   - Ensure MongoDB is running
   - Check `MONGODB_URI` in `.env`

2. **Stripe Webhook Errors**
   - Verify webhook secret in `.env`
   - Check Stripe dashboard for webhook logs

3. **Email Not Sending**
   - Verify email credentials in `.env`
   - Check if using app-specific password for Gmail

4. **OTP Not Working**
   - Check email delivery
   - Verify OTP hasn't expired (10 minutes)
   - Check attempt limits (max 3 attempts)

### Logs

The application logs important events:
- Database connections
- Stripe webhook events
- Email sending status
- Authentication attempts
- Subscription changes

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review server logs
3. Check Stripe dashboard for webhook logs
4. Verify environment variables

## License

MIT License - see LICENSE file for details.
