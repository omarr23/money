const cron = require('node-cron');
const { Association } = require('../models');
const { triggerCycleForAssociation } = require('../services/roscaService');

// ====================
// Monthly cycle job - runs at midnight on the 1st of every month
// ====================
cron.schedule('0 0 1 * *', async () => {
  console.log('MONTHLY CRON: Starting monthly cycle job at:', new Date().toISOString());
  try {
    const activeAssociations = await Association.findAll({ 
      where: { status: 'active' } 
    });

    console.log(`MONTHLY CRON: Found ${activeAssociations.length} active associations`);

    for (const association of activeAssociations) {
      try {
        await triggerCycleForAssociation(association.id);
        console.log(`MONTHLY CRON: Successfully triggered cycle for association ${association.id}`);
      } catch (err) {
        console.error(`MONTHLY CRON: Error triggering cycle for association ${association.id}:`, err);
      }
    }

    console.log('MONTHLY CRON: Monthly cycle job completed at:', new Date().toISOString());
  } catch (error) {
    console.error('MONTHLY CRON: Monthly cycle job failed:', error);
  }
});
