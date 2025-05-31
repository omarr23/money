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

// Turn associations
User.hasMany(Turn, { foreignKey: 'userId' });
Turn.belongsTo(User, { foreignKey: 'userId' });

// ✅ MISSING RELATIONSHIP - add this:
Association.hasMany(Turn, {
  foreignKey: 'associationId',
  as: 'Turns'
});

Turn.belongsTo(Association, {
  foreignKey: 'associationId',
  as: 'Association'
});

// Many-to-many between User and Association
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
  Payment,
  Turn
};
