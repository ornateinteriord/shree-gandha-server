const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  user_id: { type: Number, required: true, unique: true },
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  ref_no: { type: String, required: true,  },
  user_role: { 
    type: String, 
    required: true,
    default: 'FreeUser'
  },
  status: { type: String, default: "Pending" },
  UpdateStatus: { type: String,default: "not updated" },
  counter: { type: Number, default: 0 },
  last_loggedin: { type: String }, 
  loggedin_from: { type: String }, // IP address
  loggedin_platform: { type: String }, // "mobile", "desktop", etc.
  mobile_no: { type: String },
  refered_by: { type: String },
  refered_name: { type: String },
  first_name: { type: String },
  last_name: { type: String },
  gender: { type: String },
  date_of_birth: { type: String },
  age: { type: Number },
  height: { type: String },
  marital_status: { type: String },
  profilefor: { type: String },
  email_id: { type: String },
  address: { type: String },
  country: { type: String },
  state: { type: String },
  city: { type: String },
  pincode: { type: String },
  educational_qualification: { type: String },
  occupation: { type: String },
  income_per_month: { type: String },
  mother_tounge: { type: String },
  religion: { type: String },
  caste: { type: String },
  subcaste: { type: String },
  gotra: { type: String },
  rashi: { type: String }
}, { timestamps: true, collection: "user_tbl", strict: false });

const UserModel = mongoose.model("user_tbl", UserSchema);
module.exports = UserModel;