const { up } = require('../migrations/add_duration_units');

async function runMigration() {
  try {
    await up();
    console.log('Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigration(); 