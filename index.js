require('dotenv').config();
const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const db = require('./firebase');

// কনফিগারেশন
const PORT = process.env.PORT || 3000;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const DOMAIN = process.env.RENDER_EXTERNAL_URL;
const BOT_TOKEN = process.env.BOT_TOKEN;
const REFERRAL_BONUS = 50; // রেফার করলে কত কয়েন পাবে

const app = express();
const bot = new Telegraf(BOT_TOKEN);

app.use(express.json());
app.use(express.static('public'));

// 🧠 অ্যাডমিন স্টেট (প্রোডাক্ট অ্যাড ও ব্রডকাস্টের জন্য)
const adminState = {};

// ============================================================
// 🛠 হেল্পার ফাংশন (Database Helpers)
// ============================================================

async function getUser(uid) {
    const snap = await db.ref(`users/${uid}`).once('value');
    return snap.val();
}

async function updateUserBalance(uid, amount) {
    const userRef = db.ref(`users/${uid}/balance`);
    await userRef.transaction((current) => (current || 0) + amount);
}

// প্রোডাক্ট লিস্ট (নতুন প্রোডাক্ট সবার আগে থাকবে - Reverse)
async function getActiveProducts() {
    const snap = await db.ref('products').orderByChild('active').equalTo(true).once('value');
    const data = snap.val();
    if (!data) return [];
    
    // Object কে Array তে কনভার্ট করে উল্টে দেওয়া হচ্ছে (Newest First)
    return Object.keys(data).map(key => ({
        id: key,
        ...data[key]
    })).reverse();
}

// ============================================================
// 🤖 মিডলওয়্যার এবং ইউজার চেকিং (রেফারেল সহ)
// ============================================================

bot.use(async (ctx, next) => {
    if (ctx.from) {
        const uid = ctx.from.id;
        const ref = db.ref(`users/${uid}`);
        const snap = await ref.once('value');

        if (!snap.exists()) {
            // নতুন ইউজার ডাটাবেসে সেভ করা
            let referrerId = null;
            
            // যদি রেফার লিংকের মাধ্যমে আসে
            if (ctx.startPayload && ctx.startPayload != uid) {
                referrerId = parseInt(ctx.startPayload);
                // যে রেফার করেছে তাকে বোনাস দেওয়া
                await updateUserBalance(referrerId, REFERRAL_BONUS);
                await db.ref(`users/${referrerId}/referrals`).transaction(c => (c || 0) + 1);
                try {
                    await bot.telegram.sendMessage(referrerId, `🎉 <b>New Referral!</b>\nএকজন আপনার লিংকে জয়েন করেছে। আপনি <b>${REFERRAL_BONUS} Coins</b> পেয়েছেন।`, {parse_mode: 'HTML'});
                } catch(e){}
            }

            await ref.set({
                firstName: ctx.from.first_name,
                username: ctx.from.username || 'none',
                balance: 0, // ডিফল্ট ব্যালেন্স
                joinedAt: Date.now(),
                referredBy: referrerId
            });
        }
    }
    
    // অ্যাডমিন উইজার্ড হ্যান্ডলার (CRASH FIX: Check if ctx.message exists)
    // এখানে ctx.message চেক করা হয়েছে যাতে বাটনে চাপ দিলে ক্র্যাশ না হয়
    if (ctx.from && ctx.from.id === ADMIN_ID && adminState[ADMIN_ID] && ctx.message) {
        return handleAdminWizard(ctx);
    }

    return next();
});

// ============================================================
// 🏠 মেইন মেনু ডিজাইন
// ============================================================

const getMainMenu = (isAdmin) => {
    let buttons = [
        [Markup.button.callback('🛍 Source Codes (সোর্স কোড)', 'view_index_0')],
        [Markup.button.callback('📂 My Library', 'library'), Markup.button.callback('💰 Wallet & Ads', 'wallet')],
        [Markup.button.callback('🤝 Refer & Earn', 'referral'), Markup.button.callback('💬 Support', 'support')]
    ];
    if (isAdmin) buttons.push([Markup.button.callback('👑 Admin Panel', 'admin_panel')]);
    return Markup.inlineKeyboard(buttons);
};

