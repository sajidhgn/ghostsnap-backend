# API Documentation

## Base URL
```
http://localhost:3000/api
```

## Authentication
Most endpoints require JWT authentication. Include the token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## Response Format
All API responses follow this format:
```json
{
  "success": true|false,
  "message": "Response message",
  "data": {}, // Response data (if any)
  "error": "Error message" // Only present if success is false
}
```

## Authentication Endpoints

### POST /auth/register
Register a new user account.

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "Password123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "User registered successfully. Please check your email for verification OTP.",
  "data": {
    "userId": "user_id",
    "email": "john@example.com",
    "name": "John Doe"
  }
}
```

### POST /auth/login
Login with email and password.

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "Password123"
}
```

**Response (Email Verified):**
```json
{
  "success": true,
  "message": "Login successful",
  "token": "jwt_token_here",
  "user": {
    "id": "user_id",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user",
    "isEmailVerified": true,
    "hasEverSubscribed": false
  }
}
```

**Response (Email Not Verified):**
```json
{
  "success": true,
  "message": "OTP sent to your email for verification",
  "requiresOTP": true,
  "email": "john@example.com"
}
```

### POST /auth/verify-otp
Verify login OTP for unverified email addresses.

**Request Body:**
```json
{
  "email": "john@example.com",
  "otp": "123456",
  "type": "login or email_verification"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "token": "jwt_token_here",
  "user": {
    "id": "user_id",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user",
    "isEmailVerified": true,
    "hasEverSubscribed": false
  }
}
```

### POST /auth/forgot-password
Request password reset OTP.

**Request Body:**
```json
{
  "email": "john@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Password reset OTP sent to email"
}
```

### POST /auth/reset-password
Reset password using OTP.

**Request Body:**
```json
{
  "email": "john@example.com",
  "otp": "123456",
  "newPassword": "NewPassword123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Password reset successfully"
}
```

### POST /auth/resend-otp
Resend OTP for various purposes.

**Request Body:**
```json
{
  "email": "john@example.com",
  "type": "email_verification" // or "login" or "password_reset"
}
```

**Response:**
```json
{
  "success": true,
  "message": "New OTP sent to your email"
}
```

### GET /auth/me
Get current user profile (requires authentication).

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "user_id",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user",
    "isEmailVerified": true,
    "hasEverSubscribed": false,
    "createdAt": "2023-10-01T00:00:00.000Z"
  }
}
```

### POST /auth/logout
Logout user (requires authentication).

**Response:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

## Subscription Endpoints

### GET /subscriptions/plans
Get available subscription plans.

**Response:**
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "_id": "plan_id_1",
      "name": "Initial Subscription",
      "description": "2€ initial subscription with 3-day free trial",
      "stripePriceId": "price_xxx",
      "stripeProductId": "prod_xxx",
      "amount": 200,
      "currency": "eur",
      "interval": "week",
      "intervalCount": 1,
      "planType": "initial",
      "trialPeriodDays": 3,
      "isActive": true,
      "features": [
        "Access to all features",
        "3-day free trial",
        "Email support"
      ],
      "formattedAmount": "2.00"
    },
    {
      "_id": "plan_id_2",
      "name": "Weekly Subscription",
      "description": "10€ weekly subscription",
      "stripePriceId": "price_yyy",
      "stripeProductId": "prod_yyy",
      "amount": 1000,
      "currency": "eur",
      "interval": "week",
      "intervalCount": 1,
      "planType": "recurring",
      "trialPeriodDays": 0,
      "isActive": true,
      "features": [
        "Access to all features",
        "Priority support",
        "Advanced analytics"
      ],
      "formattedAmount": "10.00"
    }
  ]
}
```

