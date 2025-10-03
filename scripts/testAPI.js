const axios = require('axios');

// Test API endpoints
const BASE_URL = 'http://localhost:3000/api';

class APITester {
  constructor() {
    this.token = null;
    this.testUser = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'Password123'
    };
  }

  async makeRequest(method, endpoint, data = null, useAuth = false) {
    try {
      const config = {
        method,
        url: `${BASE_URL}${endpoint}`,
        headers: {
          'Content-Type': 'application/json'
        }
      };

      if (data) {
        config.data = data;
      }

      if (useAuth && this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
      }

      const response = await axios(config);
      return { success: true, data: response.data };
    } catch (error) {
      return { 
        success: false, 
        error: error.response?.data || error.message 
      };
    }
  }

  async testHealthCheck() {
    console.log('\n🔍 Testing Health Check...');
    const result = await this.makeRequest('GET', '/../health');
    console.log(result.success ? '✅ Health check passed' : '❌ Health check failed');
    return result;
  }

  async testRegister() {
    console.log('\n🔍 Testing User Registration...');
    const result = await this.makeRequest('POST', '/auth/register', this.testUser);
    
    if (result.success) {
      console.log('✅ Registration successful');
      console.log(`📧 Check email for OTP: ${this.testUser.email}`);
    } else {
      console.log('❌ Registration failed:', result.error);
    }
    
    return result;
  }

  async testVerifyEmail(otp) {
    console.log('\n🔍 Testing Email Verification...');
    const result = await this.makeRequest('POST', '/auth/verify-email', {
      email: this.testUser.email,
      otp: otp
    });
    
    if (result.success) {
      console.log('✅ Email verification successful');
      this.token = result.data.token;
    } else {
      console.log('❌ Email verification failed:', result.error);
    }
    
    return result;
  }

  async testLogin() {
    console.log('\n🔍 Testing Login...');
    const result = await this.makeRequest('POST', '/auth/login', {
      email: this.testUser.email,
      password: this.testUser.password
    });
    
    if (result.success) {
      console.log('✅ Login successful');
      if (result.data.token) {
        this.token = result.data.token;
      }
    } else {
      console.log('❌ Login failed:', result.error);
    }
    
    return result;
  }

  async testGetProfile() {
    console.log('\n🔍 Testing Get Profile...');
    const result = await this.makeRequest('GET', '/auth/me', null, true);
    
    if (result.success) {
      console.log('✅ Profile retrieved successfully');
      console.log(`👤 User: ${result.data.data.name} (${result.data.data.email})`);
    } else {
      console.log('❌ Profile retrieval failed:', result.error);
    }
    
    return result;
  }

  async testGetSubscriptionPlans() {
    console.log('\n🔍 Testing Get Subscription Plans...');
    const result = await this.makeRequest('GET', '/subscriptions/plans');
    
    if (result.success) {
      console.log('✅ Subscription plans retrieved successfully');
      result.data.data.forEach(plan => {
        console.log(`📋 ${plan.name}: €${plan.formattedAmount}/${plan.interval}`);
      });
    } else {
      console.log('❌ Subscription plans retrieval failed:', result.error);
    }
    
    return result;
  }

  async testCreateCheckoutSession() {
    console.log('\n🔍 Testing Create Checkout Session...');
    const result = await this.makeRequest('POST', '/subscriptions/create-checkout-session', {}, true);
    
    if (result.success) {
      console.log('✅ Checkout session created successfully');
      console.log(`🔗 Checkout URL: ${result.data.data.url}`);
    } else {
      console.log('❌ Checkout session creation failed:', result.error);
    }
    
    return result;
  }

  async testGetCurrentSubscription() {
    console.log('\n🔍 Testing Get Current Subscription...');
    const result = await this.makeRequest('GET', '/subscriptions/current', null, true);
    
    if (result.success) {
      if (result.data.data) {
        console.log('✅ Current subscription found');
        console.log(`📊 Status: ${result.data.data.subscription.status}`);
      } else {
        console.log('ℹ️ No active subscription found');
      }
    } else {
      console.log('❌ Current subscription retrieval failed:', result.error);
    }
    
    return result;
  }

  async runFullTest() {
    console.log('🚀 Starting API Test Suite...\n');
    
    // Test health check
    await this.testHealthCheck();
    
    // Test registration
    await this.testRegister();
    
    console.log('\n⏸️ Please check your email for the OTP and enter it below:');
    console.log('💡 You can also use the manual verification method in the README');
    
    // Note: In a real test, you'd need to handle OTP input
    // For now, we'll skip the verification step
    console.log('\n⚠️ Skipping email verification for automated test');
    console.log('📝 To complete the test manually:');
    console.log('1. Check email for OTP');
    console.log('2. Call: POST /api/auth/verify-email with {email, otp}');
    console.log('3. Use returned token for authenticated requests');
    
    // Test other endpoints that don't require authentication
    await this.testGetSubscriptionPlans();
    
    console.log('\n✅ Basic API test completed!');
    console.log('🔧 For full testing, complete email verification and run authenticated tests');
  }
}

// Run tests if called directly
if (require.main === module) {
  const tester = new APITester();
  tester.runFullTest().catch(console.error);
}

module.exports = APITester;
