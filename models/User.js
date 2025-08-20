const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  email: { type: String, required: false },
  walletAddress: { type: String, required: false },
  depositWallet: { type: String, required: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);