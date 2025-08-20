require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const Stripe = require('stripe');
const CoinPayments = require('coinpayments');
const TronWeb = require('tronweb');
const crypto = require('crypto');
const path = require('path');

const app = express();

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const cpClient = new CoinPayments({
  key: process.env.COINPAYMENTS_PUBLIC_KEY || '',
  secret: process.env.COINPAYMENTS_PRIVATE_KEY || ''
});

// DB models
const User = require('./models/User');
const Purchase = require('./models/Purchase');
const Withdrawal = require('./models/Withdrawal');

// Connect MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bitcoin_mining', { useNewUrlParser:true, useUnifiedTopology:true })
  .then(()=>console.log('MongoDB connected'))
  .catch(err=>console.error('MongoDB error', err));

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Use JSON parser for most routes
app.use(bodyParser.json());

// Helper: plan metadata
const PLAN_META = {
  free: {name:'تجربة مجانية', price:0, days:3},
  p10: {name:'خطة 10', price:10, days:30},
  p25: {name:'خطة 25', price:25, days:30},
  p50: {name:'خطة 50', price:50, days:30},
  p100: {name:'خطة 100', price:100, days:30},
  p200: {name:'خطة 200', price:200, days:30}
};

// ---------------- TRON / TRC20 helper ----------------
// Uses TronWeb to send TRC20 tokens from platform wallet to recipient.
// Requires env: TRON_FULLNODE, TRON_SOLIDITY_NODE, TRON_EVENT_NODE, TRON_PRIVATE_KEY, TRC20_CONTRACT_ADDRESS, TRC20_DECIMALS, TRC20_USD_RATE
let tronWeb = null;
function initTron(){
  if(tronWeb) return tronWeb;
  if(!process.env.TRON_PRIVATE_KEY) return null;
  tronWeb = new TronWeb({
    fullHost: process.env.TRON_FULLNODE || 'https://api.trongrid.io',
    privateKey: process.env.TRON_PRIVATE_KEY
  });
  return tronWeb;
}

async function sendTrc20Token(toAddress, amountTokensFloat){
  // amountTokensFloat: human-readable amount (e.g., 10.5 USDT)
  const decimals = Number(process.env.TRC20_DECIMALS || 6);
  const contractAddress = process.env.TRC20_CONTRACT_ADDRESS;
  if(!contractAddress) throw new Error('TRC20_CONTRACT_ADDRESS not configured');
  const tron = initTron();
  if(!tron) throw new Error('Tron private key not configured in environment');
  const contract = await tron.contract().at(contractAddress);
  const amount = BigInt(Math.round(amountTokensFloat * (10 ** decimals)));
  const tx = await contract.transfer(toAddress, amount.toString()).send({feeLimit: 1_000_000_000});
  return tx;
}

// Create purchase and return payment URL (Stripe Checkout or CoinPayments)
app.post('/api/subscribe', async (req,res)=>{
  try{
    const { plan, provider, wallet, userEmail } = req.body;
    if(!plan || !provider) return res.status(400).json({ok:false, message:'plan and provider required'});
    const meta = PLAN_META[plan];
    if(!meta) return res.status(400).json({ok:false, message:'invalid plan'});

    // create purchase record (pending)
    const purchase = await Purchase.create({
      userEmail: userEmail || null,
      planKey: plan,
      planName: meta.name,
      amountUSD: meta.price,
      provider,
      status: 'pending'
    });

    if(provider === 'stripe'){
      // create Stripe Checkout session
      const line_items = [{
        price_data: {
          currency: 'usd',
          product_data: { name: meta.name },
          unit_amount: Math.round(meta.price * 100)
        },
        quantity: 1
      }];
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        line_items,
        success_url: `${process.env.BASE_URL || 'http://localhost:3000'}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.BASE_URL || 'http://localhost:3000'}/cancel`,
        metadata: { purchaseId: purchase._id.toString() }
      });
      // save provider data
      purchase.providerData = { stripeSessionId: session.id };
      await purchase.save();
      return res.json({ ok:true, url: session.url });
    } else if(provider === 'coinpayments'){
      // create CoinPayments transaction (convert USD -> BTC by letting CP handle conversion)
      const amount = meta.price.toString();
      const tx = await cpClient.createTransaction({
        currency1: 'USD',
        currency2: 'BTC',
        amount,
        buyer_email: userEmail || '',
        custom: purchase._id.toString(),
        ipn_url: `${process.env.BASE_URL || 'http://localhost:3000'}/ipn/coinpayments`
      });
      purchase.providerData = { coinpayments_tx: tx };
      await purchase.save();
      return res.json({ ok:true, url: tx.status_url });
    } else {
      return res.status(400).json({ok:false, message:'unknown provider'});
    }
  }catch(err){
    console.error(err);
    return res.status(500).json({ok:false, message: err.message});
  }
});

