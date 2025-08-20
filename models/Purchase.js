const mongoose = require('mongoose');

const PurchaseSchema = new mongoose.Schema({
  userEmail: { type: String, required: false },
  planKey: { type: String, required: true },
  planName: { type: String, required: true },
  amountUSD: { type: Number, required: true },
  provider: { type: String, required: true }, // 'stripe' or 'coinpayments'
  providerData: { type: Object },
  status: { type: String, default: 'pending' }, // pending, paid, failed
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date }
});

module.exports = mongoose.model('Purchase', PurchaseSchema);