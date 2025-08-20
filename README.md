# Bitcoin Mining Site - Ready for GitHub

هذه نسخة جاهزة للرفع على GitHub تحتوي على واجهة بانورامية (three.js) مع تكامل دفعات عبر **Stripe** و **CoinPayments**.

## ملفات مهمة
- `server.js` — الخادم الرئيسي (Express + Mongoose + Stripe + CoinPayments).
- `public/index.html` — الواجهة الأمامية (panorama + خطط + أزرار دفع).
- `models/User.js`, `models/Purchase.js` — نماذج Mongoose.
- `.env.example` — إعدادات البيئة (انسخ إلى `.env` واملأ المفاتيح).

## تشغيل محلي
1. انسخ المستودع أو افتح المجلد:
```bash
cd bitcoin-mining-site
npm install
cp .env.example .env
# عدّل .env بالقيم الحقيقية (Stripe, CoinPayments, MongoDB, BASE_URL)
node server.js
```
2. أثناء التطوير يمكنك استخدام `ngrok` لعرض الخادم عبر الإنترنت وتسجيل عناوين Webhook في لوحة Stripe وIPN في CoinPayments.

## روابط مساعدة
- Stripe Checkout / Webhooks — تحتاج لتكوين `STRIPE_WEBHOOK_SECRET` بعد إعداد endpoint.  
- CoinPayments — استخدم عنوان IPN (Callback URL) إلى `/ipn/coinpayments`.

> **تنبيه قانوني:** قبل استقبال أموال حقيقية تأكد من الامتثال القانوني (KYC/AML)، تأمين البنية التحتية، واختبارات أمان شاملة.

## لوحة الإدارة (Admin)

- ملف الواجهة: `public/admin.html`.
- لتفعيل الوصول للوحة يجب وضع متغير بيئة `ADMIN_TOKEN` في `.env` (على سبيل المثال: `ADMIN_TOKEN=secrettoken123`).
- استخدم `public/admin.html` وأدخل `ADMIN_TOKEN` عندما يُطلب منك ذلك لتحميل الطلبات والموافقة/الرفض.

**ملاحظة:** هذه واجهة بسيطة لإدارة التشغيل. في بيئة إنتاج حقيقية استخدم نظام مصادقة قوي (OAuth2 أو JWT + حسابات مشرفين) بدلاً من رمز ثابت.


## الدفع التلقائي TRC20 عند الموافقة (Auto-pay)

- يمكنك تفعيل الدفع التلقائي عند موافقة الإدارة بتعيين `ADMIN_AUTO_PAY=true` في ملف `.env`.
- يجب ضبط متغيرات Tron وTRC20 في `.env`:
```
TRON_PRIVATE_KEY=...            # مفتاح خاص للمحفظة التي سترسل الأموال
TRC20_CONTRACT_ADDRESS=...     # عقد التوكن (مثال USDT-TRC20)
TRC20_DECIMALS=6
TRC20_USD_RATE=1               # سعر 1 توكن مقابل USD (مثلاً USDT=1)
```
- عند الموافقة، يقوم الخادم بحساب صافي المبلغ (amount - fee) وتحويله إلى توكن بالإعتماد على `TRC20_USD_RATE` ثم إرسال المعاملة.
- **واحذر:** المفتاح الخاص يجب أن يُخزّن بأمان جداً ولا تضَعْه في مستودع عام.

### العنوان الذي طلبت إضافته
أضفت ملاحظة أن عنوان المحفظة المُستلم سيتم استخدامه من بيانات طلب السحب. كما يمكنك تعيين محفظة إيداع افتراضية لكل عمليات الدفع في واجهة المستخدم أو في DB.

