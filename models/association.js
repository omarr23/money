const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Association = sequelize.define('Association', {
  name: { type: DataTypes.STRING, allowNull: false },
  description: DataTypes.TEXT,
  monthlyAmount: { type: DataTypes.FLOAT, allowNull: false },
  status: {
    type: DataTypes.ENUM('active', 'completed', 'pending'),
    defaultValue: 'active'
  },
  startDate: { type: DataTypes.DATE, allowNull: false },
  duration: DataTypes.INTEGER,
  type: {
    type: DataTypes.ENUM('A', 'B'),
    allowNull: false,
    defaultValue: 'B'
  },
  poolBalance: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  }
});

const UserAssociation = sequelize.define('UserAssociation', {
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
  turnNumber: DataTypes.INTEGER,
  payoutAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  }
});

Association.associate = (models) => {
  Association.hasMany(models.UserAssociation);
  Association.belongsToMany(models.User, {
    through: models.UserAssociation,
    as: 'Users',
    foreignKey: 'AssociationId'
  });
};

UserAssociation.associate = (models) => {
  UserAssociation.belongsTo(models.Association);
  UserAssociation.belongsTo(models.User);
};

module.exports = { Association, UserAssociation };
