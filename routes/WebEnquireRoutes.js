const express = require('express');
const router = express.Router();
const { createWebEnquire, getWebEnquires } = require('../controllers/WebEnquireController');

// Define routes for /api/webenquire
router.route('/').post(createWebEnquire).get(getWebEnquires);

module.exports = router;
