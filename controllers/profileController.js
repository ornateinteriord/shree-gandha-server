const Profile = require("../models/profile");
const UserModel = require("../models/user");
const TransactionModel = require("../models/Transactions/OnlineTransaction")
const { blurAndGetURL } = require("../utils/ImageBlur");
const { processUserImages } = require("../utils/SecureImageHandler");
const BlurredImages = require("../models/blurredImages");
const { getPaginationParams } = require("../utils/pagination");
const { getActiveMessage, getDeactiveMessage, getImageVerifiedMessage } = require("../utils/EmailMessages");
const { sendMail } = require("../utils/EmailService");
const { creditPromoterOnAdminAction } = require("./payment.controller");

// Get profile by registration number
const getProfileByRegistrationNo = async (req, res) => {
  try {
    const { registration_no } = req.params;

    const profile = await Profile.findOne({ registration_no });

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Profile not found with the given registration number",
      });
    }

    res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const DeleteImage = async (req, res) => {
  try {
    const { registration_no } = req.params;
    const profile = await Profile.findOne({ registration_no });

    if (!registration_no) {
      return res.status(404).json({
        success: false,
        message: "Registration number is required",
      });
    }
    if (!profile.image || profile.image === "") {
      return res.status(400).json({
        success: false,
        message: "No image found to delete for this profile",
      });
    }
    profile.image = "";
    profile.image_verification = "pending"; // Reset image verification status
    await profile.save();

    return res.status(200).json({
      success: true,
      message: "Image deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

const updateProfile = async (req, res) => {
  try {
    const { registration_no } = req.params;
    const { _id, image, status, isProfileUpdate, ...others } = req.body;
    const oldProfile = await Profile.findOne({ registration_no });
    const oldImageVerification = oldProfile ? oldProfile.image_verification : undefined;

    // Build update object for both models
    const profileUpdateObj = { ...others };
    if (image) profileUpdateObj.image = image;
    if (typeof status !== 'undefined') profileUpdateObj.status = status;

    const userUpdateObj = { ...others };
    if (typeof status !== 'undefined') userUpdateObj.status = status;

    const profile = await Profile.findOneAndUpdate(
      { registration_no },
      { $set: profileUpdateObj },
      { new: true }
    );

    await UserModel.findOneAndUpdate(
      { ref_no: registration_no },
      { $set: userUpdateObj }
    );
    if (profile) {
      try {
        if (
          typeof oldImageVerification !== 'undefined' &&
          oldImageVerification === 'pending' &&
          profile.image_verification === 'active'
        ) {
          const { imageVerifiedMessage, imageVerifiedSubject } = getImageVerifiedMessage(profile);
          await sendMail(profile.email_id, imageVerifiedSubject, imageVerifiedMessage);
        }

        if (
          status &&
          oldProfile &&
          oldProfile.status &&
          oldProfile.status !== status
        ) {
          let subject, message;

          if (isProfileUpdate === true) {
            const { activatedSubject, activatedMessage } = getActiveMessage(profile);
            if (!activatedSubject || !activatedMessage) {
              throw new Error("Activation email content is missing!");
            }
            subject = activatedSubject;
            message = activatedMessage;
          } else if (isProfileUpdate === false) {
            const { deactivatedSubject, deactivatedMessage } = getDeactiveMessage(profile);
            subject = deactivatedSubject;
            message = deactivatedMessage;
          }

          if (subject && message) {
            await sendMail(profile.email_id, subject, message);
          }
        }
      } catch (error) {
        console.error(error.message);
      }

      if (
        profile.status?.toLowerCase() === "active" ||
        profile.image_verification?.toLowerCase() === "active" ||
        status?.toLowerCase() === "active" ||
        req.body.status?.toLowerCase() === "active"
      ) {
        console.log("=== [CONSLODE LOG: UPDATE PROFILE ACTIVATION] Admin activated user:", profile.registration_no, ". Triggering creditPromoterOnAdminAction ===");
        await creditPromoterOnAdminAction(profile, Date.now().toString(), profile.type_of_user);
      }
    }

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Profile not found with the given registration number",
      });
    }

    const userUpdate = await UserModel.findOneAndUpdate(
      { ref_no: registration_no },
      { $set: others },
      { new: true }
    );

    if (!userUpdate) {
      return res.status(404).json({
        success: false,
        message: "User not found with the given registration number",
      });
    }

    if (image) {
      const blurredUrl = await blurAndGetURL(image, registration_no); // generate blurred image
      await BlurredImages.findOneAndUpdate(
        { user_id: profile.registration_no },
        { $set: { blurredImage: blurredUrl } },
        { upsert: true, new: true }
      );
    }
    res.status(200).json({
      success: true,
      data: { profile, user: userUpdate },
      message: "Profile Updated Successfully.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAllUserDetails = async (req, res) => {
  try {
    const { user_role: userRole, ref_no: loggedInUserId } = req.user;
    const { page, pageSize } = getPaginationParams(req);

    // Using facet for single database call
    const [{ metadata, data }] = await UserModel.aggregate([
      {
        $facet: {
          metadata: [
            { $match: { ref_no: { $ne: loggedInUserId } } },
            { $count: "totalRecords" }
          ],
          data: [
            { $match: { ref_no: { $ne: loggedInUserId } } },
            {
              $lookup: {
                from: "registration_tbl",
                localField: "ref_no",
                foreignField: "registration_no",
                as: "profileData"
              }
            },
            { $unwind: { path: "$profileData", preserveNullAndEmptyArrays: true } },
            {
              $addFields: {
                mobile_no: {
                  $cond: [
                    { $eq: [userRole, "FreeUser"] },
                    null,
                    "$profileData.mobile_no"
                  ]
                },
                email_id: {
                  $cond: [
                    { $eq: [userRole, "FreeUser"] },
                    null,
                    "$profileData.email_id"
                  ]
                },
                // 🔹 Add sorting priority for type_of_user
                type_priority: {
                  $switch: {
                    branches: [
                      { case: { $eq: ["$profileData.type_of_user", "PremiumUser"] }, then: 1 },
                      { case: { $eq: ["$profileData.type_of_user", "SilverUser"] }, then: 2 },
                      { case: { $eq: ["$profileData.type_of_user", "FreeUser"] }, then: 3 }
                    ],
                    default: 4
                  }
                },
                // 🔹 Parse registration_date as date for proper sorting
                registration_date_parsed: {
                  $dateFromString: {
                    dateString: "$profileData.registration_date",
                    format: "%m/%d/%Y",
                    onError: new Date(0),
                    onNull: new Date(0)
                  }
                }
              }
            },
            {
              $replaceRoot: {
                newRoot: {
                  $mergeObjects: [
                    "$$ROOT",
                    "$profileData",
                    {
                      user_role: "$user_role",
                      status: "$status",
                      UpdateStatus: "$UpdateStatus",
                      counter: "$counter",
                      last_loggedin: "$last_loggedin",
                      ref_no: "$ref_no"
                    }
                  ]
                }
              }
            },
            // 🔹 Sort by latest registration and creation timestamp (recent first)
            { $sort: { registration_date_parsed: -1, _id: -1 } },
            {
              $project: {
                ...(userRole?.toLowerCase() !== "admin" && { password: 0 }),
                profileData: 0,
                _id: 0,
                __v: 0
              }
            },
            { $skip: page * pageSize },
            { $limit: pageSize }
          ]
        }
      }
    ]).exec();

    const userDetails = await processUserImages(
      data,
      loggedInUserId,
      userRole
    );

    return res.status(200).json({
      success: true,
      content: userDetails,
      currentPage: page,
      pageSize,
      totalRecords: metadata?.[0]?.totalRecords || 0
    });

  } catch (error) {
    console.error("getAllUserDetails error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user details"
    });
  }
};


const getProfilesRenewal = async (req, res) => {
  try {
    const { page = 0, pageSize = 50, search } = req.query;
    const skip = parseInt(page) * parseInt(pageSize);
    const limit = parseInt(pageSize);

    let filterConditions = {
      user_role: { $ne: "admin" },
       user_role: { $ne: "FreeUser" },
      $or: [
        { status: "Pending" },
        { status: "pending" },
        { status: "inactive" },
        { status: "expires" },
        { expiry_date: { $lt: new Date() } },
      ],
    };

    if (search) {
      filterConditions.$and = [
        {
          $or: [
            { registration_no: { $regex: search, $options: "i" } },
            { first_name: { $regex: search, $options: "i" } },
            { username: { $regex: search, $options: "i" } },
            { email_id: { $regex: search, $options: "i" } },
          ],
        },
      ];
    }

    const [total, users] = await Promise.all([
      UserModel.countDocuments(filterConditions),
      UserModel.aggregate([
        { $match: filterConditions },
        {
          $lookup: {
            from: "registration_tbl",
            localField: "ref_no",
            foreignField: "registration_no",
            as: "profile",
          },
        },
        { $unwind: { path: "$profile", preserveNullAndEmptyArrays: false } },
        {
          $project: {
            username: 1,  
            user_role: 1,
            status: 1,
            registration_no: "$profile.registration_no",
            first_name: "$profile.first_name",
            email_id: "$profile.email_id",
            gender: "$profile.gender",
            expiry_date: "$profile.expiry_date",
            mobile_no: "$profile.mobile_no",
            plan_type: "$profile.plan_type",
            created_at: "$profile.created_at",
          },
        },
        { $sort: { expiry_date: 1 } },
        { $skip: skip },
        { $limit: limit },
      ]),
    ]);

    const currentDate = new Date();
    const processedUsers = users.map((user) => {
      const isExpired = new Date(user.expiry_date) < currentDate;
      const daysUntilExpiry = !isExpired
        ? Math.ceil(
            (new Date(user.expiry_date) - currentDate) / (1000 * 60 * 60 * 24)
          )
        : 0;

      let finalStatus = isExpired ? "expired" : user.status?.toLowerCase();

      return {
        ...user,
        status: finalStatus,
        days_until_expiry: daysUntilExpiry,
        expiry_message: isExpired
          ? `Account expired on ${new Date(user.expiry_date).toLocaleDateString()}`
          : `Account expires in ${daysUntilExpiry} days`,
        can_renew: true,
        renewal_eligible: !["banned", "suspended"].includes(finalStatus),
      };
    });

    res.json({
      success: true,
      content: processedUsers,
      currentPage: parseInt(page),
      pageSize: limit,
      totalRecords: total,
    });
  } catch (error) {
    console.error("Renewal profiles API error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch renewal profiles",
    });
  }
};


const getMyMatches = async (req, res) => {
  try {
    const userRegNo = req.user.ref_no;
    const userRole = req.user.user_role;
    const { page = 0, pageSize = 10 } = getPaginationParams(req);

    const myProfile = await Profile.findOne({ registration_no: userRegNo }).lean();

    if (!myProfile) {
      return res.status(404).json({
        success: false,
        message: "Profile not found for current user."
      });
    }

    // Build match criteria
    const matchCriteria = {
      registration_no: { $ne: userRegNo },
      status: "active"
    };

    // Gender filter
    if (myProfile.gender) {
      const genderMap = {
        bride: "bridegroom",
        bridegroom: "bride",
        male: "female",
        female: "male"
      };
      const oppositeGender = genderMap[myProfile.gender.toLowerCase()];
      if (oppositeGender) {
        matchCriteria.gender = new RegExp(`^${oppositeGender}$`, "i");
      }
    }

    // Age filter
    if (myProfile.from_age_preference && myProfile.to_age_preference) {
      matchCriteria.age = {
        $gte: parseInt(myProfile.from_age_preference),
        $lte: parseInt(myProfile.to_age_preference)
      };
    }

    // Height filter
    if (myProfile.from_height_preference && myProfile.to_height_preference) {
      const extractCm = (heightStr) => {
        const match = heightStr.match(/(\d+)cm/);
        return match ? parseInt(match[1]) : null;
      };

      const fromCm = extractCm(myProfile.from_height_preference);
      const toCm = extractCm(myProfile.to_height_preference);

      if (fromCm && toCm) {
        matchCriteria.height = {
          $regex: new RegExp(`(${fromCm}|${toCm})cm`)
        };
      }
    }

    // Caste filter
    if (
      myProfile.caste_preference &&
      !myProfile.caste_preference.toLowerCase().includes("any")
    ) {
      matchCriteria.caste = myProfile.caste_preference;
    }

    const [totalRecords, matches] = await Promise.all([
      Profile.countDocuments(matchCriteria),
      Profile.aggregate([
        { $match: matchCriteria },
        {
          $lookup: {
            from: "user_tbl",
            localField: "registration_no",
            foreignField: "ref_no",
            as: "user"
          }
        },
        { $unwind: "$user" },
        {
          $addFields: {
            user_details: {
              user_role: "$user.user_role",
              status: "$user.status",
              UpdateStatus: "$user.UpdateStatus",
              counter: "$user.counter",
              last_loggedin: "$user.last_loggedin",
              ref_no: "$user.ref_no"
            },
            mobile_no: {
              $cond: [
                { $eq: [req.user.user_role, "FreeUser"] },
                null,
                "$mobile_no"
              ]
            },
            email_id: {
              $cond: [
                { $eq: [req.user.user_role, "FreeUser"] },
                null,
                "$email_id"
              ]
            },
            // Add priority for sorting
            type_priority: {
              $switch: {
                branches: [
                  { case: { $eq: ["$type_of_user", "PremiumUser"] }, then: 1 },
                  { case: { $eq: ["$type_of_user", "SilverUser"] }, then: 2 },
                  { case: { $eq: ["$type_of_user", "FreeUser"] }, then: 3 }
                ],
                default: 4
              }
            },
            // Convert registration_date to Date for proper sorting
            registration_date_parsed: {
              $dateFromString: {
                dateString: "$registration_date",
                format: "%m/%d/%Y",
                onError: new Date(0),
                onNull: new Date(0)
              }
            }
          }
        },
        {
          $project: {
            _id: 0,
            ...(userRole?.toLowerCase() !== "admin" && { password: 0 }),
            user: 0,
            __v: 0
          }
        },
        // Sort by user type first, then by latest registration
        { $sort: { type_priority: 1, registration_date_parsed: -1 } },
        { $skip: page * pageSize },
        { $limit: pageSize }
      ]).exec()
    ]);

    const processedMatches = await processUserImages(
      matches,
      userRegNo,
      req.user.user_role
    );

    return res.status(200).json({
      success: true,
      content: processedMatches,
      currentPage: page,
      pageSize,
      totalRecords,
      appliedFilters: {
        preferences: {
          age: {
            from: myProfile?.from_age_preference,
            to: myProfile?.to_age_preference
          },
          height: {
            from: myProfile?.from_height_preference,
            to: myProfile?.to_height_preference
          },
          caste: myProfile?.caste_preference,
          education: myProfile?.education_preference
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching matches",
      error: error.message
    });
  }
};

const searchUsersByInput = async (req, res) => {
  try {
    const { input } = req.query;

    if (!input || input.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Search input is required",
      });
    }

    const cleanedInput = input.trim().replace(/^["']+|["']+$/g, "");
    const words = cleanedInput.split(/\s+/);
    const searchConditions = [];

    const fullRegex = { $regex: cleanedInput, $options: "i" };
    searchConditions.push(
      { first_name: fullRegex },
      { last_name: fullRegex },
      { email_id: fullRegex },
      { registration_no: fullRegex }
    );

    if (words.length > 1) {
      const [firstWord, secondWord] = words;
      searchConditions.push({
        $and: [
          { first_name: { $regex: firstWord, $options: "i" } },
          { last_name: { $regex: secondWord, $options: "i" } },
        ],
      });
      searchConditions.push({
        $and: [
          { first_name: { $regex: secondWord, $options: "i" } },
          { last_name: { $regex: firstWord, $options: "i" } },
        ],
      });
      if (words.length > 2) {
        const remainingWords = words.slice(2).join(" ");
        searchConditions.push({
          $and: [
            { first_name: { $regex: firstWord, $options: "i" } },
            { last_name: { $regex: `${secondWord} ${remainingWords}`, $options: "i" } },
          ],
        });
        searchConditions.push({
          $and: [
            { first_name: { $regex: `${firstWord} ${secondWord}`, $options: "i" } },
            { last_name: { $regex: remainingWords, $options: "i" } },
          ],
        });
      }
    }

    let profiles = await Profile.find({ $or: searchConditions });
    const regNos = profiles.map((p) => p.registration_no);
    const users = await UserModel.find({ ref_no: { $in: regNos } }).lean();

    const merged = profiles.map((profile) => {
      const user = users.find((u) => u.ref_no === profile.registration_no) || {};
      let mobile_no = profile.mobile_no;
      let email_id = profile.email_id;
      if (req.user.user_role === "FreeUser") {
        mobile_no = null;
        email_id = null;
      }
      // Create base object without password
      const mergedObject = {
        ...profile.toObject(),
        user_role: user.type_of_user,
        mobile_no,
        status: user.status,
        image: profile.image,
        image_verification: profile.image_verification,
        secure_image: profile.secure_image,
        email_id,
        ref_no: profile.registration_no,
      };

      if (req.user.user_role?.toLowerCase() === "admin") {
        mergedObject.password = user.password;
      }

      return mergedObject;
    });

    const processed = await processUserImages(merged, req.user.ref_no, req.user.user_role);

    if (!processed || processed.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No users found matching the input.",
        users: null,
      });
    }

    return res.status(200).json({
      success: true,
      users: processed,
    });
  } catch (error) {
    console.error("Search error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const upgradeUser = async (req, res) => {
  try {
    const { registration_no } = req.params;
    const { userType, amountPaid, paidType, referenceNumber } = req.body;

    const profile = await Profile.findOne({ registration_no });
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    let targetUserType = userType || "PremiumUser";
    const lowerType = (targetUserType || "").toLowerCase();
    if (lowerType === "silveruser" || lowerType === "silver" || lowerType === "paidsilver" || lowerType.includes("silver")) {
      targetUserType = "SilverUser";
    } else if (lowerType === "premiumuser" || lowerType === "premium" || lowerType === "paidpremium" || lowerType.includes("premium")) {
      targetUserType = "PremiumUser";
    }

    const today = new Date();
    let updatedExpiryDate = new Date();

    if (targetUserType === "SilverUser") {
      updatedExpiryDate.setMonth(today.getMonth() + 6);
    } else if (targetUserType === "PremiumUser") {
      updatedExpiryDate.setFullYear(today.getFullYear() + 1);
    }

    let finalAmount = Number(amountPaid);
    if (isNaN(finalAmount) || typeof amountPaid === "undefined" || amountPaid === "" || finalAmount === 0) {
      if (targetUserType === "SilverUser") finalAmount = 799;
      else if (targetUserType === "PremiumUser") finalAmount = 999;
      else finalAmount = 0;
    }

    const lastTrans = await TransactionModel.findOne({}).sort({ transaction_id: -1, transcation_id: -1 }).lean();
    const lastId = lastTrans?.transaction_id || lastTrans?.transcation_id || 0;
    const nextId = Number(lastId) + 1;

    await TransactionModel.updateMany({ registration_no }, { $set: { is_handled: true } });

    const newTransaction = new TransactionModel({
      registration_no,
      transaction_id: nextId,
      transcation_id: nextId,
      PG_id: Date.now().toString(),
      bank_ref_num: referenceNumber || Date.now().toString(),
      mode: "Admin Approval",
      amount: finalAmount,
      status: "success",
      orderno: Date.now().toString(),
      usertype: targetUserType,
      is_handled: true,
    });
    await newTransaction.save();

    const oldStatus = profile.status;

    const updatedProfile = await Profile.findOneAndUpdate(
      { registration_no },
      {
        $set: {
          type_of_user: targetUserType,
          expiry_date: updatedExpiryDate,
          status: "active",
        },
      },
      { new: true }
    );

    // 6️⃣ Update user_tbl (find by ref_no == registration_no)
    await UserModel.updateOne(
      { ref_no: registration_no },
      { $set: { user_role: targetUserType, status: "active" } }
    );

    if (updatedProfile && oldStatus !== "active") {
      try {
        const { activatedSubject, activatedMessage } = getActiveMessage(updatedProfile);
        if (activatedSubject && activatedMessage) {
          await sendMail(updatedProfile.email_id, activatedSubject, activatedMessage);
        }
      } catch (emailErr) {
        console.error("Failed to send activation email during admin upgrade:", emailErr.message);
      }
    }

    if (updatedProfile) {
      console.log("=== [CONSLODE LOG: UPGRADE USER ACTIVATION] Admin upgraded user:", updatedProfile.registration_no, ". Triggering creditPromoterOnAdminAction ===");
      await creditPromoterOnAdminAction(updatedProfile, Date.now().toString(), userType);
    }

    return res.status(200).json({
      success: true,
      message: "User upgraded successfully",
      data: {
        registration_no,
        userType,
        expiry_date: updatedExpiryDate,
        status: "active",
      },
    });
  } catch (error) {
    console.error("upgradeUser error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getAllUserImageVerification = async (req, res) => {
  try {
    const { page, pageSize } = getPaginationParams(req);

    const [{ metadata, data }] = await UserModel.aggregate([
      {
        $facet: {
          metadata: [
            {
              $lookup: {
                from: "registration_tbl",
                localField: "ref_no",
                foreignField: "registration_no",
                as: "profileData"
              }
            },
            { $unwind: "$profileData" },
            {
              $match: {
                "profileData.image_verification": "pending"
              }
            },
            { $count: "totalRecords" }
          ],
          data: [
            {
              $lookup: {
                from: "registration_tbl",
                localField: "ref_no",
                foreignField: "registration_no",
                as: "profileData"
              }
            },
            { $unwind: "$profileData" },
            {
              $match: {
                "profileData.image_verification": "pending"
              }
            },
            {
              $addFields: {
                registration_date_parsed: {
                  $dateFromString: {
                    dateString: "$profileData.registration_date",
                    format: "%m/%d/%Y",
                    onError: new Date(0),
                    onNull: new Date(0)
                  }
                }
              }
            },
            {
              $replaceRoot: {
                newRoot: {
                  $mergeObjects: [
                    "$$ROOT",
                    "$profileData",
                    {
                      user_role: "$user_role",
                      status: "$status",
                      ref_no: "$ref_no"
                    }
                  ]
                }
              }
            },
            { $sort: { registration_date_parsed: -1, _id: -1 } },
            {
              $project: {
                _id: 0,
                ref_no: 1,
                registration_no: 1,
                first_name: 1,
                last_name: 1,
                email_id: 1,
                gender: 1,
                user_role: 1,
                image: 1,
                image_verification: 1,
                registration_date: 1
              }
            },
            { $skip: page * pageSize },
            { $limit: pageSize }
          ]
        }
      }
    ]).exec();

    return res.status(200).json({
      success: true,
      content: data,
      currentPage: page,
      pageSize,
      totalRecords: metadata?.[0]?.totalRecords || 0
    });
  } catch (error) {
    console.error("getAllUserImageVerification error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch image verification data"
    });
  }
};

const changePassword = async (req, res) => {
  try {
    const { registration_no } = req.params;
    const { oldPassword, newPassword } = req.body;

    const user = await UserModel.findOne({ ref_no: registration_no });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // Plain text comparison
    if (user.password !== oldPassword) {
      return res.status(400).json({
        success: false,
        message: "Old password is incorrect.",
      });
    }

    // Save new password directly
    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password changed successfully.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const submitQrPayment = async (req, res) => {
  try {
    const { registration_no, user_id, planName, amount } = req.body;

    let query = {};
    if (registration_no) query.registration_no = registration_no;
    else if (user_id) query._id = user_id;
    else return res.status(400).json({ success: false, message: "User identification required" });

    const profile = await Profile.findOne(query);
    if (!profile) {
      return res.status(404).json({ success: false, message: "User profile not found" });
    }

    const regNo = profile.registration_no;

    const lastTrans = await TransactionModel.findOne({}).sort({ transaction_id: -1, transcation_id: -1 }).lean();
    const lastId = lastTrans?.transaction_id || lastTrans?.transcation_id || 0;
    const nextId = Number(lastId) + 1;

    let finalAmount = amount || 999;
    const lowerPlan = (planName || "").toLowerCase();
    let targetUserType = planName || "PremiumUser";
    if (lowerPlan === "silveruser" || lowerPlan === "silver" || lowerPlan.includes("silver")) {
      finalAmount = amount || 799;
      targetUserType = "SilverUser";
    } else if (lowerPlan === "premiumuser" || lowerPlan === "premium" || lowerPlan.includes("premium")) {
      finalAmount = amount || 999;
      targetUserType = "PremiumUser";
    } else if (lowerPlan === "assistance" || lowerPlan.includes("assistance")) {
      finalAmount = amount || 1499;
      targetUserType = "Assistance";
    }

    const newTransaction = new TransactionModel({
      registration_no: regNo,
      transaction_id: nextId,
      transcation_id: nextId,
      PG_id: Date.now().toString(),
      bank_ref_num: Date.now().toString(),
      mode: "Admin Approval",
      amount: finalAmount,
      status: "PENDING",
      orderno: Date.now().toString(),
      usertype: targetUserType,
      is_handled: false,
    });

    await newTransaction.save();

    return res.status(200).json({
      success: true,
      message: "Payment request submitted successfully",
      transaction: newTransaction
    });
  } catch (error) {
    console.error("Error submitting QR payment:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getProfileByRegistrationNo,
  updateProfile,
  getAllUserDetails,
  changePassword,
  searchUsersByInput,
  getMyMatches,
  DeleteImage,
  getAllUserImageVerification,
  upgradeUser,
  getProfilesRenewal,
  submitQrPayment
};
