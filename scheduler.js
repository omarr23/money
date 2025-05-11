
const cron = require('node-cron');
const { Association } = require('./models');
const { runCycleForAssociation } = require('./services/cycleService');

cron.schedule('0 0 * * *', async () => {
  console.log('🔁 Running daily cycle check...');

  const associations = await Association.findAll({
    where: { status: 'active' }
  });

  for (const assoc of associations) {
    try {
      await runCycleForAssociation(assoc.id);
    } catch (err) {
      console.error(`❌ Error processing association ${assoc.id}:`, err.message);
    }
  }
});