// কমান্ড হ্যান্ডলার
bot.command(['start', 'home'], async (ctx) => {
    await sendHome(ctx);
});

bot.command('source_codes', (ctx) => ctx.triggerAction('view_index_0'));
bot.command('support', (ctx) => ctx.triggerAction('support'));

// হোম পেজ ফাংশন (Clean UX)
async function sendHome(ctx) {
    try { await ctx.deleteMessage(); } catch(e){} // আগের মেসেজ ক্লিয়ার
    
    const user = await getUser(ctx.from.id);
    const msg = `🔰 <b>Laga Code - Premium Store</b>\n\n` +
                `👋 হ্যালো <b>${ctx.from.first_name}</b>,\n` +
                `আপনার ব্যালেন্স: <b>${user.balance} Coins</b>\n\n` +
                `নিচের মেনু থেকে আপনার পছন্দের সোর্স কোড কিনুন বা অ্যাড দেখে কয়েন ইনকাম করুন। 👇`;
    
    await ctx.replyWithHTML(msg, getMainMenu(ctx.from.id === ADMIN_ID));
}

// ============================================================
// 🛍 শপ সিস্টেম (Newest First + Smart Buy)
// ============================================================

bot.action(/view_index_(\d+)/, async (ctx) => {
    const index = parseInt(ctx.match[1]);
    const products = await getActiveProducts();

    if (products.length === 0) return ctx.answerCbQuery("দোকানে এখন কোনো প্রোডাক্ট নেই।", { show_alert: true });
    if (index < 0 || index >= products.length) return ctx.answerCbQuery("আর কোনো প্রোডাক্ট নেই।");

    const p = products[index];

    // ক্যাপশন ডিজাইন
    const caption = `💻 <b>${p.title}</b>\n\n` +
                    `${p.description}\n\n` +
                    `➖➖➖➖➖➖➖➖\n` +
                    `💰 দাম: <b>${p.price} Coins</b>\n` +
                    `📦 ভার্সন: ${p.version}\n` +
                    `🛠 টেকনোলজি: ${p.tech}`;

    // বাটন ডিজাইন
    const btnBuy = [Markup.button.callback(`🛒 এখনই কিনুন (${p.price} 🪙)`, `buy_${p.id}`)];
    const btnNav = [];
    if (index > 0) btnNav.push(Markup.button.callback('⬅️ আগেরটা', `view_index_${index - 1}`));
    if (index < products.length - 1) btnNav.push(Markup.button.callback('পরেরটা ➡️', `view_index_${index + 1}`));
    const btnBack = [Markup.button.callback('🔙 মেইন মেনু', 'home_clean')];

    const keyboard = Markup.inlineKeyboard([btnBuy, btnNav, btnBack]);

    // ছবি আপডেট করা (Flicker কমাবে)
    try {
        if (ctx.callbackQuery.message.photo) {
            await ctx.editMessageMedia({
                type: 'photo',
                media: p.imageId || 'https://via.placeholder.com/800x400',
                caption: caption,
                parse_mode: 'HTML'
            }, keyboard);
        } else {
            await ctx.deleteMessage();
            await ctx.replyWithPhoto(p.imageId, { caption: caption, parse_mode: 'HTML', ...keyboard });
        }
    } catch (e) {
        // এরর হলে নতুন করে পাঠানো
        await ctx.deleteMessage();
        await ctx.replyWithPhoto(p.imageId, { caption: caption, parse_mode: 'HTML', ...keyboard });
    }
});

