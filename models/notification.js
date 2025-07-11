const { Model } = require('sequelize');
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define('Notification', {
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    message: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    isRead: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    associationId: {                  // <--- NEW
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'Associations',        // Make sure 'Associations' matches your table name
        key: 'id',
      },
    },

  category: {
  type: DataTypes.ENUM('general', 'payment', 'society', 'registration', 'unapproved'),
  allowNull: false,
  defaultValue: 'general',
},

  });
  Notification.associate = function(models) {
    Notification.belongsTo(models.User, { foreignKey: 'userId' });
    Notification.belongsTo(models.Association, { foreignKey: 'associationId' }); // <--- NEW
  };
  return Notification;
};
