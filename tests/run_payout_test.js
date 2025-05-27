// run_payout_test.js
const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const axios       = require('axios');
const FormDataLib = require('form-data');

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api';

const ADMIN_CREDENTIALS = {
  nationalId: process.env.TEST_ADMIN_NATIONAL_ID,
  password  : process.env.TEST_ADMIN_PASSWORD,
};

const USER_CREDENTIALS_PREFIX = 'testuser';

const ASSOCIATION_CONFIG = {
  namePrefix   : 'TestPayoutAssoc_',
  monthlyAmount: 100,          // amount each user contributes monthly
  duration     : 3,            // number of months == number of users
  type         : 'B',
  startDate    : new Date().toISOString().split('T')[0],
};

// wait slightly longer than the server’s automatic payout timer (10 s)
const PAYOUT_CHECK_INTERVAL = 11 * 1000;

/* ------------------------------------------------------------- */
let adminToken;
let associationId;
const testUsers = [];

/* -------------------- helper utilities ----------------------- */
const delay = ms => new Promise(res => setTimeout(res, ms));
const log   = msg => console.log(`[${new Date().toISOString()}] ${msg}`);

async function loginUser(nationalId, password) {
  try {
    log(`Attempting login for: ${nationalId}`);
    const { data } = await axios.post(`${BASE_URL}/auth/login`, { nationalId, password });
    return data.token;
  } catch (e) {
    const err = e.response ? JSON.stringify(e.response.data.error || e.response.data) : e.message;
    log(`Login failed for ${nationalId}: ${err}`);
    return null;
  }
}

/* FIX #1 – wallet top-up helper */
async function topUpUserWallet(token, amount) {
  await axios.post(`${BASE_URL}/payments/topup`, { amount }, {
    headers: { Authorization: `Bearer ${token}` },
  });
  log(`Wallet topped up with ${amount}`);
}

/* -------------------- admin bootstrap ------------------------ */
async function setupAdminUser() {
  if (ADMIN_CREDENTIALS.nationalId && ADMIN_CREDENTIALS.password) {
    adminToken = await loginUser(ADMIN_CREDENTIALS.nationalId, ADMIN_CREDENTIALS.password);
    if (adminToken) {
      log(`Logged in as existing admin: ${ADMIN_CREDENTIALS.nationalId}`);
      return;
    }
    log(`Failed to login with provided TEST_ADMIN_NATIONAL_ID. Will register a new admin.`);
  }

  if (!process.env.ADMIN_SECRET)
    throw new Error('ADMIN_SECRET not found in environment; needed to register admin.');

  const newAdminNatId = `admin_${Date.now()}`;
  const newAdminPassword = 'testadminpassword';
  const adminRegData = {
    fullName : 'Test Admin User',
    nationalId: newAdminNatId,
    password : newAdminPassword,
    phone    : `01000000${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`,
    secretKey: process.env.ADMIN_SECRET,
  };

  log(`Registering new admin: ${adminRegData.nationalId}`);
  await axios.post(`${BASE_URL}/auth/register-admin`, adminRegData);

  adminToken = await loginUser(newAdminNatId, newAdminPassword);
  if (!adminToken) throw new Error('Failed to login newly registered admin.');

  ADMIN_CREDENTIALS.nationalId = newAdminNatId;
  ADMIN_CREDENTIALS.password   = newAdminPassword;
  log(`Using newly registered admin: ${ADMIN_CREDENTIALS.nationalId}`);
}

