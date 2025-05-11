// models/index.js
const User = require('./user');
const { Association, UserAssociation } = require('./association');
const Payment = require('./payment');

// Define associations
Association.hasMany(UserAssociation);
UserAssociation.belongsTo(Association);

User.hasMany(UserAssociation);
UserAssociation.belongsTo(User);

// Add Payment associations with explicit foreign keys
User.hasMany(Payment, { foreignKey: 'userId' });
Payment.belongsTo(User, { foreignKey: 'userId' });

Association.hasMany(Payment, { foreignKey: 'associationId' });
Payment.belongsTo(Association, { foreignKey: 'associationId' });

// ✅ Add many-to-many relation with alias 'Associations'
User.belongsToMany(Association, {
  through: UserAssociation,
  as: 'Associations',
  foreignKey: 'UserId'
});

Association.belongsToMany(User, {
  through: UserAssociation,
  as: 'Users',
  foreignKey: 'AssociationId'
});

module.exports = {
  User,
  Association,
  UserAssociation,
  Payment
};
