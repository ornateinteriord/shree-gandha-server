const mongoose = require("mongoose");
const AssistanceTransactionModel = require("../../models/Transactions/AssistanceTransaction");
const TransactionModel = require("../../models/Transactions/OnlineTransaction");
const Profile = require("../../models/profile");
const UserModel = require("../../models/user");
const { getActiveMessage } = require("../../utils/EmailMessages");
const { sendMail } = require("../../utils/EmailService");
const { creditPromoterOnAdminAction } = require("../payment.controller");

const getAllAssistanceTransactions = async (req, res) => {
    try {
        const userTransactions = await AssistanceTransactionModel.aggregate([
            {
                $lookup: {
                    from: "user_tbl", 
                    localField: "registration_no", 
                    foreignField: "ref_no", 
                    as: "userDetails"
                }
            },
            {
                $unwind: "$userDetails" 
            },
            {
                $sort: { _id: -1, date: -1 }
            },
            {
                $project: {
                    transaction_id: 1,
                    date: 1,
                    registration_no: 1,
                    pg_id: 1,
                    bank_ref_no: 1,
                    mode: 1,
                    amount: 1,
                    status: 1,
                    orderno: 1,
                    usertype: 1,
                    username: "$userDetails.username" 
                }
            }
        ]);

        res.status(200).json({ success: true, transactions: userTransactions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getOnlineAllTransactions = async (req, res) => {
  try {
    const transactions = await TransactionModel.find({
      is_handled: { $ne: true },
      PG_id: { $ne: "ADMIN_UPGRADE" },
      mode: { $ne: "Admin" }
    }).sort({ _id: -1, createdAt: -1, date: -1 });

    const regNos = transactions.map(t => t.registration_no).filter(Boolean);
    const activeProfiles = await Profile.find({ registration_no: { $in: regNos }, status: "active" }).select("registration_no updatedAt");
    const activeMap = new Map(activeProfiles.map(p => [p.registration_no, new Date(p.updatedAt || 0).getTime()]));

    const filteredTransactions = transactions.filter(t => {
      if (!t.registration_no || !activeMap.has(t.registration_no)) return true;
      const activeTimestamp = activeMap.get(t.registration_no);
      const txnTimestamp = new Date(t.createdAt || t.date || 0).getTime();
      // If transaction was created BEFORE or when user was activated, hide it!
      // Only show if the transaction was created AFTER they were already active (i.e. 2nd or 3rd time upgrade)
      return txnTimestamp > activeTimestamp + 10000;
    });
   
    res.status(200).json({
      success: true,
      data: filteredTransactions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch transactions",
      error: error.message,
    });
  }
};

const updateOnlineTransactionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, activateUser, usertype } = req.body;

    let query = {};
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { _id: id };
    } else if (!isNaN(Number(id))) {
      query = { $or: [{ transaction_id: Number(id) }, { transcation_id: Number(id) }] };
    } else {
      return res.status(400).json({ success: false, message: "Invalid transaction ID format" });
    }

    const transaction = await TransactionModel.findOne(query);
    if (!transaction) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }

    if (status) transaction.status = status;
    if (usertype) transaction.usertype = usertype;
    transaction.is_handled = true;
    await transaction.save();

    let profileUpdated = false;
    if (activateUser && transaction.registration_no) {
      await TransactionModel.updateMany({ registration_no: transaction.registration_no }, { $set: { is_handled: true } });

      const profile = await Profile.findOne({ registration_no: transaction.registration_no });
      if (profile) {
        const today = new Date();
        let updatedExpiryDate = new Date();
        const rawTargetUserType = usertype || transaction.usertype || "SilverUser";
        const lowerTarget = (rawTargetUserType || "").toLowerCase();
        let finalUserType = rawTargetUserType;
        if (lowerTarget === "silveruser" || lowerTarget === "paidsilver" || lowerTarget === "silver" || lowerTarget.includes("silver")) {
          finalUserType = "SilverUser";
          updatedExpiryDate.setMonth(today.getMonth() + 6);
        } else if (lowerTarget === "premiumuser" || lowerTarget === "paidpremium" || lowerTarget === "premium" || lowerTarget.includes("premium")) {
          finalUserType = "PremiumUser";
          updatedExpiryDate.setFullYear(today.getFullYear() + 1);
        }

        const oldStatus = profile.status;
        if (transaction.usertype !== finalUserType) {
          transaction.usertype = finalUserType;
          await transaction.save();
        }

        const updatedProfile = await Profile.findOneAndUpdate(
          { registration_no: transaction.registration_no },
          {
            $set: {
              type_of_user: finalUserType,
              expiry_date: updatedExpiryDate,
              status: "active",
            },
          },
          { new: true }
        );

        await UserModel.updateOne(
          { ref_no: transaction.registration_no },
          { $set: { user_role: finalUserType, status: "active" } }
        );

        if (updatedProfile && oldStatus !== "active") {
          try {
            const { activatedSubject, activatedMessage } = getActiveMessage(updatedProfile);
            if (activatedSubject && activatedMessage) {
              await sendMail(updatedProfile.email_id, activatedSubject, activatedMessage);
            }
          } catch (emailErr) {
            console.error("Failed to send activation email during transaction update:", emailErr.message);
          }
        }
        if (updatedProfile) {
          console.log("=== [CONSLODE LOG: TRANSACTION APPROVAL] Admin approved transaction for user:", updatedProfile.registration_no, ". Triggering creditPromoterOnAdminAction ===");
          await creditPromoterOnAdminAction(updatedProfile, Date.now().toString(), finalUserType);
        }
        profileUpdated = true;
      }
    }

    res.status(200).json({
      success: true,
      message: profileUpdated ? "Transaction updated and user membership activated successfully" : "Transaction updated successfully",
      transaction,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update transaction status",
      error: error.message,
    });
  }
};

module.exports = {
  getAllAssistanceTransactions,
  getOnlineAllTransactions,
  updateOnlineTransactionStatus
};