const profile = require("../../models/profile");
const UserModel = require("../../models/user");

const getUserCounts = async (req, res) => {
  try {
    const [
      freeUserCount,
      silverUserCount,
      premiumUserCount,
      assistancePendingCount,
      assistanceSuccessCount
    ] = await Promise.all([
      profile.countDocuments({ type_of_user: 'FreeUser', status: 'active' }),
      profile.countDocuments({ type_of_user: 'SilverUser',status: 'active' }),
      profile.countDocuments({ type_of_user: 'PremiumUser', status: 'active' }),
      UserModel.countDocuments({ user_role: 'Assistance', status: { $in: ['pending', 'Pending', 'inactive'] } }),
      UserModel.countDocuments({ user_role: 'Assistance', status: 'active' })
    ]);

    const totalPaidUsers = silverUserCount + premiumUserCount;

    res.status(200).json({
      success: true,
      counts: {
        freeUser: freeUserCount,
        silverUser: silverUserCount,
        premiumUser: premiumUserCount,
        totalPaidUsers,
        assistancePending: assistancePendingCount,
        assistanceSuccess: assistanceSuccessCount
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getUserCounts,
};