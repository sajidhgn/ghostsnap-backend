# Returning User Logic Implementation

## Overview

This implementation ensures that users who cancel their subscription and then rejoin skip the initial 2€ payment and go directly to the 10€ weekly recurring subscription.

## How It Works

### 1. User Tracking
- **`hasEverSubscribed`** flag tracks if user has ever had any subscription (including cancelled ones)
- **Subscription History** is checked to determine user type
- **Cancellation Tracking** marks users as having ever subscribed when they cancel

### 2. Plan Selection Logic

#### New Users (First Time)
- **Plan**: Initial plan (2€ with 3-day trial)
- **Payment**: 2€ one-time payment
- **Trial**: 3-day free trial period
- **After Trial**: Auto-upgrade to 10€ weekly recurring

#### Returning Users (Previously Subscribed)
- **Plan**: Recurring plan (10€ weekly)
- **Payment**: 10€ weekly recurring (no initial 2€ payment)
- **Trial**: No trial period
- **Billing**: Immediate weekly billing

### 3. User Journey Examples

#### Scenario A: New User
1. User signs up → Gets initial plan (2€ + 3-day trial)
2. User pays 2€ → Gets 3-day trial access
3. After 3 days → Auto-upgrade to 10€ weekly
4. User cancels → Marked as `hasEverSubscribed: true`

#### Scenario B: Returning User
1. User signs up again → System detects `hasEverSubscribed: true`
2. User gets recurring plan (10€ weekly) → No 2€ initial payment
3. User pays 10€ → Gets immediate access, no trial
4. Weekly billing continues

## Technical Implementation

### Database Schema
```javascript
// User Model
{
  hasEverSubscribed: Boolean, // Tracks if user ever had subscription
  // ... other fields
}

// Subscription Model
{
  subscriptionType: 'initial' | 'recurring',
  status: 'active' | 'canceled' | 'trialing',
  // ... other fields
}
```

### Service Functions
- `getPlanForUser(user)`: Determines appropriate plan for user
- `shouldSkipInitialPayment(user)`: Checks if user should skip 2€ payment
- `markUserAsEverSubscribed(user)`: Marks user as having ever subscribed

### API Endpoints
- `POST /api/subscriptions/create-checkout-session`: Creates appropriate checkout session
- `GET /api/trial/status`: Checks trial status
- `POST /api/trial/upgrade`: Handles trial upgrades

## Code Flow

### 1. Subscription Creation
```javascript
// Check user history
const planResult = await getPlanForUser(user);

if (planResult.isReturningUser) {
  // Use recurring plan (10€ weekly)
  plan = await SubscriptionPlan.getRecurringPlan();
} else {
  // Use initial plan (2€ with trial)
  plan = await SubscriptionPlan.getInitialPlan();
}
```

### 2. Webhook Processing
```javascript
// Handle subscription creation
const isReturningUser = stripeSubscription.metadata.isReturningUser === 'true';

// For returning users, no trial period
const finalTrialStart = isReturningUser ? null : trialStart;
const finalTrialEnd = isReturningUser ? null : trialEnd;
```

### 3. Cancellation Tracking
```javascript
// When subscription is cancelled
if (subscription.user && !subscription.user.hasEverSubscribed) {
  subscription.user.hasEverSubscribed = true;
  await subscription.user.save();
}
```

## Testing Scenarios

### Test 1: New User Flow
1. Create new user account
2. Check `hasEverSubscribed: false`
3. Create subscription → Should get initial plan (2€ + trial)
4. Verify trial period is set

### Test 2: Returning User Flow
1. User with `hasEverSubscribed: true`
2. Create subscription → Should get recurring plan (10€ weekly)
3. Verify no trial period
4. Verify immediate billing

### Test 3: Cancellation and Rejoin
1. User cancels subscription
2. Verify `hasEverSubscribed: true` is set
3. User creates new subscription
4. Should get recurring plan (10€ weekly)
5. No 2€ initial payment

## Configuration

### Environment Variables
- `MONGODB_URI`: Database connection
- `STRIPE_SECRET_KEY`: Stripe secret key
- `STRIPE_WEBHOOK_SECRET`: Webhook verification

### Plan Configuration
- **Initial Plan**: 2€ one-time, 3-day trial, `interval: undefined`
- **Recurring Plan**: 10€ weekly, no trial, `interval: 'week'`

## Monitoring and Logging

### Key Log Messages
- `🆕 New user - should get initial plan with trial`
- `🔄 Returning user - should go directly to recurring plan`
- `✅ Marked returning user as having ever subscribed`
- `Returning user - skipping trial, going directly to recurring billing`

### Metrics to Track
- New vs returning user ratio
- Trial conversion rates
- Cancellation and rejoin patterns
- Revenue impact of returning user logic

## Error Handling

- Graceful fallback to initial plan if user history check fails
- Comprehensive logging for debugging
- Database transaction safety
- Webhook signature verification

## Security Considerations

- All plan selection requires authentication
- User history is securely tracked
- No sensitive data in logs
- Stripe webhook signature verification

## Benefits

1. **User Experience**: Returning users don't pay 2€ again
2. **Revenue**: Higher conversion for returning users
3. **Retention**: Easier rejoin process
4. **Flexibility**: Supports both new and returning user flows