### POST /subscriptions/create-checkout-session
Create Stripe checkout session (requires authentication and email verification).

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "cs_xxx",
    "url": "https://checkout.stripe.com/pay/cs_xxx",
    "plan": {
      "name": "Initial Subscription",
      "amount": "2.00",
      "interval": "week",
      "trialPeriodDays": 3
    }
  }
}
```

### GET /subscriptions/current
Get current active subscription (requires authentication).

**Response (With Subscription):**
```json
{
  "success": true,
  "data": {
    "subscription": {
      "_id": "subscription_id",
      "user": "user_id",
      "stripeSubscriptionId": "sub_xxx",
      "stripeCustomerId": "cus_xxx",
      "stripePriceId": "price_xxx",
      "status": "active",
      "currentPeriodStart": "2023-10-01T00:00:00.000Z",
      "currentPeriodEnd": "2023-10-08T00:00:00.000Z",
      "trialStart": "2023-10-01T00:00:00.000Z",
      "trialEnd": "2023-10-04T00:00:00.000Z",
      "canceledAt": null,
      "cancelAtPeriodEnd": false,
      "isFirstSubscription": true,
      "subscriptionType": "initial",
      "amount": 200,
      "currency": "eur",
      "interval": "week",
      "intervalCount": 1
    },
    "latestPayment": {
      "_id": "payment_id",
      "amount": 200,
      "currency": "eur",
      "status": "succeeded",
      "paymentType": "initial_payment",
      "description": "Payment for initial subscription",
      "receiptUrl": "https://pay.stripe.com/receipts/xxx"
    },
    "isActive": true,
    "isInTrial": false
  }
}
```

**Response (No Subscription):**
```json
{
  "success": true,
  "data": null,
  "message": "No active subscription found"
}
```

### POST /subscriptions/cancel
Cancel active subscription (requires authentication).

**Response:**
```json
{
  "success": true,
  "message": "Subscription will be canceled at the end of the current period",
  "data": {
    "cancelAtPeriodEnd": true,
    "currentPeriodEnd": "2023-10-08T00:00:00.000Z"
  }
}
```

### POST /subscriptions/reactivate
Reactivate canceled subscription (requires authentication).

**Response:**
```json
{
  "success": true,
  "message": "Subscription reactivated successfully",
  "data": {
    "_id": "subscription_id",
    "cancelAtPeriodEnd": false,
    "canceledAt": null,
    "status": "active"
  }
}
```

### GET /subscriptions/history
Get subscription history with pagination (requires authentication).

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)

**Response:**
```json
{
  "success": true,
  "count": 5,
  "total": 5,
  "page": 1,
  "pages": 1,
  "data": [
    {
      "_id": "subscription_id",
      "stripeSubscriptionId": "sub_xxx",
      "status": "active",
      "subscriptionType": "initial",
      "amount": 200,
      "currency": "eur",
      "interval": "week",
      "createdAt": "2023-10-01T00:00:00.000Z",
      "currentPeriodStart": "2023-10-01T00:00:00.000Z",
      "currentPeriodEnd": "2023-10-08T00:00:00.000Z"
    }
  ]
}
```

### GET /subscriptions/payments
Get payment history with pagination (requires authentication).

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)

**Response:**
```json
{
  "success": true,
  "count": 3,
  "total": 3,
  "page": 1,
  "pages": 1,
  "data": [
    {
      "_id": "payment_id",
      "subscription": {
        "_id": "subscription_id",
        "subscriptionType": "initial",
        "status": "active"
      },
      "stripePaymentIntentId": "pi_xxx",
      "stripeInvoiceId": "in_xxx",
      "amount": 200,
      "currency": "eur",
      "status": "succeeded",
      "paymentType": "initial_payment",
      "description": "Payment for initial subscription",
      "receiptUrl": "https://pay.stripe.com/receipts/xxx",
      "createdAt": "2023-10-01T00:00:00.000Z"
    }
  ]
}
```

### GET /subscriptions/success
Handle successful checkout redirect.

**Query Parameters:**
- `session_id`: Stripe checkout session ID

**Response:**
Redirects to frontend success page with session information.

## Webhook Endpoints

### POST /webhooks/stripe
Stripe webhook handler for subscription events.

**Headers:**
- `stripe-signature`: Stripe webhook signature for verification

**Events Handled:**
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `payment_intent.succeeded`
- `invoice.payment_failed`
- `customer.subscription.trial_will_end`

## Error Responses

### Validation Errors (400)
```json
{
  "success": false,
  "error": "Name must be between 2 and 50 characters, Please provide a valid email"
}
```

### Authentication Errors (401)
```json
{
  "success": false,
  "error": "Not authorized to access this route"
}
```

### Forbidden Errors (403)
```json
{
  "success": false,
  "error": "Email verification required"
}
```

### Not Found Errors (404)
```json
{
  "success": false,
  "error": "User not found"
}
```

### Rate Limit Errors (429)
```json
{
  "success": false,
  "error": "Too many requests from this IP, please try again later."
}
```

### Server Errors (500)
```json
{
  "success": false,
  "error": "Server Error"
}
```

## Rate Limits

- **General**: 100 requests per 15 minutes per IP
- **Authentication**: 5 requests per 15 minutes per IP
- **OTP**: 3 requests per minute per IP
- **Password Reset**: 3 requests per hour per IP
- **Subscription**: 10 requests per hour per IP

## Subscription Flow

### First-Time Subscribers
1. User registers and verifies email
2. User creates checkout session → gets Initial Plan (2€ + 3-day trial)
3. User completes Stripe checkout
4. Webhook creates subscription record
5. User gets 3 days free trial
6. After trial: charged 2€, then upgraded to 10€/week

### Returning Subscribers
1. User registers/logs in (hasEverSubscribed = true)
2. User creates checkout session → gets Recurring Plan (10€/week)
3. User completes Stripe checkout
4. Webhook creates subscription record
5. Immediate 10€ charge, continues at 10€/week

## Testing

Use the provided test script:
```bash
node scripts/testAPI.js
```

Or test manually with curl:
```bash
# Health check
curl http://localhost:3000/health

# Register user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","password":"Password123"}'

# Get subscription plans
curl http://localhost:3000/api/subscriptions/plans
```
