const express = require('express');
const router = express.Router();
const { getAllUserDetails, updateProfile, searchUsersByInput, getAllUserImageVerification, upgradeUser, getProfilesRenewal } = require('../controllers/profileController');
const authenticateToken = require('../middleware/auth.middleware');
const checkRole = require('../middleware/roles.middleware');
const { getPromotersTransactions, getPromoters, getPromotersEarnings, updatePromoterStatus, getPromoterUserStats, getUsersByPromoter, getAllPromotersAllData, addPromoter } = require('../controllers/promoters/PromotersController');
const {
  getAllAssistanceTransactions,
  getOnlineAllTransactions,
  updateOnlineTransactionStatus
} = require('../controllers/Transactions/TransactionController');
const { getAllNews, addNews } = require('../controllers/news/NewsController');
const { getUserCounts } = require('../controllers/adminController/DashboardStats');
const { AssistancePending, assistanceSuccess } = require('../controllers/adminController/Assistance');





router.post('/all-user-details',authenticateToken,checkRole("Admin"),getAllUserDetails)
router.put('/upgrade-user/:registration_no',authenticateToken,checkRole("Admin"),updateProfile)
router.put('/reset-password/:registration_no',authenticateToken,checkRole("Admin"),updateProfile)
router.get('/all-promoters',authenticateToken,checkRole("Admin"),getPromoters)
router.post('/add-promoter',authenticateToken,checkRole("Admin"),addPromoter)
router.get('/all-promoters-earnings',authenticateToken,checkRole("Admin"),getPromotersEarnings)
router.get("/all-promoter-users/:promoter_id",authenticateToken,checkRole("Admin"),getAllPromotersAllData)
router.get('/all-promoters-transactions',authenticateToken,checkRole("Admin"),getPromotersTransactions)
router.get('/all-Assistance-transactions', authenticateToken, checkRole("Admin"), getAllAssistanceTransactions);
router.get("/online-transactions", authenticateToken, checkRole("Admin"), getOnlineAllTransactions);
router.put("/online-transactions/:id/update-status", authenticateToken, checkRole("Admin"), updateOnlineTransactionStatus);
router.get("/all-news",authenticateToken, checkRole("Admin"), getAllNews);
router.post("/add-news",authenticateToken, checkRole("Admin"), addNews);
router.put("/promoters/:id/status",authenticateToken,checkRole("Admin"),updatePromoterStatus);
router.get("/dashboard-stats",authenticateToken,checkRole("Admin"),getUserCounts);
router.post("/assistance-pending",authenticateToken,checkRole("Admin"),AssistancePending);
router.post("/assistance-success",authenticateToken,checkRole("Admin"),assistanceSuccess);
router.get("/search",authenticateToken,checkRole("Admin"), searchUsersByInput);
router.post("/image-verification",authenticateToken,checkRole("Admin"), getAllUserImageVerification);
router.post("/upgrade-user-type/:registration_no",authenticateToken,checkRole("Admin"),upgradeUser);
router.get("/promoter-user-stats", authenticateToken, checkRole("Admin"), getPromoterUserStats)
router.get("/promoter-users/:promoter_id", authenticateToken, checkRole("Admin"), getUsersByPromoter)
router.get("/renewal-profiles", authenticateToken, checkRole("Admin"), getProfilesRenewal)


module.exports = router;