// 🛒 কেনার লজিক (ব্যালেন্স না থাকলে অ্যাড পেজে নিবে)
bot.action(/buy_(.+)/, async (ctx) => {
    const prodId = ctx.match[1];
    const uid = ctx.from.id;
    const user = await getUser(uid);
    const p = (await db.ref(`products/${prodId}`).once('value')).val();

    // ১. অলরেডি কেনা আছে কিনা চেক
    const owned = await db.ref(`purchases/${uid}/${prodId}`).once('value');
    if (owned.exists()) {
        return ctx.answerCbQuery("✅ এটি আপনার কেনা আছে! 'My Library' চেক করুন।", { show_alert: true });
    }

    // ২. টাকা না থাকলে অ্যাড পেজে পাঠানো
    if (user.balance < p.price) {
        const shortAmount = p.price - user.balance;
        const adUrl = `${DOMAIN}/ads.html?uid=${uid}`;
        
        await ctx.deleteMessage();
        return ctx.replyWithHTML(
            `⚠️ <b>ওহ নো! ব্যালেন্স কম।</b>\n\n` +
            `এই কোডটি কিনতে আরো <b>${shortAmount} Coins</b> লাগবে।\n` +
            `নিচে ক্লিক করে অ্যাড দেখে কয়েন ইনকাম করুন 👇`,
            Markup.inlineKeyboard([
                [Markup.button.webApp('📺 ভিডিও দেখে কয়েন নিন', adUrl)],
                [Markup.button.callback('🔙 পরে কিনব', 'view_index_0')]
            ])
        );
    }

    // ৩. কেনাকাটা সফল
    await updateUserBalance(uid, -p.price);
    await db.ref(`purchases/${uid}/${prodId}`).set({ purchasedAt: Date.now(), price: p.price });
    
    await ctx.replyWithHTML(
        `🎉 <b>অভিনন্দন! কেনাকাটা সফল।</b>\n\n` +
        `📦 <b>${p.title}</b>\n` +
        `🔗 ডাউনলোড লিংক: ${p.link}\n\n` +
        `<i>এটি আপনার 'My Library' তে সেভ করা হয়েছে।</i>`
    );
});

// ============================================================
// 🤝 রেফারেল সিস্টেম (Replaces Help)
// ============================================================

bot.action('referral', async (ctx) => {
    const uid = ctx.from.id;
    const user = await getUser(uid);
    const botUser = await bot.telegram.getMe();
    
    const refLink = `https://t.me/${botUser.username}?start=${uid}`;
    const totalRefs = (await db.ref(`users/${uid}/referrals`).once('value')).val() || 0;

    const msg = `🤝 <b>Refer & Earn Program</b>\n\n` +
                `আপনার বন্ধুদের ইনভাইট করুন এবং প্রতি রেফারে জিতে নিন <b>${REFERRAL_BONUS} Coins</b>!\n\n` +
                `📊 <b>আপনার স্ট্যাটাস:</b>\n` +
                `• মোট রেফার: <b>${totalRefs} জন</b>\n` +
                `• মোট আর্নিং: <b>${totalRefs * REFERRAL_BONUS} Coins</b>\n\n` +
                `👇 <b>আপনার রেফারেল লিংক:</b>\n` +
                `<code>${refLink}</code>\n\n` +
                `<i>(লিংকটি কপি করে বন্ধুদের শেয়ার করুন)</i>`;

    try { await ctx.deleteMessage(); } catch(e){}
    ctx.replyWithHTML(msg, Markup.inlineKeyboard([[Markup.button.callback('🔙 ব্যাক', 'home_clean')]]));
});

// ============================================================
// 💰 ওয়ালেট এবং লাইব্রেরি
// ============================================================

bot.action('wallet', async (ctx) => {
    const user = await getUser(ctx.from.id);
    const adUrl = `${DOMAIN}/ads.html?uid=${ctx.from.id}`;
    
    try { await ctx.deleteMessage(); } catch(e){}
    ctx.replyWithHTML(
        `💰 <b>আপনার ওয়ালেট</b>\n\n` +
        `বর্তমান ব্যালেন্স: <b>${user.balance} Coins</b>\n\n` +
        `কয়েন শেষ? নিচে ক্লিক করে আনলিমিটেড অ্যাড দেখুন 👇`,
        Markup.inlineKeyboard([
            [Markup.button.webApp('📺 আনলিমিটেড কয়েন ইনকাম', adUrl)],
            [Markup.button.callback('🔙 ব্যাক', 'home_clean')]
        ])
    );
});

