const asyncHandler = require('express-async-handler');
const WebEnquire = require('../models/WebEnquire');

// @desc    Create a new enquiry
// @route   POST /api/webenquire
// @access  Public
const createWebEnquire = asyncHandler(async (req, res) => {
  const { lookingFor, age, caste, mobileNumber, email } = req.body;

  if (!lookingFor || !age || !caste || !mobileNumber || !email) {
    return res.status(400).json({
      success: false,
      message: 'Please provide all required fields'
    });
  }

  // Check if email or mobile number already exists
  const existingEnquiry = await WebEnquire.findOne({
    $or: [{ email }, { mobileNumber }]
  });

  if (existingEnquiry) {
    if (existingEnquiry.email === email) {
      return res.status(400).json({
        success: false,
        message: 'This email ID already exists.'
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'This mobile number already exists.'
      });
    }
  }

  const newEnquire = await WebEnquire.create({
    lookingFor,
    age,
    caste,
    mobileNumber,
    email,
  });

  if (newEnquire) {
    res.status(201).json({
      success: true,
      data: newEnquire,
    });
  } else {
    return res.status(400).json({
      success: false,
      message: 'Invalid enquiry data'
    });
  }
});

// @desc    Get all enquiries
// @route   GET /api/webenquire
// @access  Private/Admin
const getWebEnquires = asyncHandler(async (req, res) => {
  const enquires = await WebEnquire.find({}).sort({ createdAt: -1 });
  res.status(200).json({
    success: true,
    data: enquires,
  });
});

module.exports = {
  createWebEnquire,
  getWebEnquires,
};
