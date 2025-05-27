const { DataTypes } = require('sequelize');
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
  }
}, {
  tableName: 'turns'
});

module.exports = Turn;
