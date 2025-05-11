const sequelize = require('../config/db');

async function up() {
  try {
    // Create a new table with the updated schema
    await sequelize.query(`
      CREATE TABLE Payments_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount FLOAT NOT NULL,
        userId INTEGER NOT NULL,
        associationId INTEGER NOT NULL,
        paymentDate DATETIME NOT NULL,
        duration INTEGER NOT NULL,
        durationUnit VARCHAR(10) NOT NULL DEFAULT 'months',
        status VARCHAR(10) NOT NULL DEFAULT 'pending',
        payoutDate DATETIME,
        payoutAmount FLOAT,
        createdAt DATETIME NOT NULL,
        updatedAt DATETIME NOT NULL,
        FOREIGN KEY (userId) REFERENCES Users(id),
        FOREIGN KEY (associationId) REFERENCES Associations(id)
      );
    `);

    // Copy data from old table to new table
    await sequelize.query(`
      INSERT INTO Payments_new 
      SELECT * FROM Payments;
    `);

    // Drop old table
    await sequelize.query(`DROP TABLE Payments;`);

    // Rename new table to original name
    await sequelize.query(`ALTER TABLE Payments_new RENAME TO Payments;`);

    console.log('✅ Migration completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

async function down() {
  try {
    // Revert changes if needed
    await sequelize.query(`
      CREATE TABLE Payments_old (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount FLOAT NOT NULL,
        userId INTEGER NOT NULL,
        associationId INTEGER NOT NULL,
        paymentDate DATETIME NOT NULL,
        duration INTEGER NOT NULL,
        durationUnit VARCHAR(10) NOT NULL DEFAULT 'months',
        status VARCHAR(10) NOT NULL DEFAULT 'pending',
        payoutDate DATETIME,
        payoutAmount FLOAT,
        createdAt DATETIME NOT NULL,
        updatedAt DATETIME NOT NULL,
        FOREIGN KEY (userId) REFERENCES Users(id),
        FOREIGN KEY (associationId) REFERENCES Associations(id)
      );
    `);

    await sequelize.query(`
      INSERT INTO Payments_old 
      SELECT * FROM Payments;
    `);

    await sequelize.query(`DROP TABLE Payments;`);
    await sequelize.query(`ALTER TABLE Payments_old RENAME TO Payments;`);

    console.log('✅ Rollback completed successfully');
  } catch (error) {
    console.error('❌ Rollback failed:', error);
    throw error;
  }
}

module.exports = { up, down }; 