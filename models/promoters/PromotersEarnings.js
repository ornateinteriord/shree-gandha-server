const mongoose = require("mongoose");

const PromoterEarningsSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
  },
  date: {
    type: String,
    default: () => new Date().toISOString().split('T')[0], // YYYY-MM-DD format
  },
  referal_by: {
    type: String,
  },
  ref_no: {
    type: String,
  },
  emailid: {
    type: String,
  },
  mobile: {
    type: String,
  },
  amount_earned: {
    type: String,
  },
  transaction_no: {
    type: String,
  },
  transaction_date: {
    type: String,
    default: () => new Date().toISOString(),
  },
  status: {
    type: String,
    default: "pending",
  },
  usertype: {
    type: String,
  },
  promoter_name: {
    type: String,
  },
  account_number: {
    type: String,
  },
  bank_ifsc: {
    type: String,
  },
  user_email: {
    type: String,
  },
  user_mobile: {
    type: String,
  },
},{ timestamps: true, collection: "promoters_earnings_tbl" });

const PromotersEarningsModel = mongoose.model(
  "promoters_earnings_tbl",
  PromoterEarningsSchema
);
module.exports = PromotersEarningsModel;