/* ----------------- create a test association ----------------- */
async function createTestAssociation() {
  const associationDetails = {
    ...ASSOCIATION_CONFIG,
    name: `${ASSOCIATION_CONFIG.namePrefix}${Date.now()}`,
  };

  log(`Creating association: ${associationDetails.name}`);
  const { data } = await axios.post(`${BASE_URL}/associations`, associationDetails, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  associationId = data.association.id;
  log(`Association created with ID: ${associationId}, Name: ${associationDetails.name}`);
}

/* -------------- register / login / fund test users ----------- */
async function registerAndLoginTestUsers() {
  // make simple dummy images if they don’t exist
  const dummyProfile = path.join(__dirname, 'dummy_profile.png');
  const dummySalary  = path.join(__dirname, 'dummy_salary.png');
  if (!fs.existsSync(dummyProfile)) fs.writeFileSync(dummyProfile, 'profile_placeholder');
  if (!fs.existsSync(dummySalary))  fs.writeFileSync(dummySalary , 'salary_placeholder');

  for (let i = 0; i < ASSOCIATION_CONFIG.duration; i++) {
    const stamp = `${Date.now()}_${i}`;
    const userData = {
      fullName  : `Test User ${stamp}`,
      nationalId: `${USER_CREDENTIALS_PREFIX}_${stamp}`,
      password  : `password${stamp}`,
      phone     : `01234567${String(Date.now()).slice(-5)}${i}`,
      address   : `Test Address ${stamp}`,
    };

    const form = new FormDataLib();
    form.append('fullName'       , userData.fullName);
    form.append('nationalId'     , userData.nationalId);
    form.append('password'       , userData.password);
    form.append('phone'          , userData.phone);
    form.append('address'        , userData.address);
    form.append('profileImage'   , fs.createReadStream(dummyProfile), { filename: 'profile.png' });
    form.append('salarySlipImage', fs.createReadStream(dummySalary) , { filename: 'salary.png'  });

    try {
      log(`Registering user: ${userData.nationalId}`);
      const { data } = await axios.post(`${BASE_URL}/auth/register`, form, { headers: form.getHeaders() });
      const userId = data.id;

      const token = await loginUser(userData.nationalId, userData.password);
      if (!token) throw new Error('Login right after registration failed');

      /*  FIX #1 – fund the wallet so join fee (40) can be paid  */
      await topUpUserWallet(token, 100);

      testUsers.push({ id: userId, nationalId: userData.nationalId, password: userData.password, token });
      log(`Registered, logged in & funded: ${userData.nationalId} (ID ${userId})`);
    } catch (e) {
      const err = e.response ? JSON.stringify(e.response.data.error || e.response.data) : e.message;
      log(`Registration loop error for ${userData.nationalId}: ${err}`);
    }
  }

  if (testUsers.length !== ASSOCIATION_CONFIG.duration)
    throw new Error(`Failed to register all ${ASSOCIATION_CONFIG.duration} users. Registered ${testUsers.length}`);
}

/* ----------------- join users to association ----------------- */
async function joinUsersToAssociation() {
  for (let i = 0; i < testUsers.length; i++) {
    const user = testUsers[i];
    try {
      const turnNumber = i + 1;  // << which round they’ll receive
      log(`User ${user.nationalId} joining association ${associationId} (turnNumber ${turnNumber})`);
      /* FIX #2 – supply turnNumber in body */
      await axios.post(`${BASE_URL}/associations/${associationId}/join`, { turnNumber }, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      log(`User ${user.nationalId} joined association`);
    } catch (e) {
      const err = e.response ? JSON.stringify(e.response.data.error || e.response.data) : e.message;
      throw new Error(`User ${user.nationalId} failed to join: ${err}`);
    }
  }
}

/* ---------------- wallet & member helpers (unchanged) -------- */
async function getUserWalletBalance(token) {
  const { data } = await axios.get(`${BASE_URL}/userData/wallet`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data.walletBalance;
}

async function getAssociationMembers(id) {
  const { data } = await axios.get(`${BASE_URL}/associations/${id}/members`);
  return data.data || [];
}

/* ------------------- record initial states ------------------- */
async function recordInitialStates() {
  log('--- Recording Initial User States ---');
  const members = await getAssociationMembers(associationId);

  for (const user of testUsers) {
    user.initialWalletBalance = await getUserWalletBalance(user.token);
    const memberData = members.find(m => m.userId === user.id);
    user.initialHasReceived = memberData?.hasReceived || false;
    user.initialTurnNumber  = memberData?.turnNumber  || null;

    log(`User ${user.nationalId} wallet = ${user.initialWalletBalance}, hasReceived = ${user.initialHasReceived}, turn = ${user.initialTurnNumber ?? 'N/A'}`);
  }
}

/* ---------------- trigger payout cycle (unchanged) ----------- */
async function triggerPayoutCycle() {
  log(`Triggering payout cycle for association ID: ${associationId}`);
  await axios.post(`${BASE_URL}/associations/test-cycle`, { associationId });
  log('Payout cycle initiated, waiting for payouts to process…');
}

/* ------------------------- main test ------------------------- */
async function runTest() {
  try {
    log('======== Starting Payout Test ========');

    await setupAdminUser();
    await createTestAssociation();
    await registerAndLoginTestUsers();
    await joinUsersToAssociation();
    await recordInitialStates();
    await triggerPayoutCycle();

    /* ------------- payout verification loop (unchanged) -------------- */
    const totalPot = ASSOCIATION_CONFIG.monthlyAmount * ASSOCIATION_CONFIG.duration;
    let paidIds = new Set();

    for (let round = 1; round <= ASSOCIATION_CONFIG.duration; round++) {
      log(`\nWaiting ${PAYOUT_CHECK_INTERVAL / 1000}s for payout round ${round}…`);
      await delay(PAYOUT_CHECK_INTERVAL);

      const members = await getAssociationMembers(associationId);
      let paidThisRound = null;

      for (const m of members) {
        if (m.hasReceived && !paidIds.has(m.userId)) {
          paidThisRound = m.userId;
          paidIds.add(m.userId);

          const user = testUsers.find(u => u.id === m.userId);
          const wallet = await getUserWalletBalance(user.token);
          const expected = user.initialWalletBalance + totalPot;

          log(`🏆 Round ${round}: ${user.nationalId} received payout`);
          log(`    wallet: ${wallet} (expected ≈ ${expected})`);
          if (Math.abs(wallet - expected) > 0.01)
            log('    ⚠ Wallet mismatch!');

          break;
        }
      }

      if (!paidThisRound)
        log(`⚠  No new payout detected in round ${round}`);
    }

    log('\n======== Test Complete ========');
    log(`Users paid: ${[...paidIds].length}/${ASSOCIATION_CONFIG.duration}`);
  } catch (err) {
    log('\n!!!!!!!!!! TEST FAILED !!!!!!!!!!!');
    log(err.message);
    if (err.stack) log(err.stack);
  }
}

runTest();
