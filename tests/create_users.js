require('dotenv').config();
const axios = require('axios');
const { faker } = require('@faker-js/faker');

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api';

const ADMIN_CREDENTIALS = {
  email: process.env.TEST_ADMIN_EMAIL,
  password: process.env.TEST_ADMIN_PASSWORD,
};

const log = msg => console.log(`[${new Date().toISOString()}] ${msg}`);

let adminToken;

/* -------------------- login admin -------------------- */
async function loginAsAdmin() {
  try {
    const { data } = await axios.post(`${BASE_URL}/auth/login`, ADMIN_CREDENTIALS);
    adminToken = data.token;
    log(`✅ Logged in as admin: ${ADMIN_CREDENTIALS.email}`);
  } catch (err) {
    log(`❌ Failed to login as admin: ${err.response?.data?.error || err.message}`);
    throw err;
  }
}

/* -------------------- register fallback admin -------------------- */
async function registerFallbackAdmin() {
  if (!process.env.ADMIN_SECRET) {
    throw new Error('❌ ADMIN_SECRET is required to register a new admin');
  }

  const timestamp = Date.now();
  const newAdmin = {
    fullName: 'Fallback Admin',
    email: `admin_${timestamp}@test.com`,
    password: 'TestAdmin123!',
    phone: `010${Math.floor(10000000 + Math.random() * 90000000)}`,
    secretKey: process.env.ADMIN_SECRET,
  };

  try {
    log(`🛠 Registering fallback admin: ${newAdmin.email}`);
    await axios.post(`${BASE_URL}/auth/register-admin`, newAdmin);
    const { data } = await axios.post(`${BASE_URL}/auth/login`, {
      email: newAdmin.email,
      password: newAdmin.password,
    });
    adminToken = data.token;
    log(`✅ Logged in as new fallback admin: ${newAdmin.email}`);
  } catch (err) {
    const error = err.response?.data?.error || err.message;
    throw new Error(`❌ Failed to register fallback admin: ${error}`);
  }
}

/* -------------------- create random user -------------------- */
function generateRandomUserData() {
  return {
    fullName: `${faker.name.firstName()} ${faker.name.lastName()}`,
    email: `user_${Date.now()}_${Math.floor(Math.random() * 10000)}@test.com`,
    phone: `07${Math.floor(10000000 + Math.random() * 90000000)}`,
    address: faker.address.streetAddress(),
    role: 'user',
    password: 'UserPass123!',
  };
}

async function createUser(userData) {
  try {
    const response = await axios.post(`${BASE_URL}/userData/admin/create-user`, userData, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    log(`✅ Created user: ${userData.fullName} (${userData.email})`);
    return response.data;
  } catch (error) {
    log(`❌ Failed to create user ${userData.email}: ${error.response?.data?.error || error.message}`);
    throw error;
  }
}

/* -------------------- main -------------------- */
async function run() {
  log('🔐 Checking admin access...');
  const loggedIn = await loginAsAdmin();
  if (!loggedIn) {
    log('🔁 Attempting fallback admin registration...');
    await registerFallbackAdmin();
  }

  log('👥 Creating 3 random users...');
  for (let i = 0; i < 3; i++) {
    const user = generateRandomUserData();
    await createUser(user);
  }

  log('✅ User creation complete.');
}

run();
