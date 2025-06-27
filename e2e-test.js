const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const BASE_URL = 'http://localhost:3000/api';
const NUM_USERS = parseInt(process.argv[2]) || 10;
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const ASSOCIATION_MONTHLY_AMOUNT = 1000;
const INITIAL_WALLET_TOPUP = ASSOCIATION_MONTHLY_AMOUNT * NUM_USERS;

const log = (message, color = '\x1b[0m') => console.log(color, message, '\x1b[0m');
const logStep = (message) => log(`\n--- ${message} ---`, '\x1b[36m');
const logSuccess = (message) => log(`${message}`, '\x1b[32m');
const logError = (message, details = '') => {
  log(`${message}`, '\x1b[31m');
  if (details) console.error(details);
};
const logInfo = (message) => log(`  ${message}`, '\x1b[33m');

const api = axios.create({ baseURL: BASE_URL });

let adminData = {};
let usersData = [];
let associationData = {};

async function runTest() {
  log('STARTING FULL-CYCLE END-TO-END TEST', '\x1b[35m');
  logInfo(`Creating ${NUM_USERS} users, 1 admin, and simulating ALL ${NUM_USERS} turns.`);

  if (!ADMIN_SECRET) {
    logError('ADMIN_SECRET not found in .env file. Aborting.');
    return;
  }

  try {
    await step1_createAdmin();
    await step2_createAndFundUsers();
    await step3_createAssociation();
    await step4_usersUploadDocs();
    await step5_adminApprovesUsers();
    await step6_usersJoinAssociation();
    await step7_simulateAllCycles();

    log('\n FULL-CYCLE END-TO-END TEST COMPLETED SUCCESSFULLY!', '\x1b[32m');

  } catch (error) {
    logError('TEST FAILED AT A CRITICAL STEP', error.message);
    if (error.response?.data) {
      console.error('API Response Data:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

/**
 * verifies a single payout cycle for a given turn number.
 * @param {number} turnNumber 
 */
async function runAndVerifySingleCycle(turnNumber) {
  logStep(`Simulating Turn ${turnNumber} of ${NUM_USERS}`);

  const payoutUser = usersData[turnNumber - 1];
  const payingUsers = usersData.filter(u => u.id !== payoutUser.id);
  logInfo(`Payout User: ${payoutUser.id} (${payoutUser.fullName})`);

  // the "before"
  const beforeBalances = {};
  const adminWalletBefore = (await api.get('/userData/wallet', { headers: { Authorization: `Bearer ${adminData.token}` } })).data.walletBalance;
  beforeBalances.admin = adminWalletBefore;
  for (const user of usersData) {
    const res = await api.get('/userData/wallet', { headers: { Authorization: `Bearer ${user.token}` } });
    beforeBalances[user.id] = res.data.walletBalance;
  }

  // the calculated "after"
  const expectedBalances = { ...beforeBalances };
  const totalPot = payingUsers.length * ASSOCIATION_MONTHLY_AMOUNT;

  const feeRatios = require('./services/feeService').calculateFeeRatios(NUM_USERS);
  const feePercent = feeRatios[turnNumber - 1] || 0;
  const totalAssociationValue = ASSOCIATION_MONTHLY_AMOUNT * NUM_USERS;
  const feeAmount = feePercent * totalAssociationValue;
  const payoutAmount = totalPot - feeAmount;

  logInfo(`Pot collected: ${totalPot}`);
  logInfo(`Fee for turn ${turnNumber} (${(feePercent * 100).toFixed(1)}%): ${feeAmount.toFixed(2)}`);
  logInfo(`Net Payout to User ${payoutUser.id}: ${payoutAmount.toFixed(2)}`);

  expectedBalances.admin += feeAmount;
  expectedBalances[payoutUser.id] += payoutAmount;
  payingUsers.forEach(user => {
    expectedBalances[user.id] -= ASSOCIATION_MONTHLY_AMOUNT;
  });

  logInfo('Triggering cycle via API...');
  await api.post('/associations/test-cycle', { associationId: associationData.id }, { headers: { Authorization: `Bearer ${adminData.token}` } });
  logSuccess('Cycle triggered successfully.');

  logInfo('--- Verifying Balances After Cycle ---');
  let allCorrect = true;

  const compareBalances = (actual, expected) => Math.abs(actual - expected) < 0.01;

  const adminWalletAfter = (await api.get('/userData/wallet', { headers: { Authorization: `Bearer ${adminData.token}` } })).data.walletBalance;
  const isAdminCorrect = compareBalances(adminWalletAfter, expectedBalances.admin);
  if (!isAdminCorrect) allCorrect = false;
  log(`Admin: ${adminWalletAfter.toFixed(2)} (Expected: ${expectedBalances.admin.toFixed(2)})`, isAdminCorrect ? '\x1b[32m' : '\x1b[31m');

  for (const user of usersData) {
    const userWalletAfter = (await api.get('/userData/wallet', { headers: { Authorization: `Bearer ${user.token}` } })).data.walletBalance;
    const isUserCorrect = compareBalances(userWalletAfter, expectedBalances[user.id]);
    if (!isUserCorrect) allCorrect = false;
    log(`User ${user.id}: ${userWalletAfter.toFixed(2)} (Expected: ${expectedBalances[user.id].toFixed(2)})`, isUserCorrect ? '\x1b[32m' : '\x1b[31m');
  }

  if (!allCorrect) {
    throw new Error(`Balance verification failed for turn ${turnNumber}!`);
  }
  logSuccess(`All balances for turn ${turnNumber} are correct!`);
}


async function step7_simulateAllCycles() {
  logStep(`STEP 7: Simulating ALL ${NUM_USERS} Payout Cycles`);
  for (let i = 1; i <= NUM_USERS; i++) {
    await runAndVerifySingleCycle(i);
  }
  logSuccess(`\nAll ${NUM_USERS} cycles completed and verified successfully!`);
}

runTest();



async function step1_createAdmin() {
  logStep('STEP 1: Creating Admin User');
  const adminPayload = {
    fullName: 'Test Admin',
    nationalId: '10000000000000',
    password: 'password123',
    phone: '01000000000',
    secretKey: ADMIN_SECRET,
  };
  await api.post('/auth/register-admin', adminPayload);
  logSuccess('Admin registered.');

  const res = await api.post('/auth/login', { nationalId: adminPayload.nationalId, password: adminPayload.password });
  adminData = { ...res.data.user, token: res.data.token };
  logSuccess(`Admin logged in. Initial Balance: ${adminData.walletBalance}`);
}

async function step2_createAndFundUsers() {
  logStep(`STEP 2: Creating and Funding ${NUM_USERS} Users`);
  for (let i = 1; i <= NUM_USERS; i++) {
    const userPayload = {
      fullName: `Test User ${i}`,
      nationalId: `2${String(i).padStart(13, '0')}`,
      password: 'password123',
      phone: `011${String(i).padStart(8, '0')}`,
    };
    const registerRes = await api.post('/auth/register', userPayload);
    const { id } = registerRes.data;

    const loginRes = await api.post('/auth/login', { nationalId: userPayload.nationalId, password: userPayload.password });
    const { token } = loginRes.data;

    await api.post('/payments/topup', { amount: INITIAL_WALLET_TOPUP }, { headers: { Authorization: `Bearer ${token}` } });

    const walletRes = await api.get('/userData/wallet', { headers: { Authorization: `Bearer ${token}` } });

    usersData.push({ id, ...userPayload, token, initialBalance: walletRes.data.walletBalance });
    logSuccess(`Created and funded User ${i} (ID: ${id}) with ${walletRes.data.walletBalance}`);
  }
}

async function step3_createAssociation() {
  logStep('STEP 3: Admin Creating Association');
  const associationPayload = {
    name: `E2E Test Association ${Date.now()}`,
    monthlyAmount: ASSOCIATION_MONTHLY_AMOUNT,
    maxMembers: NUM_USERS,
    type: 'B'
  };
  const res = await api.post('/associations', associationPayload, { headers: { Authorization: `Bearer ${adminData.token}` } });
  associationData = res.data.association;
  logSuccess(`Association "${associationData.name}" (ID: ${associationData.id}) created.`);
}

async function step4_usersUploadDocs() {
  logStep('STEP 4: Users Uploading Proof Documents');
  const dummyFilePath = path.join(__dirname, 'dummy-proof.png');
  fs.writeFileSync(dummyFilePath, 'This is a test proof document.');

  for (const user of usersData) {
    const form = new FormData();
    form.append('userId', user.id);
    form.append('salarySlipImage', fs.createReadStream(dummyFilePath), 'proof.png');

    await api.post('/userData/upload-documents', form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${user.token}` },
    });
    logSuccess(`User ${user.id} uploaded document.`);
  }
  fs.unlinkSync(dummyFilePath);
}

async function step5_adminApprovesUsers() {
  logStep('STEP 5: Admin Approving All Users');
  for (const user of usersData) {
    await api.post(`/userData/admin/approve-profile/${user.id}`, { approved: true }, { headers: { Authorization: `Bearer ${adminData.token}` } });
    logSuccess(`Admin approved User ${user.id}.`);
  }
}

async function step6_usersJoinAssociation() {
  logStep('STEP 6: Approved Users Joining Association');
  for (let i = 0; i < usersData.length; i++) {
    const user = usersData[i];
    const turnNumber = i + 1;
    await api.post(`/associations/${associationData.id}/join`, { turnNumber }, { headers: { Authorization: `Bearer ${user.token}` } });
    logSuccess(`User ${user.id} joined association with turn ${turnNumber}.`);
  }
}
