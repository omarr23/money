const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

module.exports = (sequelize, DataTypes) => {
  const Association = sequelize.define('Association', {
    name: { type: DataTypes.STRING, allowNull: false },
    description: DataTypes.TEXT,
    monthlyAmount: { type: DataTypes.FLOAT, allowNull: false },
    status: {
      type: DataTypes.ENUM('active', 'completed', 'pending'),
      defaultValue: 'active'
    },
    startDate: { type: DataTypes.DATE, allowNull: false },
    duration: { type: DataTypes.INTEGER },
    type: {
      type: DataTypes.ENUM('A', 'B', '10-months', '6-months'),
      allowNull: false,
      defaultValue: 'B'
    },
    maxMembers: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 10,
      validate: {
        min: 1,
        max: 100
      },
      comment: 'Maximum number of members allowed in this association'
    }
  });

  const TakenTurn = sequelize.define('TakenTurn', {
    turnNumber: {
      type: DataTypes.INTEGER,
      allowNull: false
    }
  });

  Association.hasMany(TakenTurn);
  TakenTurn.belongsTo(Association);

  const UserAssociation = sequelize.define('UserAssociation', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    UserId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Users',
        key: 'id'
      }
    },
    AssociationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Associations',
        key: 'id'
      }
    },
    joinDate: DataTypes.DATE,
    status: {
      type: DataTypes.ENUM('active', 'completed', 'suspended'),
      defaultValue: 'active'
    },
    remainingAmount: DataTypes.FLOAT,
    hasReceived: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    lastReceivedDate: DataTypes.DATE,
    turnNumber: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'The turn number assigned to this user in the association'
    }
  });

  Association.hasMany(UserAssociation);
  UserAssociation.belongsTo(Association);

  return { Association, UserAssociation, TakenTurn };
};