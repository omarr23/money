const { User } = require('../models');

async function seedAdminUser() {
  const adminEmail = 'admin@jamaia.com';
  const adminNationalId = '1234';
  const adminPassword = '1234';
  const adminPhone = '1234';
  
  // Try to find admin by email first, then by nationalId
  let admin = await User.findOne({ where: { email: adminEmail } });
  if (!admin) {
    admin = await User.findOne({ where: { nationalId: adminNationalId } });
  }
  
  if (!admin) {
    await User.create({
      fullName: 'Admin',
      email: adminEmail,
      nationalId: adminNationalId,
      phone: adminPhone,
      password: adminPassword,
      role: 'admin',
      profileApproved: true
    });
    console.log('✅ Seeded admin user with email admin@jamaia.com and nationalId 1234, password 1234');
  } else {
    console.log('ℹ️ Admin user already exists');
  }
}

module.exports = { seedAdminUser };
