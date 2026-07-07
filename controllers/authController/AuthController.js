const jwt = require("jsonwebtoken");
const UserModel = require("../../models/user");
const profile = require("../../models/profile");
const { sendMail } = require("../../utils/EmailService");
const { generateOTP, storeOTP, verifyOTP } = require("../../utils/OtpService");
const { FormatDate } = require("../../utils/DateFormate");
const PromotersModel = require("../../models/promoters/Promoters");
const { getWelcomeMessage, getResetPasswordMessage, getPostResetPasswordMessage } = require("../../utils/EmailMessages");
const { detectPlatform } = require("../../utils/common");
const { creditPromoterOnAdminAction } = require("../payment.controller");

const signUp = async (req, res) => {
  try {
    const { username, password, user_role, status, ...otherDetails } = req.body;

    if (otherDetails.refered_by && typeof otherDetails.refered_by === 'string') {
      otherDetails.refered_by = otherDetails.refered_by.trim().toUpperCase();
    }

    const existingUser = await UserModel.findOne({ username });

    // If user already exists AND is inactive AND this is a paid plan retry — update instead of reject
    const isPaidPlan = user_role === "PremiumUser" || user_role === "SilverUser";
    if (existingUser) {
      if ((existingUser.status === "inactive" || existingUser.status === "Pending" || existingUser.status === "pending") && isPaidPlan) {
        // Update existing inactive/pending user with latest form data
        await UserModel.updateOne({ username }, { $set: { password, user_role, status: "Pending", ...otherDetails } });
        await profile.updateOne({ email_id: username }, { $set: { type_of_user: user_role, status: "Pending", ...otherDetails } });

        try {
          const TransactionModel = require("../../models/Transaction");
          const existingTxn = await TransactionModel.findOne({ registration_no: existingUser.ref_no });
          if (!existingTxn) {
            const lastTrans = await TransactionModel.findOne({}).sort({ transaction_id: -1, transcation_id: -1 }).lean();
            const lastId = lastTrans?.transaction_id || lastTrans?.transcation_id || 0;
            const nextId = Number(lastId) + 1;
            let finalAmount = user_role === "PremiumUser" ? 999 : 799;

            const newTxn = new TransactionModel({
              registration_no: existingUser.ref_no,
              transaction_id: nextId,
              transcation_id: nextId,
              PG_id: Date.now().toString(),
              bank_ref_num: Date.now().toString(),
              mode: "Admin Approval",
              amount: finalAmount,
              status: "PENDING",
              orderno: Date.now().toString(),
              usertype: user_role,
              promocode: otherDetails.refered_by || null,
              discount_applied: 0,
              original_amount: finalAmount,
              is_handled: false
            });
            await newTxn.save();
            console.log(`=== [CONSLODE LOG: RETRY TRANSACTION] Created pending transaction in transaction_tbl for Reg No: ${existingUser.ref_no} ===`);
          } else {
            await TransactionModel.updateOne({ registration_no: existingUser.ref_no }, { $set: { status: "PENDING", usertype: user_role, promocode: otherDetails.refered_by || existingTxn.promocode } });
            console.log(`=== [CONSLODE LOG: RETRY TRANSACTION] Updated existing transaction to PENDING for Reg No: ${existingUser.ref_no} ===`);
          }
        } catch (retryTxnErr) {
          console.error("=== [CONSLODE LOG ERROR] Error updating retry transaction:", retryTxnErr, "===");
        }

        const token = jwt.sign(
          { user_id: existingUser.user_id, username, user_role, ref_no: existingUser.ref_no },
          process.env.JWT_SECRET,
          { expiresIn: "24h" }
        );
        return res.status(200).json({ success: true, token, message: "Registration updated for payment retry" });
      }
      return res.status(409).json({ success: false, message: "Username already exists" });
    }

    const lastUser = await UserModel.aggregate([
      { $sort: { user_id: -1 } },
      { $limit: 1 },
    ]);
    const newUserId = lastUser.length ? lastUser[0].user_id + 1 : 1;
    const newRefNo = lastUser.length
      ? `S${String(parseInt(lastUser[0].ref_no.replace(/\D/g, '')) + 1).padStart(
        4,
        "0"
      )}`
      : "S0001";

    // For new users, set initial status to Pending
    const userStatus = status || "Pending";

    const newUser = new UserModel({
      user_id: newUserId,
      username,
      password,
      ref_no: newRefNo,
      user_role,
      status: userStatus,
      ...otherDetails,
    });

    await newUser.save();

    const currentDate = new Date();
    const formattedDate = FormatDate(currentDate);

    // For premium users, set initial type_of_user to match their plan but keep status inactive
    const typeOfUser = (user_role === "PremiumUser" || user_role === "SilverUser")
      ? user_role
      : "FreeUser";

    const newProfile = new profile({
      registration_no: newRefNo,
      email_id: username,
      type_of_user: typeOfUser,
      status: userStatus,
      registration_date: formattedDate,
      ...otherDetails,
    });

    await newProfile.save();

    if (newProfile && (newProfile.type_of_user === "SilverUser" || newProfile.type_of_user === "PremiumUser" || otherDetails.refered_by)) {
      try {
        const TransactionModel = require("../../models/Transaction");
        const lastTrans = await TransactionModel.findOne({}).sort({ transaction_id: -1, transcation_id: -1 }).lean();
        const lastId = lastTrans?.transaction_id || lastTrans?.transcation_id || 0;
        const nextId = Number(lastId) + 1;
        let finalAmount = newProfile.type_of_user === "PremiumUser" ? 999 : 799;

        const newTxn = new TransactionModel({
          registration_no: newRefNo,
          transaction_id: nextId,
          transcation_id: nextId,
          PG_id: Date.now().toString(),
          bank_ref_num: Date.now().toString(),
          mode: "Admin Approval",
          amount: finalAmount,
          status: (newProfile.status === "active" || newProfile.status === "Active") ? "SUCCESS" : "PENDING",
          orderno: Date.now().toString(),
          usertype: newProfile.type_of_user,
          promocode: otherDetails.refered_by || null,
          discount_applied: 0,
          original_amount: finalAmount,
          is_handled: (newProfile.status === "active" || newProfile.status === "Active")
        });
        await newTxn.save();
        console.log(`=== [CONSLODE LOG: SIGNUP TRANSACTION] Created transaction in transaction_tbl for Reg No: ${newRefNo} | Promocode: ${otherDetails.refered_by || 'None'} | Status: ${newTxn.status} ===`);

        // If user was created directly as active, credit promoter immediately
        if (newProfile.status === "active" || newProfile.status === "Active") {
          console.log("=== [CONSLODE LOG: SIGNUP ACTIVE] User created directly as active. Triggering creditPromoterOnAdminAction ===");
          await creditPromoterOnAdminAction(newProfile, Date.now().toString(), newProfile.type_of_user);
        }
      } catch (txnErr) {
        console.error("=== [CONSLODE LOG ERROR] Error creating signup transaction:", txnErr, "===");
      }
    }

    try {
      const { welcomeMessage, welcomeSubject } = getWelcomeMessage(otherDetails, newRefNo);
      await sendMail(username, welcomeSubject, welcomeMessage);
    } catch (emailError) {
      console.error("Email error:", emailError);
    }

    const validUserRoles = ["FreeUser", "PremiumUser", "SilverUser", "Admin"];
    const tokenUserRole = validUserRoles.includes(newUser.user_role)
      ? newUser.user_role
      : "user";

    // Include profile data in token for signup
    const profileData = {
      first_name: otherDetails.first_name,
      last_name: otherDetails.last_name,
      email_id: username,
      mobile_no: otherDetails.mobile_no,
      age: otherDetails.age,
      city: otherDetails.city,
      type_of_user: newUser.user_role,
      status: newProfile.status || 'inactive'
    };

    const token = jwt.sign(
      {
        user_id: newUser.user_id,
        username: newUser.username,
        user_role: tokenUserRole,
        ref_no: newRefNo,
        ...profileData // Include profile data in token
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );
    try {
      const { welcomeMessage, welcomeSubject } = getWelcomeMessage(
        otherDetails,
        newRefNo
      );

      await sendMail(username, welcomeSubject, welcomeMessage);
    } catch (emailError) {
      console.error(emailError);
    }

    return res.status(201).json({
      success: true,
      token,
      message: "Signup successful",
    });
  } catch (error) {

    res.status(500).json({ success: false, message: error.message });
  }
};

const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required",
      });
    }

    const user = await UserModel.findOne({ username });
    const promoter = await PromotersModel.findOne({ username });

    const authUser = user || promoter;
    const userType = user ? "user" : "promoter";

    if (!authUser) {
      return res.status(400).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    const isPasswordValid = authUser.password === password;

    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    // Check if user account is active
    if (user && user.status !== "active") {
      const isPending = user.status === "Pending" || user.status === "pending" || user.status === "inactive";
      return res.status(403).json({
        success: false,
        message: isPending ? "Member under pending approval by admin." : "Your account is not yet activated. Please wait for admin approval.",
        accountStatus: user.status
      });
    }

    const validUserRoles = ["user", "FreeUser", "PremiumUser", "SilverUser", "Admin", "promoter"];
    const userRole = user
      ? (validUserRoles.includes(user.user_role) ? user.user_role : "user")
      : "promoter";

    const profileData = await profile.findOne({ registration_no: authUser.ref_no });

    const token = jwt.sign(
      {
        user_id: authUser.user_id,
        username: authUser.username,
        user_role: userRole,
        ref_no: authUser.ref_no,
        first_name: profileData?.first_name,
        last_name: profileData?.last_name,
        email_id: profileData?.email_id,
        mobile_no: profileData?.mobile_no,
        age: profileData?.age,
        city: profileData?.city,
        type_of_user: profileData?.type_of_user,
        status: authUser.status || profileData?.status,
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    const platform = detectPlatform(req);

    await UserModel.updateOne(
      { username },
      {
        $set: {
          last_loggedin: new Date().toISOString(),
          loggedin_from: req.ip,
          loggedin_platform: platform,
        },
      }
    );

    res.status(200).json({
      success: true,
      token,
      user: {
        user_id: authUser.user_id,
        username: authUser.username,
        user_role: userRole,
        ref_no: authUser.ref_no,
        first_name: profileData?.first_name,
        last_name: profileData?.last_name,
        email_id: profileData?.email_id,
        mobile_no: profileData?.mobile_no,
        age: profileData?.age,
        city: profileData?.city,
        type_of_user: profileData?.type_of_user,
        status: authUser.status || profileData?.status,
      },
      message: "Login successful",
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: "Internal server error during login" });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { username, otp, newPassword } = req.body;

    const user = await UserModel.findOne({ username });
    if (!user) {
      return res
        .status(400)
        .json({ success: false, message: "User not found" });
    }

    // If only username is provided (no OTP), send OTP to user
    if (username && !otp && !newPassword) {
      try {
        const { generateOTP, storeOTP } = require("../../utils/OtpService");
        const { sendMail } = require("../../utils/EmailService");
        const { getResetPasswordMessage } = require("../../utils/EmailMessages");

        const otpCode = generateOTP();
        storeOTP(username, otpCode);

        const { resetPasswordMessage, resetPasswordSubject } = getResetPasswordMessage(otpCode);
        await sendMail(username, resetPasswordSubject, resetPasswordMessage);

        return res
          .status(200)
          .json({ success: true, message: "OTP sent successfully" });
      } catch (emailError) {
        console.error("Email error:", emailError);
        return res
          .status(500)
          .json({ success: false, message: "Failed to send OTP" });
      }
    }

    // If username, OTP, and newPassword are provided, reset password
    if (username && otp && newPassword) {
      const isOTPValid = await verifyOTP(username, otp);
      if (!isOTPValid) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid or expired OTP" });
      }

      user.password = newPassword;
      await user.save();

      const { resetConfirmSubject, resetConfirmMessage } =
        getPostResetPasswordMessage();
      await sendMail(user.username, resetConfirmSubject, resetConfirmMessage);
      return res.json({
        success: true,
        message: "Password reset successfully",
      });
    }

    // If invalid combination of parameters
    return res
      .status(400)
      .json({ success: false, message: "Invalid request parameters" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getDashboardStats = async (req, res) => {
  try {
    const totalProfiles = await profile.countDocuments({});
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); // Start of current week (Sunday)

    const startOfMonth = new Date();
    startOfMonth.setDate(1); // Start of current month

    const thisWeekRegistrations = await profile.countDocuments({
      $expr: {
        $gte: [
          {
            $dateFromString: {
              dateString: "$registration_date",
              format: "%m/%d/%Y",
            },
          },
          startOfWeek,
        ],
      },
    });

    const thisMonthRegistrations = await profile.countDocuments({
      $expr: {
        $gte: [
          {
            $dateFromString: {
              dateString: "$registration_date",
              format: "%m/%d/%Y",
            },
          },
          startOfMonth,
        ],
      },
    });

    res.status(200).json({
      success: true,
      stats: {
        totalProfiles,
        thisWeekRegistrations,
        thisMonthRegistrations,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getRecentRegisters = async (req, res) => {
  try {
    const recentMembers = await profile
      .find({})
      .sort({ _id: -1 })
      .limit(6)
      .lean()
      .select({
        registration_no: 1,
        first_name: 1,
        last_name: 1,
        age: 1,
        occupation: 1,
        educational_qualification: 1,
        city: 1,
        caste: 1,
        _id: 0,
      });

    const formattedMembers = recentMembers.map(
      ({ first_name, last_name, ...rest }) => ({
        ...rest,
        name: `${first_name || ""} ${last_name || ""}`.trim(),
      })
    );

    res.status(200).json(formattedMembers);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  signUp,
  login,
  resetPassword,
  getDashboardStats,
  getRecentRegisters,
};