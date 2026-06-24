const mongoose = require('mongoose');

const webEnquireSchema = new mongoose.Schema({
  lookingFor: {
    type: String,
    required: true,
  },
  age: {
    type: String,
    required: true,
  },
  caste: {
    type: String,
    required: true,
  },
  mobileNumber: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('WebEnquire', webEnquireSchema);
