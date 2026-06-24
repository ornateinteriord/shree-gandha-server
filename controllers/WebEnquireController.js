const asyncHandler = require('express-async-handler');
const WebEnquire = require('../models/WebEnquire');

// @desc    Create a new enquiry
// @route   POST /api/webenquire
// @access  Public
const createWebEnquire = asyncHandler(async (req, res) => {
  const { lookingFor, age, caste, mobileNumber, email } = req.body;

  if (!lookingFor || !age || !caste || !mobileNumber || !email) {
    res.status(400);
    throw new Error('Please provide all required fields');
  }

  // Check if email or mobile number already exists
  const existingEnquiry = await WebEnquire.findOne({
    $or: [{ email }, { mobileNumber }]
  });

  if (existingEnquiry) {
    res.status(400);
    if (existingEnquiry.email === email) {
      throw new Error('This Email ID has already been submitted. Our team will contact you soon.');
    } else {
      throw new Error('This Mobile Number has already been submitted. Our team will contact you soon.');
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
    res.status(400);
    throw new Error('Invalid enquiry data');
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
