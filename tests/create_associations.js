require('dotenv').config();
const axios = require('axios');
const { faker } = require('@faker-js/faker');

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api';

const ADMIN_CREDENTIALS = {
  nationalId: process.env.TEST_ADMIN_NATIONAL_ID,
  password: process.env.TEST_ADMIN_PASSWORD,
};

const log = msg => console.log(`[${new Date().toISOString()}] ${msg}`);

let adminToken;

/* -------------------- login admin -------------------- */
async function loginAdmin() {
  try {
    const { data } = await axios.post(`${BASE_URL}/auth/login`, ADMIN_CREDENTIALS);
    adminToken = data.token;
    log(`✅ Logged in as admin: ${ADMIN_CREDENTIALS.nationalId}`);
    return true;
  } catch (err) {
    log(`⚠ Admin login failed: ${err.response?.data?.error || err.message}`);
    return false;
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
    nationalId: `admin_${timestamp}`,
    password: 'TestAdmin123!',
    phone: `010${Math.floor(10000000 + Math.random() * 90000000)}`,
    secretKey: process.env.ADMIN_SECRET,
  };

  try {
    log(`🛠 Registering fallback admin: ${newAdmin.nationalId}`);
    await axios.post(`${BASE_URL}/auth/register-admin`, newAdmin);
    const { data } = await axios.post(`${BASE_URL}/auth/login`, {
      nationalId: newAdmin.nationalId,
      password: newAdmin.password,
    });
    adminToken = data.token;
    log(`✅ Logged in as new fallback admin: ${newAdmin.nationalId}`);
  } catch (err) {
    const error = err.response?.data?.error || err.message;
    throw new Error(`❌ Failed to register fallback admin: ${error}`);
  }
}

/* -------------------- create random association -------------------- */
function generateRandomAssociationData() {
  const baseNames = [
    'Eagle Financial Group',
    'Liberty Investment Club',
    'Freedom Savings Circle',
    'Star Spangled Savings',
    'American Dream Fund'
  ];

  const baseName = baseNames[Math.floor(Math.random() * baseNames.length)];
  const uniqueSuffix = Math.floor(1000 + Math.random() * 9000); // 4-digit random suffix

  return {
    name: `${baseName} ${uniqueSuffix}`,
    monthlyAmount: Math.floor(Math.random() * (5000 - 500 + 1)) + 500,
    maxMembers: 10,
    startDate: new Date().toISOString().split('T')[0],
    type: 'B',
  };
}

async function createAssociation(associationData) {
  try {
    await axios.post(`${BASE_URL}/associations`, associationData, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
    });
    log(`✅ Created association: ${associationData.name} ($${associationData.monthlyAmount})`);
  } catch (err) {
    const error = err.response?.data?.error || err.message;
    log(`❌ Failed to create association ${associationData.name}: ${error}`);
  }
}

/* -------------------- main -------------------- */
async function run() {
  log('🔐 Checking admin access...');
  const loggedIn = await loginAdmin();
  if (!loggedIn) {
    log('🔁 Attempting fallback admin registration...');
    await registerFallbackAdmin();
  }

  log('🏢 Creating 3 random associations...');
  for (let i = 0; i < 3; i++) {
    const association = generateRandomAssociationData();
    await createAssociation(association);
  }

  log('✅ Association creation complete.');
}

run();
