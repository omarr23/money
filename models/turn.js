// models/turn.js

const { DataTypes, Op } = require('sequelize');
const sequelize = require('../config/db');

const Turn = sequelize.define('Turn', {
  turnName: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'مثلاً: أول، ثاني، ثالث'
  },
  scheduledDate: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: 'تاريخ بداية الدور'
  },
  feeAmount: {
    type: DataTypes.FLOAT,
    allowNull: false,
    comment: 'قيمة القسط الخاصة بهذا الدور'
  },
  isTaken: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'هل تم حجز هذا الدور؟'
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'المستخدم الذي حجز الدور (إن وجد)'
  },
  pickedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'تاريخ ووقت حجز الدور'
  },
  associationId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'معرف الجمعية التي ينتمي إليها هذا الدور'
  },
  turnNumber: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'رقم الدور في الجمعية'
  }
}, {
  tableName: 'turns',
  indexes: [
    // Composite unique index for userId and associationId
    {
      unique: true,
      fields: ['userId', 'associationId'],
      name: 'unique_user_turn_per_association',
      where: {
        userId: {
          [Op.ne]: null
        }
      }
    },
    // Keep the existing unique index for turn numbers within an association
    {
      unique: true,
      fields: ['associationId', 'turnNumber'],
      name: 'unique_turn_per_association'
    }
  ]
});

// Don't forget relationships in your main models/index.js or wherever you define them:
// Association.hasMany(Turn, { foreignKey: 'associationId', as: 'Turns' });
// Turn.belongsTo(Association, { foreignKey: 'associationId', as: 'Association' });

module.exports = Turn;
