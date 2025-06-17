const axios = require('axios');
const { faker } = require('@faker-js/faker');

const BASE_URL = 'http://localhost:3000/api';

// Test configuration
const TEST_CONFIG = {
  association: {
    name: `Test Association ${Date.now()}`,
    monthlyAmount: 1000,
    duration: 3,
    type: 'B',
    startDate: new Date().toISOString().split('T')[0]
  },
  admin: {
    nationalId: '3030820620105854',
    password: 'P@ssword1234'
  }
};

async function loginAdmin() {
  try {
    const response = await axios.post(`${BASE_URL}/auth/login`, {
      nationalId: TEST_CONFIG.admin.nationalId,
      password: TEST_CONFIG.admin.password
    });
    return response.data.token;
  } catch (error) {
    console.error('Admin login failed:', error.response?.data || error.message);
    throw error;
  }
}

async function createAssociation(token) {
  try {
    const response = await axios.post(`${BASE_URL}/associations`, TEST_CONFIG.association, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return response.data.association.id;
  } catch (error) {
    console.error('Association creation failed:', error.response?.data || error.message);
    throw error;
  }
}

async function triggerCycle(associationId) {
  try {
    const response = await axios.post(`${BASE_URL}/associations/test-cycle`, { associationId });
    return response.data;
  } catch (error) {
    console.error('Cycle trigger failed:', error.response?.data || error.message);
    throw error;
  }
}

async function getAssociationMembers(associationId) {
  try {
    const response = await axios.get(`${BASE_URL}/associations/${associationId}/members`);
    return response.data.data;
  } catch (error) {
    console.error('Failed to get members:', error.response?.data || error.message);
    throw error;
  }
}

async function runTest() {
  try {
    console.log('Starting cron job test...');
    
    // 1. Login as admin
    console.log('Logging in as admin...');
    const token = await loginAdmin();
    
    // 2. Create test association
    console.log('Creating test association...');
    const associationId = await createAssociation(token);
    console.log(`Association created with ID: ${associationId}`);
    
    // 3. Trigger the cycle
    console.log('Triggering cycle...');
    const cycleResult = await triggerCycle(associationId);
    console.log('Cycle result:', cycleResult);
    
    // 4. Check members status
    console.log('Checking members status...');
    const members = await getAssociationMembers(associationId);
    console.log('Members status:', members);
    
    console.log('Test completed successfully!');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
runTest(); 