# Trial Logic Implementation

## Overview

This implementation provides a 3-day trial system for initial subscriptions with automatic upgrade to recurring billing after the trial period ends.

## How It Works

### 1. Initial Subscription (2€ One-Time Payment)
- User pays 2€ for initial access
- Gets 3-day free trial period
- No recurring charges during trial
- Trial starts immediately after payment

### 2. Trial Period Logic
- **Within 3 days**: User can access all features without additional charges
- **After 3 days**: User is automatically upgraded to 10€ weekly recurring subscription
- **Login Check**: Every time user logs in, system checks trial status

### 3. Auto-Upgrade Process
- When user logs in after trial ends:
  1. System detects trial has expired
  2. Automatically converts subscription to recurring (10€ weekly)
  3. User is charged 10€ for the first weekly period
  4. Future charges occur weekly

## API Endpoints

### Check Trial Status
```
GET /api/trial/status
```
Returns current trial status and whether user should be charged.

### Upgrade Trial
```
POST /api/trial/upgrade
```
Manually triggers trial upgrade (usually automatic).

### Get Subscription Details
```
GET /api/trial/subscription
```
Returns detailed subscription information.

## Database Schema

### Subscription Model
- `subscriptionType`: 'initial' or 'recurring'
- `interval`: null for initial (one-time), 'week' for recurring
- `trialStart`: When trial began
- `trialEnd`: When trial expires
- `amount`: 200 cents (2€) for initial, 1000 cents (10€) for recurring

### Trial Service Functions
- `shouldChargeUser(user)`: Main function to check if user should be charged
- `checkTrialStatus(user)`: Detailed trial status check
- `upgradeToRecurringSubscription(subscription)`: Convert to recurring

## Usage Examples

### Frontend Integration
```javascript
// Check trial status on login
const response = await fetch('/api/trial/status', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const { data } = await response.json();

if (data.shouldCharge) {
  // Redirect to payment or show upgrade message
  console.log('Trial ended, upgrade required');
} else if (data.reason === 'in_trial') {
  // User is in trial, show remaining time
  console.log('Trial active until:', data.trialEnd);
}
```

### Middleware Usage
```javascript
// Add to protected routes
app.use('/api/protected', protect, provideTrialInfo, (req, res, next) => {
  if (req.trialInfo?.shouldCharge) {
    return res.status(402).json({
      message: 'Trial ended. Payment required.',
      requiresPayment: true
    });
  }
  next();
});
```

## Configuration

### Environment Variables
- `MONGODB_URI`: Database connection
- `STRIPE_SECRET_KEY`: Stripe secret key
- `STRIPE_WEBHOOK_SECRET`: Webhook verification

### Plan Configuration
- **Initial Plan**: 2€ one-time, 3-day trial
- **Recurring Plan**: 10€ weekly, no trial

## Testing

### Manual Testing
1. Create initial subscription (2€ payment)
2. Verify trial period is set (3 days)
3. Wait for trial to expire
4. Login and verify auto-upgrade
5. Check recurring billing starts

### API Testing
```bash
# Check trial status
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/trial/status

# Get subscription details
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/trial/subscription
```

## Error Handling

- Trial check failures don't block user access
- Graceful fallback if trial service fails
- Comprehensive logging for debugging
- Database transaction safety

## Security Considerations

- All trial checks require authentication
- Webhook signature verification
- Rate limiting on trial endpoints
- Secure payment processing via Stripe

## Monitoring

- Trial status logs
- Auto-upgrade success/failure tracking
- Payment processing monitoring
- User access pattern analysis

