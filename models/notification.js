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
    });
    Notification.associate = function(models) {
      Notification.belongsTo(models.User, { foreignKey: 'userId' });
    };
    return Notification;
  };
  