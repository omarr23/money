const User = require('./user');
const Payment = require('./payment');
const Turn = require('./turn');

const NotificationModel = require('./notification');
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const associationModels = require('./association')(sequelize, DataTypes);
const Association = associationModels.Association;
const UserAssociation = associationModels.UserAssociation;
const TakenTurn = associationModels.TakenTurn;

// Initialize Notification model
const Notification = NotificationModel(sequelize, DataTypes);

// Define associations (as before)...
Association.hasMany(UserAssociation);
UserAssociation.belongsTo(Association);

User.hasMany(UserAssociation);
UserAssociation.belongsTo(User);

User.hasMany(Payment);
Payment.belongsTo(User);

Association.hasMany(Payment);
Payment.belongsTo(Association);

User.hasMany(Turn, { foreignKey: 'userId' });
Turn.belongsTo(User, { foreignKey: 'userId' });

Association.hasMany(Turn, { foreignKey: 'associationId', as: 'Turns' });
Turn.belongsTo(Association, { foreignKey: 'associationId', as: 'Association' });

User.belongsToMany(Association, { through: UserAssociation, as: 'Associations', foreignKey: 'UserId' });
Association.belongsToMany(User, { through: UserAssociation, as: 'Users', foreignKey: 'AssociationId' });

// Notification associations
if (Notification.associate) {
  Notification.associate({ User, Association });
}

module.exports = {
  User,
  Association,
  UserAssociation,
  Payment,
  Turn,
  Notification,
  TakenTurn
};
