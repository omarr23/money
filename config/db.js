const { Sequelize } = require('sequelize');

// PostgreSQL connection example:
const sequelize = new Sequelize('jmaia', 'postgres', 'password', {
  host: 'localhost',         // or your DB host
  dialect: 'postgres',
  logging: false,            // keep as needed
  // You can add other options if required
});

module.exports = sequelize;
