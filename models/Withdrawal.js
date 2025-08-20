const mongoose = require('mongoose');

const WithdrawalSchema = new mongoose.Schema({
  userEmail: { type: String, required: false },
  address: { type: String, required: true },
  amountUSD: { type: Number, required: true },
  feeUSD: { type: Number, default: 2 },
  status: { type: String, default: 'pending' }, // pending, approved, rejected, paid
  adminNote: { type: String },
  createdAt: { type: Date, default: Date.now },
  processedAt: { type: Date }
});

module.exports = mongoose.model('Withdrawal', WithdrawalSchema);