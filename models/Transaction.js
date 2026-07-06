const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  transcation_id: { // Note: keeping original spelling from example
    type: Number,
    unique: true,
    sparse: true
  },
  transaction_id: {
    type: Number,
    unique: true,
    sparse: true
  },
  date: {
    type: Date,
    default: Date.now
  },
  registration_no: {
    type: String,
    required: true
  },
  PG_id: {
    type: String,
    required: true
  },
  bank_ref_num: {
    type: String,
    default: ''
  },
  mode: {
    type: String,
    default: 'UPI' // UPI, CC, NB, etc.
  },
  amount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    required: true,
    default: 'PENDING' // PENDING, TXN_SUCCESS, TXN_FAILURE
  },
  orderno: {
    type: String,
    required: true,
    unique: true
  },
  usertype: {
    type: String,
    required: true,
    enum: ['paidSilver', 'paidPremium']
  },
  promocode: {
    type: String,
    default: null
  },
  discount_applied: {
    type: Number,
    default: 0
  },
  original_amount: {
    type: Number,
    required: true
  },
  is_handled: {
    type: Boolean,
    default: false
  }
}, { 
  collection: 'transaction_tbl',
  timestamps: true 
});

// Auto-increment transaction_id and transcation_id
TransactionSchema.pre('save', async function(next) {
  if (this.isNew && (!this.transcation_id || !this.transaction_id)) {
    try {
      const lastTransaction = await this.constructor.findOne({}, {}, { sort: { 'transcation_id': -1, 'transaction_id': -1 } });
      const lastId = lastTransaction?.transcation_id || lastTransaction?.transaction_id || 0;
      const nextId = Number(lastId) + 1;
      this.transcation_id = nextId;
      this.transaction_id = nextId;
      console.log(`Generated transaction ID: ${this.transcation_id}`);
    } catch (error) {
      console.error('Error generating transaction ID:', error);
      // Fallback to timestamp if there's an error
      const fallbackId = Date.now();
      this.transcation_id = fallbackId;
      this.transaction_id = fallbackId;
    }
  }
  next();
});

module.exports = mongoose.model('Transaction', TransactionSchema);