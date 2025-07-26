const axios = require('axios');
const BASE_URL = 'http://localhost:3000/api';
const api = axios.create({ baseURL: BASE_URL });

const NUM_USERS = 6;
const ASSOCIATION_MONTHLY_AMOUNT = 1000;

let adminData = {};
let usersData = [];
let associationData = {};

async function loginOrRegisterAdmin() {
  try {
    const res = await api.post('/auth/login', { email: 'admin@jamaia.com', password: '1234' });
    return { ...res.data.user, token: res.data.token };
  } catch {
    const res = await api.post('/auth/register', {
      fullName: 'Admin',
      email: 'admin@jamaia.com',
      nationalId: '1234',
      password: '1234',
      phone: '01100000000'
    });
    return { ...res.data.user, token: res.data.token };
  }
}

async function createAndLoginUsers() {
  usersData = [];
  for (let i = 1; i <= NUM_USERS; i++) {
    const userPayload = {
      fullName: `Test User ${i}`,
      email: `user${i}@test.com`,
      nationalId: `2${String(i).padStart(13, '0')}`,
      password: 'password123',
      phone: `011${String(i).padStart(8, '0')}`,
    };
    try { await api.post('/auth/register', userPayload); } catch (e) { /* user may already exist */ }
    const loginRes = await api.post('/auth/login', { email: userPayload.email, password: userPayload.password });
    usersData.push({ ...loginRes.data.user, token: loginRes.data.token });
  }
}

async function createAssociation() {
  const payload = {
    name: `Test 6-Month Association ${Date.now()}`,
    monthlyAmount: ASSOCIATION_MONTHLY_AMOUNT,
    maxMembers: NUM_USERS,
    type: 'B'
  };
  const res = await api.post('/associations', payload, { headers: { Authorization: `Bearer ${adminData.token}` } });
  associationData = res.data.association;
}

async function joinAssociation() {
  for (let i = 0; i < usersData.length; i++) {
    const user = usersData[i];
    const turnNumber = i + 1;
    await api.post(`/associations/${associationData.id}/join`, { turnNumber }, { headers: { Authorization: `Bearer ${user.token}` } });
  }
}

async function activateAssociation() {
  for (let i = 0; i < 10; i++) {
    const res = await api.get(`/associations/${associationData.id}`);
    if (res.data.data.status === 'active') return;
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('Association did not become active');
}

async function topupAllUsers() {
  for (const user of usersData) {
    await api.post('/payments/topup', { amount: ASSOCIATION_MONTHLY_AMOUNT * NUM_USERS }, { headers: { Authorization: `Bearer ${user.token}` } });
  }
}

async function getWallet(user) {
  const res = await api.get('/userData/wallet', { headers: { Authorization: `Bearer ${user.token}` } });
  return res.data.walletBalance;
}

async function getAssociationStatus() {
  const res = await api.get(`/associations/${associationData.id}`);
  return res.data.data.status;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  adminData = await loginOrRegisterAdmin();
  await createAndLoginUsers();
  await topupAllUsers();
  await createAssociation();
  await joinAssociation();
  await activateAssociation();

  console.log('------ BEFORE WAITING FOR CRON ------');
  console.log('Association status:', await getAssociationStatus());
  const beforeWallets = await Promise.all(usersData.map(getWallet));
  beforeWallets.forEach((balance, idx) => {
    console.log(`User ${usersData[idx].id} wallet: ${balance}`);
  });

  // Wait for cron to process. Each cycle = 1 minute. Wait 7 minutes for safety.
  console.log('\nWaiting 7 minutes for cron cycles...');
  await sleep(7 * 60 * 1000);

  console.log('\n------ AFTER WAITING FOR CRON ------');
  console.log('Association status:', await getAssociationStatus());
  const afterWallets = await Promise.all(usersData.map(getWallet));
  afterWallets.forEach((balance, idx) => {
    const diff = balance - beforeWallets[idx];
    console.log(`User ${usersData[idx].id} wallet: ${balance} (change: ${diff})`);
  });

  console.log('\nDone! If balances changed and association is completed, cron job is working.');
}

main().catch(e => {
  console.error('Test failed:', e.message);
  process.exit(1);
});
