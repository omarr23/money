// models/index.js
const User = require('./user');
const { Association, UserAssociation } = require('./association');
const Payment = require('./payment');
const Turn = require('./turn');

// Define associations
Association.hasMany(UserAssociation);
UserAssociation.belongsTo(Association);

User.hasMany(UserAssociation);
UserAssociation.belongsTo(User);

// Payment associations
User.hasMany(Payment);
Payment.belongsTo(User);

Association.hasMany(Payment);
Payment.belongsTo(Association);


User.hasMany(Turn, { foreignKey: 'userId' });
Turn.belongsTo(User, { foreignKey: 'userId' });

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
