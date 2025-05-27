// join_preview_fee_test.js
const axios    = require('axios');
const path     = require('path');
const fs       = require('fs');
const FormData = require('form-data');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const BASE_URL  = process.env.API_BASE_URL || 'http://localhost:3000/api';
const NUM_USERS = 3;            // how many users to simulate
const TOPUP_AMT = 1000;         // EGP each user gets

/* ───────────── helper logger ───────────── */
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

/* ───────────── generic helpers ─────────── */
async function loginUser(nationalId, password) {
  const { data } = await axios.post(`${BASE_URL}/auth/login`, { nationalId, password });
  return data.token;
}

async function topUpWallet(token, amount) {
  await axios.post(`${BASE_URL}/payments/topup`, { amount }, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function getWallet(token) {
  const { data } = await axios.get(`${BASE_URL}/userData/wallet`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data.walletBalance;
}

/* ──────────── admin bootstrap ──────────── */
async function setupAdmin() {
  const id  = process.env.TEST_ADMIN_NATIONAL_ID;
  const pwd = process.env.TEST_ADMIN_PASSWORD;

  if (id && pwd) {
    try { const t = await loginUser(id, pwd); log(`Logged in admin ${id}`); return t; }
    catch { log('Preset admin failed to log in.'); }
  }

  if (!process.env.ADMIN_SECRET) throw new Error('ADMIN_SECRET missing in .env');

  const natId = `admin_${Date.now()}`;
  const pass  = 'testadminpassword';
  await axios.post(`${BASE_URL}/auth/register-admin`, {
    fullName : 'Auto Admin',
    nationalId: natId,
    password : pass,
    phone    : `010${Math.floor(Math.random()*1e8).toString().padStart(8,'0')}`,
    secretKey: process.env.ADMIN_SECRET,
  });
  log(`Registered temp admin ${natId}`);
  return await loginUser(natId, pass);
}

/* ────────── association helper ────────── */
async function createAssociation(adminTok) {
  const { data } = await axios.post(`${BASE_URL}/associations`, {
    name         : `TurnAssoc_${Date.now()}`,
    description  : 'Turn test',
    monthlyAmount: 500,
    startDate    : new Date().toISOString().split('T')[0],
    duration     : 4,
    type         : 'B',
    maxMembers   : 10,
  }, { headers: { Authorization: `Bearer ${adminTok}` } });

  return data.association.id;
}

/* ─────────── user registration ─────────── */
async function registerUser(index) {
  const profilePath = path.join(__dirname, 'dummy_profile.png');
  const salaryPath  = path.join(__dirname, 'dummy_salary.png');
  if (!fs.existsSync(profilePath)) fs.writeFileSync(profilePath, 'dummy_profile');
  if (!fs.existsSync(salaryPath))  fs.writeFileSync(salaryPath , 'dummy_salary');

  const stamp = `${Date.now()}_${index}`;
  const natId = `test_${stamp}`;
  const pwd   = `pass_${stamp}`;

  const form = new FormData();
  form.append('fullName'       , `Turn Tester ${index}`);
  form.append('nationalId'     , natId);
  form.append('password'       , pwd);
  form.append('phone'          , `010${Math.floor(Math.random()*1e8).toString().padStart(8,'0')}`);
  form.append('address'        , '123 Test St');
  form.append('profileImage'   , fs.createReadStream(profilePath));
  form.append('salarySlipImage', fs.createReadStream(salaryPath));

  await axios.post(`${BASE_URL}/auth/register`, form, { headers: form.getHeaders() });
  const token = await loginUser(natId, pwd);
  await topUpWallet(token, TOPUP_AMT);

  return { token, nationalId: natId };
}

/* ─────────── fee + join helpers ────────── */
async function previewFee(token, assocId, turn) {
  const { data } = await axios.post(
    `${BASE_URL}/associations/${assocId}/preview-fee`,
    { turnNumber: turn },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return data;
}

async function joinAssociation(token, assocId, turn) {
  await axios.post(
    `${BASE_URL}/associations/${assocId}/join`,
    { turnNumber: turn },
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

/* ─────────────────── MAIN TEST ─────────────────── */
async function runTest() {
  let failures = 0;
  try {
    log('=== Join + Preview-Fee Test (multi-user) ===');

    const adminTok     = await setupAdmin();
    const assocId      = await createAssociation(adminTok);
    log(`Association ID: ${assocId}\n`);

    for (let i = 1; i <= NUM_USERS; i++) {
      log(`--- User #${i} (turnNumber = ${i}) ---`);
      const user = await registerUser(i);

      const preview = await previewFee(user.token, assocId, i);
      if (!preview.success) throw new Error('Preview fee failed');

      const walletBefore = await getWallet(user.token);
      await joinAssociation(user.token, assocId, i);
      const walletAfter  = await getWallet(user.token);

      const deducted = +(walletBefore - walletAfter).toFixed(2);
      const expected = +(+preview.feeAmount).toFixed(2);

      if (Math.abs(deducted - expected) < 0.01) {
        log(`PASS  wallet deducted ${deducted} == feeAmount ${expected}`);
      } else {
        log(`FAIL  wallet deducted ${deducted} != feeAmount ${expected}`);
        failures++;
      }

      const previewAfter = await previewFee(user.token, assocId, i);
      log(`Preview after join: ${JSON.stringify(previewAfter)}`);
      log('');
    }

    /* summary */
    if (failures === 0) {
      log(`✅ ALL ${NUM_USERS} users passed wallet-deduction assertions`);
    } else {
      log(`❌ ${failures} / ${NUM_USERS} users failed wallet-deduction assertions`);
      process.exitCode = 1;
    }

    log('=== Test Completed ===');
  } catch (err) {
    log('❌ TEST ERROR');
    log(err.response ? JSON.stringify(err.response.data) : err.message);
    process.exitCode = 1;
  }
}

runTest();