// Stripe webhook (raw body needed)
app.post('/webhook/stripe', express.raw({type: 'application/json'}), async (req,res)=>{
  const sig = req.headers['stripe-signature'];
  let event;
  try{
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  }catch(err){
    console.error('Stripe webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  // Handle the checkout.session.completed event
  if(event.type === 'checkout.session.completed'){
    const session = event.data.object;
    const purchaseId = session.metadata && session.metadata.purchaseId;
    if(purchaseId){
      const purchase = await Purchase.findById(purchaseId);
      if(purchase){
        purchase.status = 'paid';
        purchase.providerData = purchase.providerData || {};
        purchase.providerData.stripe = session;
        // set expiry based on plan days
        const plan = PLAN_META[purchase.planKey] || { days: 30 };
        const expiresAt = new Date(Date.now() + (plan.days || 30) * 24 * 3600 * 1000);
        purchase.expiresAt = expiresAt;
        await purchase.save();
        console.log('Purchase marked paid (stripe):', purchaseId);
      }
    }
  }
  res.json({received:true});
});

// CoinPayments IPN endpoint (raw body for HMAC verification)
app.post('/ipn/coinpayments', express.raw({type: '*/*'}), async (req,res)=>{
  try{
    const raw = req.body.toString();
    const hmac = req.headers['hmac'] || req.headers['HMAC'] || req.headers['Hmac'];
    if(!hmac){
      console.warn('Missing HMAC header on coinpayments IPN');
      return res.status(400).send('No HMAC');
    }
    const expected = crypto.createHmac('sha512', process.env.COINPAYMENTS_PRIVATE_KEY || '').update(raw).digest('hex');
    if(expected !== hmac){
      console.warn('HMAC mismatch for coinpayments IPN');
      return res.status(400).send('HMAC mismatch');
    }
    // parse urlencoded body
    const params = new URLSearchParams(raw);
    const status = parseInt(params.get('status') || '0');
    const custom = params.get('custom'); // our purchaseId
    if(custom){
      const purchase = await Purchase.findById(custom);
      if(purchase){
        // CoinPayments status codes: >=100 or ==2 means complete (see docs)
        if(status >= 100 || status === 2){
          purchase.status = 'paid';
          const plan = PLAN_META[purchase.planKey] || { days: 30 };
          const expiresAt = new Date(Date.now() + (plan.days || 30) * 24 * 3600 * 1000);
          purchase.expiresAt = expiresAt;
          purchase.providerData = purchase.providerData || {};
          purchase.providerData.coinpayments = Object.fromEntries(params);
          await purchase.save();
          console.log('Purchase marked paid (coinpayments):', purchase._id.toString());
        } else {
          // update provider data for other statuses
          purchase.providerData = purchase.providerData || {};
          purchase.providerData.lastIPN = Object.fromEntries(params);
          await purchase.save();
        }
      }
    }
    // respond 200 to acknowledge
    res.send('OK');
  }catch(err){
    console.error('IPN error', err);
    res.status(500).send('Server error');
  }
});

// create withdrawal request (requires later admin approval)
// Expected body: { address, amount, userEmail (optional) }
app.post('/api/withdraw', async (req,res)=>{
  try{
    const { address, amount, userEmail } = req.body;
    if(!address || !amount) return res.status(400).json({ok:false, message:'address and amount required'});
    // In production: validate user identity, check balances, rate-limit requests, etc.
    const w = await Withdrawal.create({
      userEmail: userEmail || null,
      address,
      amountUSD: Number(amount),
      feeUSD: 2,
      status: 'pending'
    });
    return res.json({ok:true, message:`تم إنشاء طلب سحب بمبلغ ${amount} USD. في انتظار موافقة الإدارة.`, withdrawalId: w._id});
  }catch(err){
    console.error('withdraw error', err);
    return res.status(500).json({ok:false, message:err.message});
  }
});

// ---------- Admin middleware & endpoints ----------
// Simple token-based admin auth. Set ADMIN_TOKEN in .env
function adminAuth(req, res, next){
  const token = req.headers['x-admin-token'] || req.query.admin_token;
  if(!token || token !== process.env.ADMIN_TOKEN){
    return res.status(401).json({ok:false, message:'Unauthorized - admin token required'});
  }
  next();
}

// Admin: list users
app.get('/admin/api/users', adminAuth, async (req,res)=>{
  const users = await User.find().sort({createdAt:-1}).limit(1000);
  res.json(users);
});

// Admin: list purchases
app.get('/admin/api/purchases', adminAuth, async (req,res)=>{
  const purchases = await Purchase.find().sort({createdAt:-1}).limit(1000);
  res.json(purchases);
});

// Admin: list withdrawals
app.get('/admin/api/withdrawals', adminAuth, async (req,res)=>{
  const list = await Withdrawal.find().sort({createdAt:-1}).limit(1000);
  res.json(list);
});

// Admin: approve withdrawal - mark as approved (admin must manually process payment off-chain)
app.post('/admin/api/withdrawals/:id/approve', adminAuth, async (req,res)=>{
  const id = req.params.id;
  const note = req.body.note || '';
  const w = await Withdrawal.findById(id);
  if(!w) return res.status(404).json({ok:false, message:'not found'});
  w.status = 'approved';
  w.adminNote = note;
  w.processedAt = new Date();
  await w.save();
  // In production: trigger payment to wallet, update status to 'paid' when completed.
  res.json({ok:true, message:'withdrawal approved', withdrawal: w});
});

// Admin: reject withdrawal
app.post('/admin/api/withdrawals/:id/reject', adminAuth, async (req,res)=>{
  const id = req.params.id;
  const note = req.body.note || '';
  const w = await Withdrawal.findById(id);
  if(!w) return res.status(404).json({ok:false, message:'not found'});
  w.status = 'rejected';
  w.adminNote = note;
  w.processedAt = new Date();
  await w.save();
  res.json({ok:true, message:'withdrawal rejected', withdrawal: w});
});

// debug endpoint
app.get('/api/debug/purchases', async (req,res)=>{
  const list = await Purchase.find().sort({createdAt:-1}).limit(200);
  res.json(list);
});

const port = process.env.PORT || 3000;
app.listen(port, ()=>console.log('Server running on port', port));
// NOTE: auto-pay approve endpoint patch could not be applied automatically.
