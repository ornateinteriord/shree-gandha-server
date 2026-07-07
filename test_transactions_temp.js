const mongoose = require('mongoose');
require('dotenv').config();

const { creditPromoterOnAdminAction } = require('./controllers/payment.controller');
const TransactionModel = require('./models/Transaction');
const PromoterTransactionModel = require('./models/promoters/PromotersTransaction');
const PromotersEarningsModel = require('./models/promoters/PromotersEarnings');

async function test() {
  try {
    const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/shree-gandha";
    console.log("Connecting to MongoDB...");
    await mongoose.connect(mongoUri);
    console.log("Connected!");

    const testRegNo = "TEST_REG_TXN_999";
    const testPromoteId = "TEST2101";

    // Cleanup before test
    await TransactionModel.deleteMany({ registration_no: testRegNo });
    await PromoterTransactionModel.deleteMany({ promocode: testPromoteId, transaction_no: "ADM_TXN_TEST_999" });
    await PromotersEarningsModel.deleteMany({ ref_no: testRegNo });

    console.log("Triggering creditPromoterOnAdminAction...");
    await creditPromoterOnAdminAction({
      registration_no: testRegNo,
      refered_by: testPromoteId,
      type_of_user: "PremiumUser",
      email_id: "test_txn@gmail.com",
      mobile_no: "9999999999"
    }, "ADM_TXN_TEST_999", "PremiumUser");

    // Verify records
    const txnRecord = await TransactionModel.findOne({ registration_no: testRegNo });
    console.log("Transaction in transaction_tbl:", txnRecord ? `FOUND (ID: ${txnRecord.transaction_id}, amount: ${txnRecord.amount}, mode: ${txnRecord.mode})` : "NOT FOUND");

    const promoterTxnRecord = await PromoterTransactionModel.findOne({ transaction_no: "ADM_TXN_TEST_999" });
    console.log("Promoter transaction in promoters_transaction_tbl:", promoterTxnRecord ? `FOUND (ID: ${promoterTxnRecord.id}, amount: ₹${promoterTxnRecord.amount}, status: ${promoterTxnRecord.status})` : "NOT FOUND");

    const earningRecord = await PromotersEarningsModel.findOne({ ref_no: testRegNo });
    console.log("Promoter earning in promoters_earnings_tbl:", earningRecord ? `FOUND (ID: ${earningRecord.id}, amount: ₹${earningRecord.amount_earned})` : "NOT FOUND");

    // Cleanup after test
    console.log("Cleaning up test records...");
    await TransactionModel.deleteMany({ registration_no: testRegNo });
    await PromoterTransactionModel.deleteMany({ transaction_no: "ADM_TXN_TEST_999" });
    await PromotersEarningsModel.deleteMany({ ref_no: testRegNo });
    console.log("Cleanup done!");

    process.exit(0);
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  }
}

test();