bot.action('library', async (ctx) => {
    const purchases = (await db.ref(`purchases/${ctx.from.id}`).once('value')).val();
    if (!purchases) return ctx.answerCbQuery("আপনার লাইব্রেরি খালি। আগে কিছু কিনুন!", { show_alert: true });

    let msg = "📂 <b>আমার সোর্স কোড কালেকশন:</b>\n\n";
    const buttons = [];
    
    for (const pid of Object.keys(purchases)) {
        const p = (await db.ref(`products/${pid}`).once('value')).val();
        if(p) {
            msg += `🔹 ${p.title}\n`;
            buttons.push([Markup.button.callback(`📥 ডাউনলোড ${p.title}`, `dl_${pid}`)]);
        }
    }
    buttons.push([Markup.button.callback('🔙 ব্যাক', 'home_clean')]);
    
    try { await ctx.deleteMessage(); } catch(e){}
    ctx.replyWithHTML(msg, Markup.inlineKeyboard(buttons));
});

bot.action(/dl_(.+)/, async (ctx) => {
    const pid = ctx.match[1];
    const p = (await db.ref(`products/${pid}`).once('value')).val();
    ctx.replyWithHTML(`🔗 <b>${p.title}</b>\n\nডাউনলোড লিংক: ${p.link}`);
});

bot.action('home_clean', (ctx) => sendHome(ctx));

// ============================================================
// 👑 অ্যাডমিন প্যানেল এবং ব্রডকাস্ট
// ============================================================

bot.action('admin_panel', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    try { await ctx.deleteMessage(); } catch(e){}
    ctx.replyWithHTML("👑 <b>Admin Control Center</b>", Markup.inlineKeyboard([
        [Markup.button.callback('➕ নতুন প্রোডাক্ট', 'admin_add_start')],
        [Markup.button.callback('📢 ব্রডকাস্ট মেসেজ', 'admin_cast_start')],
        [Markup.button.callback('🔙 হোম', 'home_clean')]
    ]));
});

// --- ব্রডকাস্ট উইজার্ড ---
bot.action('admin_cast_start', (ctx) => {
    adminState[ADMIN_ID] = { type: 'BROADCAST', step: 'PHOTO', data: {} };
    ctx.reply("📢 <b>ব্রডকাস্ট - ধাপ ১/৩:</b>\nএকটি ছবি পাঠান। (যদি ছবি না দিতে চান, লিখুন 'skip')");
});

// --- প্রোডাক্ট অ্যাড উইজার্ড (আগের লজিক ইম্প্রুভড) ---
bot.action('admin_add_start', (ctx) => {
    adminState[ADMIN_ID] = { type: 'PRODUCT', step: 'PHOTO', data: {} };
    ctx.reply("📸 <b>প্রোডাক্ট অ্যাড - ধাপ ১/৫:</b>\nকভার ফটো পাঠান।");
});

