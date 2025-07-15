const { User } = require('../models');

async function seedAdminUser() {
  const adminNationalId = '1234';
  const adminPassword = '1234';
  const adminPhone = '1234';
  const admin = await User.findOne({ where: { nationalId: adminNationalId } });
  if (!admin) {
    await User.create({
      fullName: 'Admin',
      nationalId: adminNationalId,
      phone: adminPhone,
      password: adminPassword,
      role: 'admin',
      profileApproved: true
    });
    console.log('✅ Seeded admin user with nationalId 1234 and password 1234');
  } else {
    console.log('ℹ️ Admin user already exists');
  }
}

module.exports = { seedAdminUser };
