const LeadSource = require('../models/LeadSource');

// @desc    Get all lead sources
// @route   GET /api/leads
// @access  Private/Admin
const getLeads = async (req, res) => {
  try {
    const leads = await LeadSource.find()
      .populate('referrerParent', 'name email')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: leads });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a new lead source entry
// @route   POST /api/leads
// @access  Private/Admin
const createLead = async (req, res) => {
  const { leadName, sourceType, notes, referrerParent } = req.body;
  try {
    const lead = await LeadSource.create({
      leadName,
      sourceType,
      notes,
      referrerParent: referrerParent || null,
      createdBy: req.user.id
    });
    res.status(201).json({ success: true, data: lead });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getLeads, createLead };