// উইজার্ড হ্যান্ডলার ফাংশন
async function handleAdminWizard(ctx) {
    const state = adminState[ADMIN_ID];
    // নিরাপদ টেক্সট রিডিং (ক্র্যাশ ফিক্স)
    const text = ctx.message.text || ''; 

    // 📢 ব্রডকাস্ট লজিক
    if (state.type === 'BROADCAST') {
        if (state.step === 'PHOTO') {
            if (ctx.message.photo) state.data.photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            state.step = 'TEXT';
            ctx.reply("📝 <b>ব্রডকাস্ট - ধাপ ২/৩:</b>\nমেসেজ টেক্সট লিখুন। (না চাইলে 'skip' লিখুন, কিন্তু ছবি না থাকলে টেক্সট দিতেই হবে)");
            return;
        }
        if (state.step === 'TEXT') {
            if (text.toLowerCase() !== 'skip') state.data.text = text;
            state.step = 'BTN';
            ctx.reply("🔘 <b>ব্রডকাস্ট - ধাপ ৩/৩:</b>\nবাটন যোগ করবেন?\nফরম্যাট: Button Name|URL\n(না চাইলে 'skip' বা 'send' লিখুন)");
            return;
        }
        if (state.step === 'BTN') {
            // সেন্ডিং প্রসেস
            const usersSnap = await db.ref('users').once('value');
            const users = usersSnap.val();
            let count = 0;
            
            let extra = { parse_mode: 'HTML' };
            if (text && text.includes('|')) {
                const parts = text.split('|');
                extra.reply_markup = { inline_keyboard: [[{ text: parts[0], url: parts[1] }]] };
            }

            ctx.reply("⏳ ব্রডকাস্ট শুরু হচ্ছে...");
            
            for (const uid of Object.keys(users)) {
                try {
                    if (state.data.photo) {
                        await bot.telegram.sendPhoto(uid, state.data.photo, { caption: state.data.text || '', ...extra });
                    } else if (state.data.text) {
                        await bot.telegram.sendMessage(uid, state.data.text, extra);
                    }
                    count++;
                } catch (e) {}
            }
            
            delete adminState[ADMIN_ID];
            ctx.reply(`✅ ব্রডকাস্ট সম্পন্ন! মোট পাঠানো হয়েছে: ${count} জনকে।`);
        }
        return;
    }

    // ➕ প্রোডাক্ট অ্যাড লজিক
    if (state.type === 'PRODUCT') {
        if (state.step === 'PHOTO') {
            if (ctx.message.photo) {
                state.data.imageId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                state.step = 'TITLE';
                ctx.reply("📝 টাইটেল লিখুন:");
            } else ctx.reply("❌ ছবি পাঠান!");
            return;
        }
        if (state.step === 'TITLE') {
            state.data.title = text;
            state.step = 'DESC';
            ctx.reply("📄 ডেসক্রিপশন লিখুন:");
            return;
        }
        if (state.step === 'DESC') {
            state.data.description = text;
            state.step = 'INFO';
            ctx.reply("💰 ফরম্যাট: Price|Version|Tech\nউদাহরণ: 500|v2.0|Node.js");
            return;
        }
        if (state.step === 'INFO') {
            const p = text.split('|');
            if(p.length < 3) return ctx.reply("ভুল ফরম্যাট। আবার চেষ্টা করুন।");
            state.data.price = parseInt(p[0]);
            state.data.version = p[1];
            state.data.tech = p[2];
            state.step = 'LINK';
            ctx.reply("🔗 ডাউনলোড লিংক দিন:");
            return;
        }
        if (state.step === 'LINK') {
            state.data.link = text;
            state.data.active = true;
            await db.ref('products').push(state.data);
            delete adminState[ADMIN_ID];
            ctx.reply("✅ প্রোডাক্ট সফলভাবে অ্যাড হয়েছে!");
        }
    }
}

// ============================================================
// 🌐 সার্ভার এবং এপিআই
// ============================================================

// অ্যাড রিওয়ার্ড API (উইন্ডো বন্ধ হবে না, শুধু ব্যালেন্স বাড়বে)
app.post('/api/reward', async (req, res) => {
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ error: 'No UID' });

    await updateUserBalance(uid, 10); // প্রতি অ্যাডে ১০ কয়েন
    const user = await getUser(uid);

    // ইউজারকে নোটিফিকেশন পাঠানো (সাইলেন্টলি)
    try {
        await bot.telegram.sendMessage(uid, "🎁 +10 Coins Added!", { disable_notification: true });
    } catch(e){}

    res.json({ success: true, newBalance: user.balance });
});

app.use(bot.webhookCallback('/bot'));

app.listen(PORT, async () => {
    console.log(`Server running on ${PORT}`);
    if (DOMAIN) await bot.telegram.setWebhook(`${DOMAIN}/bot`);
});
