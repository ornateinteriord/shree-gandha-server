const express = require('express');
const router = express.Router();
const { getProfileByRegistrationNo, updateProfile, getAllUserDetails, changePassword, searchUsersByInput, getMyMatches, DeleteImage, submitQrPayment } = require('../controllers/profileController');
const authenticateToken = require('../middleware/auth.middleware');
const {expressInterest,getSentInterests,getInterestStatus,updateInterestStatus,getReceivedInterests,getAcceptedInterests, cancelInterestRequest, getInterestCounts, getAcceptedConnections} = require('../controllers/intrestController/interestController');
const IncompletePayment = require('../models/IncompletePayment');

// Profile routes
router.get('/profile/:registration_no', authenticateToken, getProfileByRegistrationNo);
router.put('/update-profile/:registration_no',  updateProfile);
router.post('/all-users-profiles', authenticateToken, getAllUserDetails);
router.post('/submit-qr-payment', submitQrPayment);

// Interest routes (with authentication and consistent naming)
router.post("/interest", authenticateToken, expressInterest);
router.post("/interest/sent/:sender",authenticateToken,  getSentInterests);
router.delete('/cancel',authenticateToken, cancelInterestRequest);
router.delete('/remove-connection',authenticateToken, cancelInterestRequest);

router.get("/interest/status/:sender/:recipient", authenticateToken, getInterestStatus);
router.put("/interest/:registration_no", authenticateToken, updateInterestStatus);
router.post("/interest/received/:recipient", authenticateToken, getReceivedInterests);
router.post("/interest/accepted/:recipient", authenticateToken, getAcceptedInterests);
router.post("/change-password/:registration_no",authenticateToken, changePassword);
router.get("/interest-counts/:registrationNo", getInterestCounts);
router.get("/search",authenticateToken, searchUsersByInput);
router.post("/my-matches",authenticateToken, getMyMatches);
router.get("/connections/:userId", authenticateToken, getAcceptedConnections);
router.delete("/delete-image/:registration_no", authenticateToken,DeleteImage);

// Incomplete payments endpoint
router.get("/incomplete-payments", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    // Find incomplete payments for the user
    const incompletePayments = await IncompletePayment.find({ 
      customerPhone: userId 
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: incompletePayments,
      count: incompletePayments.length
    });
  } catch (error) {
    console.error('Error fetching incomplete payments:', error);
    res.status(500).json({ 
      error: "Failed to fetch incomplete payments",
      message: error.message 
    });
  }
});

module.exports = router;