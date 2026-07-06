const mongoose = require("mongoose");

const transactionShema = new mongoose.Schema(
  {
    transaction_id: { type: Number, unique: true, sparse: true }, // ensure uniqueness
    transcation_id: { type: Number, unique: true, sparse: true }, // alias to prevent duplicate key error on index transcation_id_1
    date: { type: Date, default: Date.now },
    registration_no: { type: String },
    PG_id: { type: String },
    bank_ref_num: { type: String },
    mode: { type: String },
    amount: { type: Number },
    status: { type: String, default: "success" }, // default to success
    orderno: { type: String },
    usertype: { type: String },
    is_handled: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "transaction_tbl" }
);

// 🔹 Pre-save hook for auto-increment transaction_id and transcation_id
transactionShema.pre("save", async function (next) {
  if (this.isNew) {
    const lastTransaction = await mongoose
      .model("transaction_tbl")
      .findOne({})
      .sort({ transaction_id: -1, transcation_id: -1 })
      .lean();

    const lastId = lastTransaction?.transaction_id || lastTransaction?.transcation_id || 0;
    const nextId = Number(lastId) + 1;
    this.transaction_id = nextId;
    this.transcation_id = nextId;
  }
  next();
});

const TransactionModel = mongoose.model("transaction_tbl", transactionShema);
module.exports = TransactionModel;
