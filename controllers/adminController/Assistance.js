const profile = require("../../models/profile");
const { getPaginationParams } = require("../../utils/pagination");



const AssistancePending = async (req, res) => {
  try {
    const { page, pageSize } = getPaginationParams(req);
    
    const filter = {
      status: { $in: ['inactive', 'pending', 'Pending'] },
      type_of_user: "Assistance"
    };

    const totalRecords = await profile.countDocuments(filter);
    
    const pendingUsers = await profile.find(filter)
      .sort({ createdAt: -1 }) 
      .skip(page * pageSize)
      .limit(pageSize);

    res.status(200).json({
      success: true,
      content: pendingUsers,
      currentPage: page,
      pageSize: pageSize,
      totalRecords: totalRecords
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
}

const assistanceSuccess = async (req, res) => {
  try {
    const { page, pageSize } = getPaginationParams(req);
    
    const filter = {
      status: 'active',
      type_of_user: "Assistance"
    };

    const totalRecords = await profile.countDocuments(filter);
    
    const activeUsers = await profile.find(filter)
      .sort({ createdAt: -1 })
      .skip(page * pageSize)
      .limit(pageSize);

    res.status(200).json({
      success: true,
      content: activeUsers,
      currentPage: page,
      pageSize: pageSize,
      totalRecords: totalRecords
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
}

module.exports = {
  AssistancePending,
  assistanceSuccess
};