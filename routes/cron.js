const cron = require('node-cron');
const { UserAssociation } = require('../models');
const { Association } = require('../models');
const sequelize = require('../config/db');
const { triggerCycleForAssociation } = require('../services/roscaService');

// Monthly cycle job - runs at midnight on the 1st of every month
cron.schedule('0 0 1 * *', async () => {
  console.log('Monthly cycle job started at:', new Date().toISOString());
  try {
    const activeAssociations = await Association.findAll({ 
      where: { status: 'active' } 
    });
    
    console.log(`Found ${activeAssociations.length} active associations`);
    
    for (const association of activeAssociations) {
      try {
        await triggerCycleForAssociation(association.id);
        console.log(`Successfully triggered cycle for association ${association.id}`);
      } catch (err) {
        console.error(`Error triggering cycle for association ${association.id}:`, err);
      }
    }
    
    console.log('Monthly cycle job completed at:', new Date().toISOString());
  } catch (error) {
    console.error('Monthly cycle job failed:', error);
  }
});

// Get members of an association with their payout info
router.get('/:id/members', async (req, res) => {
  try {
    const associationId = req.params.id;

    const members = await UserAssociation.findAll({
      where: { AssociationId: associationId },
      include: [{
        model: User,
        attributes: ['id', 'fullName', 'phone']
      }],
      order: [['turnNumber', 'ASC']]
    });

    const result = members.map(member => ({
      userId: member.User.id,
      name: member.User.fullName,
      phone: member.User.phone,
      hasReceived: member.hasReceived,
      turnNumber: member.turnNumber,
      lastReceivedDate: member.lastReceivedDate
    }));

    res.json({ success: true, data: result });

  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/admin/fees-summary', [auth, isAdmin], async (req, res) => {
  try {
    const { Payment } = require('../models/payment');
    const totalFees = await Payment.sum('feeAmount');

    res.json({
      success: true,
      totalFeesCollected: totalFees
    });
  } catch (error) {
    console.error('Admin fee summary error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});




// Admin approves user profile



module.exports = router;