require('dotenv').config();
const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const db = require('./firebase');

// ⚙️ কনফিগারেশন
const PORT = process.env.PORT || 3000;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const DOMAIN = process.env.RENDER_EXTERNAL_URL;
const BOT_TOKEN = process.env.BOT_TOKEN;
const REFERRAL_BONUS = 50; // রেফার বোনাস

const app = express();
const bot = new Telegraf(BOT_TOKEN);

app.use(express.json());
app.use(express.static('public'));

// 🧠 অ্যাডমিন স্টেট (উইজার্ড এবং ম্যানেজমেন্টের জন্য)
const adminState = {};

// ============================================================
// 🛠 হেল্পার ফাংশন (Database Helpers)
// ============================================================

async function getUser(uid) {
    try {
        const snap = await db.ref(`users/${uid}`).once('value');
        return snap.val();
    } catch (e) {
        console.error("DB Error (getUser):", e);
        return null;
    }
}

async function updateUserBalance(uid, amount) {
    try {
        const userRef = db.ref(`users/${uid}/balance`);
        await userRef.transaction((current) => (current || 0) + amount);
    } catch (e) {
        console.error("DB Error (updateBalance):", e);
    }
}

// প্রোডাক্ট লিস্ট (নতুন প্রোডাক্ট সবার আগে)
async function getActiveProducts() {
    try {
        const snap = await db.ref('products').orderByChild('active').equalTo(true).once('value');
        const data = snap.val();
        if (!data) return [];
        return Object.keys(data).map(key => ({
            id: key,
            ...data[key]
        })).reverse();
    } catch (e) {
        console.error("DB Error (getProducts):", e);
        return [];
    }
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
            let referrerId = null;
            
            // রেফারেল লজিক
            if (ctx.startPayload && ctx.startPayload != uid && !isNaN(ctx.startPayload)) {
                referrerId = parseInt(ctx.startPayload);
                await updateUserBalance(referrerId, REFERRAL_BONUS);
                await db.ref(`users/${referrerId}/referrals`).transaction(c => (c || 0) + 1);
                try {
                    await bot.telegram.sendMessage(referrerId, `🎉 <b>New Referral!</b>\nএকজন আপনার লিংকে জয়েন করেছে। আপনি <b>${REFERRAL_BONUS} Coins</b> পেয়েছেন।`, {parse_mode: 'HTML'});
                } catch(e){}
            }

            await ref.set({
                firstName: ctx.from.first_name,
                username: ctx.from.username || 'none',
                balance: 0,
                joinedAt: Date.now(),
                referredBy: referrerId
            });
        }
    }
    
    // অ্যাডমিন উইজার্ড হ্যান্ডলার (Crash Fix)
    if (ctx.from && ctx.from.id === ADMIN_ID && adminState[ADMIN_ID] && ctx.message) {
        return handleAdminWizard(ctx);
    }

    return next();
});

// ============================================================
// 🎨 মেনু ডিজাইন (Always Visible Buttons)
// ============================================================

const getMainMenu = (isAdmin) => {
    let buttons = [
        [Markup.button.callback('🛍 Source Codes', 'menu_source')],
        [Markup.button.callback('🤝 Refer & Earn', 'menu_refer'), Markup.button.callback('💰 Wallet', 'menu_wallet')],
        [Markup.button.callback('📂 My Library', 'menu_library'), Markup.button.callback('💬 Support', 'menu_support')]
    ];
    
    // শুধুমাত্র অ্যাডমিনের জন্য
    if (isAdmin) buttons.push([Markup.button.callback('👑 Admin Panel', 'admin_panel')]);
    
    return Markup.inlineKeyboard(buttons);
};

// কমান্ড হ্যান্ডলার
bot.command('start', async (ctx) => await sendHome(ctx));
bot.command('source_codes', (ctx) => ctx.triggerAction('menu_source'));
bot.command('refer', (ctx) => ctx.triggerAction('menu_refer'));
bot.command('wallet', (ctx) => ctx.triggerAction('menu_wallet'));
bot.command('support', (ctx) => ctx.triggerAction('menu_support'));

// হোম পেজ ফাংশন
async function sendHome(ctx) {
    try { 
        if(ctx.callbackQuery) await ctx.deleteMessage(); 
    } catch(e){} 
    
    const user = await getUser(ctx.from.id);
    const balance = user ? user.balance : 0;
    
    const msg = `🔰 <b>Laga Code - Premium Store</b>\n\n` +
                `👋 হ্যালো <b>${ctx.from.first_name}</b>,\n` +
                `আপনার ব্যালেন্স: <b>${balance} Coins</b>\n\n` +
                `নিচের বাটন থেকে আপনার পছন্দের সোর্স কোড সংগ্রহ করুন 👇`;
    
    await ctx.replyWithHTML(msg, getMainMenu(ctx.from.id === ADMIN_ID));
}

// ============================================================
// 🛍 সোর্স কোড শপ (View Products)
// ============================================================

bot.action('menu_source', async (ctx) => {
    await ctx.deleteMessage().catch(e => {});
    await showProductIndex(ctx, 0);
});

bot.action(/view_index_(\d+)/, async (ctx) => {
    const index = parseInt(ctx.match[1]);
    await showProductIndex(ctx, index);
});

async function showProductIndex(ctx, index) {
    const products = await getActiveProducts();

    if (products.length === 0) {
        return ctx.replyWithHTML("⚠️ দোকানে এখন কোনো প্রোডাক্ট নেই।", getMainMenu(ctx.from.id === ADMIN_ID));
    }

    if (index < 0) index = 0;
    if (index >= products.length) index = products.length - 1;

    const p = products[index];

    const caption = `💻 <b>${p.title}</b>\n\n` +
                    `${p.description}\n\n` +
                    `➖➖➖➖➖➖➖➖\n` +
                    `💰 দাম: <b>${p.price} Coins</b>\n` +
                    `📦 ভার্সন: ${p.version}\n` +
                    `🛠 টেকনোলজি: ${p.tech}`;

    // বাটন তৈরি
    const btnBuy = [Markup.button.callback(`🛒 কিনুন (${p.price} 🪙)`, `buy_${p.id}`)];
    
    // নেভিগেশন বাটন
    const btnNav = [];
    if (index > 0) btnNav.push(Markup.button.callback('⬅️ আগে', `view_index_${index - 1}`));
    if (index < products.length - 1) btnNav.push(Markup.button.callback('পরে ➡️', `view_index_${index + 1}`));
    
    const btnBack = [Markup.button.callback('🔙 হোম', 'home_cmd')];

    const keyboard = Markup.inlineKeyboard([btnBuy, btnNav, btnBack]);

    try {
        // আগের মেসেজ এডিট করার চেষ্টা
        if (ctx.callbackQuery && ctx.callbackQuery.message.photo) {
            await ctx.editMessageMedia({
                type: 'photo',
                media: p.imageId || 'https://via.placeholder.com/800x400',
                caption: caption,
                parse_mode: 'HTML'
            }, keyboard);
        } else if (ctx.callbackQuery && ctx.callbackQuery.message.text) {
            // টেক্সট মেসেজ থাকলে ডিলিট করে নতুন পাঠাবে
            await ctx.deleteMessage();
            await ctx.replyWithPhoto(p.imageId, { caption: caption, parse_mode: 'HTML', ...keyboard });
        } else {
            await ctx.replyWithPhoto(p.imageId, { caption: caption, parse_mode: 'HTML', ...keyboard });
        }
    } catch (e) {
        // এরর হলে ফ্রেশ মেসেজ
        try { await ctx.deleteMessage(); } catch(err){}
        await ctx.replyWithPhoto(p.imageId, { caption: caption, parse_mode: 'HTML', ...keyboard });
    }
}

// 🛒 কেনার লজিক
bot.action(/buy_(.+)/, async (ctx) => {
    const prodId = ctx.match[1];
    const uid = ctx.from.id;
    const user = await getUser(uid);
    
    // প্রোডাক্ট ডাটা আনা
    const pSnap = await db.ref(`products/${prodId}`).once('value');
    if (!pSnap.exists()) return ctx.answerCbQuery("প্রোডাক্ট পাওয়া যায়নি।", { show_alert: true });
    const p = pSnap.val();

    // ১. অলরেডি কেনা আছে কিনা
    const owned = await db.ref(`purchases/${uid}/${prodId}`).once('value');
    if (owned.exists()) {
        return ctx.answerCbQuery("✅ এটি আপনার কেনা আছে!", { show_alert: true });
    }

    // ২. ব্যালেন্স চেক
    if (!user || user.balance < p.price) {
        const shortAmount = p.price - (user ? user.balance : 0);
        const adUrl = `${DOMAIN}/ads.html?uid=${uid}`;
        
        await ctx.deleteMessage().catch(e => {});
        return ctx.replyWithHTML(
            `⚠️ <b>পর্যাপ্ত ব্যালেন্স নেই!</b>\n\n` +
            `এই কোডটি কিনতে আরো <b>${shortAmount} Coins</b> লাগবে।\n` +
            `অ্যাড দেখে ফ্রি কয়েন আয় করুন 👇`,
            Markup.inlineKeyboard([
                [Markup.button.webApp('📺 কয়েন আর্ন করুন', adUrl)],
                [Markup.button.callback('🔙 হোম', 'home_cmd')]
            ])
        );
    }

    // ৩. পেমেন্ট সফল
    await updateUserBalance(uid, -p.price);
    await db.ref(`purchases/${uid}/${prodId}`).set({ purchasedAt: Date.now(), price: p.price });
    
    await ctx.deleteMessage().catch(e => {});
    await ctx.replyWithHTML(
        `🎉 <b>কেনাকাটা সফল হয়েছে!</b>\n\n` +
        `📦 <b>${p.title}</b>\n` +
        `🔗 ডাউনলোড লিংক: ${p.link}\n\n` +
        `<i>লিংকটি 'My Library' তেও সেভ করা হয়েছে।</i>`,
        Markup.inlineKeyboard([[Markup.button.callback('🔙 হোম', 'home_cmd')]])
    );
});

// ============================================================
// 🤝 রেফারেল সিস্টেম
// ============================================================

bot.action('menu_refer', async (ctx) => {
    const uid = ctx.from.id;
    const user = await getUser(uid);
    const botUser = await bot.telegram.getMe();
    
    const refLink = `https://t.me/${botUser.username}?start=${uid}`;
    const totalRefs = (user && user.referrals) ? user.referrals : 0;

    const msg = `🤝 <b>Refer & Earn</b>\n\n` +
                `প্রতি রেফারে পান <b>${REFERRAL_BONUS} Coins</b>!\n\n` +
                `👤 আপনার রেফার: <b>${totalRefs} জন</b>\n` +
                `💰 মোট আর্নিং: <b>${totalRefs * REFERRAL_BONUS} Coins</b>\n\n` +
                `🔗 <b>আপনার লিংক:</b>\n` +
                `<code>${refLink}</code>`;

    await ctx.deleteMessage().catch(e => {});
    ctx.replyWithHTML(msg, Markup.inlineKeyboard([[Markup.button.callback('🔙 হোম', 'home_cmd')]]));
});

// ============================================================
// 💰 ওয়ালেট এবং লাইব্রেরি
// ============================================================

bot.action('menu_wallet', async (ctx) => {
    const user = await getUser(ctx.from.id);
    const adUrl = `${DOMAIN}/ads.html?uid=${ctx.from.id}`;
    
    await ctx.deleteMessage().catch(e => {});
    ctx.replyWithHTML(
        `💰 <b>আপনার ওয়ালেট</b>\n\n` +
        `বর্তমান ব্যালেন্স: <b>${user ? user.balance : 0} Coins</b>\n\n` +
        `ব্যালেন্স বাড়াতে অ্যাড দেখুন 👇`,
        Markup.inlineKeyboard([
            [Markup.button.webApp('📺 ভিডিও দেখুন (+10)', adUrl)],
            [Markup.button.callback('🔙 হোম', 'home_cmd')]
        ])
    );
});

bot.action('menu_library', async (ctx) => {
    const uid = ctx.from.id;
    const purchasesSnap = await db.ref(`purchases/${uid}`).once('value');
    const purchases = purchasesSnap.val();
    
    if (!purchases) {
        return ctx.answerCbQuery("আপনার লাইব্রেরি খালি!", { show_alert: true });
    }

    let msg = "📂 <b>আমার কালেকশন:</b>\n\n";
    const buttons = [];
    
    for (const pid of Object.keys(purchases)) {
        const pSnap = await db.ref(`products/${pid}`).once('value');
        const p = pSnap.val();
        if(p) {
            msg += `🔹 ${p.title}\n`;
            buttons.push([Markup.button.callback(`📥 ${p.title}`, `dl_${pid}`)]);
        }
    }
    buttons.push([Markup.button.callback('🔙 হোম', 'home_cmd')]);
    
    await ctx.deleteMessage().catch(e => {});
    ctx.replyWithHTML(msg, Markup.inlineKeyboard(buttons));
});

bot.action(/dl_(.+)/, async (ctx) => {
    const pid = ctx.match[1];
    const p = (await db.ref(`products/${pid}`).once('value')).val();
    if(p) {
        await ctx.replyWithHTML(`🔗 <b>${p.title}</b>\n\nডাউনলোড লিংক: ${p.link}`);
    }
});

// ============================================================
// 💬 সাপোর্ট
// ============================================================

bot.action('menu_support', async (ctx) => {
    await ctx.deleteMessage().catch(e => {});
    ctx.replyWithHTML(
        `💬 <b>Need Help?</b>\n\n` +
        `যেকোনো সমস্যায় আমাদের সাপোর্ট টিমের সাথে যোগাযোগ করুন।\n\n` +
        `👤 Support: @lagatech`,
        Markup.inlineKeyboard([[Markup.button.url('📩 Message Support', 'https://t.me/lagatech'), [Markup.button.callback('🔙 হোম', 'home_cmd')]]])
    );
});

// হোম এ ফেরার জন্য
bot.action('home_cmd', (ctx) => sendHome(ctx));

// ============================================================
// 👑 অ্যাডমিন প্যানেল (Delete & Management)
// ============================================================

bot.action('admin_panel', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await ctx.deleteMessage().catch(e => {});
    ctx.replyWithHTML("👑 <b>Admin Panel</b>", Markup.inlineKeyboard([
        [Markup.button.callback('➕ প্রোডাক্ট অ্যাড', 'admin_add_start')],
        [Markup.button.callback('🗑 প্রোডাক্ট ডিলিট', 'admin_delete_list')], // নতুন অপশন
        [Markup.button.callback('📢 ব্রডকাস্ট', 'admin_cast_start')],
        [Markup.button.callback('🔙 হোম', 'home_cmd')]
    ]));
});

// --- ডিলিট প্রোডাক্ট লিস্ট ---
bot.action('admin_delete_list', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const products = await getActiveProducts();
    
    if (products.length === 0) {
        return ctx.answerCbQuery("ডিলিট করার মতো কিছু নেই।", { show_alert: true });
    }

    const buttons = products.map(p => [Markup.button.callback(`🗑 ${p.title}`, `del_confirm_${p.id}`)]);
    buttons.push([Markup.button.callback('🔙 ব্যাক', 'admin_panel')]);

    await ctx.deleteMessage().catch(e => {});
    ctx.replyWithHTML("🗑 <b>প্রোডাক্ট ডিলিট করুন:</b>", Markup.inlineKeyboard(buttons));
});

// --- ডিলিট কনফার্মেশন ---
bot.action(/del_confirm_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const prodId = ctx.match[1];
    
    // ডিলিট করার আগে প্রোডাক্টের নাম জানতে চাইলেও পারি, সরাসরি ডিলিট করা হচ্ছে
    await db.ref(`products/${prodId}`).remove();
    await ctx.answerCbQuery("✅ ডিলিট করা হয়েছে!", { show_alert: true });
    
    // লিস্ট রিফ্রেশ
    return ctx.triggerAction('admin_delete_list'); 
});

// --- প্রোডাক্ট অ্যাড উইজার্ড ---
bot.action('admin_add_start', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    adminState[ADMIN_ID] = { type: 'PRODUCT', step: 'PHOTO', data: {} };
    ctx.reply("📸 <b>ধাপ ১/৫:</b> কভার ফটো পাঠান।");
});

// --- ব্রডকাস্ট উইজার্ড ---
bot.action('admin_cast_start', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    adminState[ADMIN_ID] = { type: 'BROADCAST', step: 'PHOTO', data: {} };
    ctx.reply("📢 <b>ব্রডকাস্ট - ধাপ ১/৩:</b> ছবি পাঠান (না চাইলে 'skip' লিখুন)।");
});

// ============================================================
// 🧞 উইজার্ড হ্যান্ডলার (Chat Logic)
// ============================================================

async function handleAdminWizard(ctx) {
    const state = adminState[ADMIN_ID];
    const text = ctx.message.text || '';
    const msgId = ctx.message.message_id;

    if (state.type === 'BROADCAST') {
        if (state.step === 'PHOTO') {
            if (ctx.message.photo) {
                state.data.photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            }
            state.step = 'TEXT';
            await ctx.reply("📝 মেসেজ টেক্সট লিখুন:");
            return;
        }
        if (state.step === 'TEXT') {
            if (text.toLowerCase() !== 'skip') state.data.text = text;
            state.step = 'BTN';
            await ctx.reply("🔘 বাটন যোগ করবেন? ফরম্যাট: Name|URL (না চাইলে 'skip')");
            return;
        }
        if (state.step === 'BTN') {
            // ব্রডকাস্ট প্রসেস
            const usersSnap = await db.ref('users').once('value');
            const users = usersSnap.val() || {};
            let count = 0;
            
            let extra = { parse_mode: 'HTML' };
            if (text && text.includes('|')) {
                const parts = text.split('|');
                extra.reply_markup = { inline_keyboard: [[{ text: parts[0], url: parts[1] }]] };
            }

            await ctx.reply("⏳ ব্রডকাস্ট শুরু হচ্ছে, অপেক্ষা করুন...");
            
            for (const uid of Object.keys(users)) {
                try {
                    if (state.data.photo) {
                        await bot.telegram.sendPhoto(uid, state.data.photo, { caption: state.data.text || '', ...extra });
                    } else {
                        await bot.telegram.sendMessage(uid, state.data.text || ' ', extra);
                    }
                    count++;
                    // Rate Limiting এর জন্য অল্প বিরতি
                    if(count % 20 === 0) await new Promise(r => setTimeout(r, 1000)); 
                } catch (e) {}
            }
            
            delete adminState[ADMIN_ID];
            await ctx.reply(`✅ শেষ! মোট পাঠানো হয়েছে: ${count} জনকে।`);
        }
        return;
    }

    if (state.type === 'PRODUCT') {
        if (state.step === 'PHOTO') {
            if (ctx.message.photo) {
                state.data.imageId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                state.step = 'TITLE';
                await ctx.reply("📝 টাইটেল লিখুন:");
            } else {
                await ctx.reply("❌ ছবি দিতেই হবে!");
            }
            return;
        }
        if (state.step === 'TITLE') {
            state.data.title = text;
            state.step = 'DESC';
            await ctx.reply("📄 ডেসক্রিপশন লিখুন:");
            return;
        }
        if (state.step === 'DESC') {
            state.data.description = text;
            state.step = 'INFO';
            await ctx.reply("💰 ফরম্যাট: Price|Version|Tech\nউদাহরণ: 500|v2.0|Node.js");
            return;
        }
        if (state.step === 'INFO') {
            const p = text.split('|');
            if(p.length < 3) return ctx.reply("❌ ভুল ফরম্যাট। আবার চেষ্টা করুন।");
            state.data.price = parseInt(p[0]);
            state.data.version = p[1];
            state.data.tech = p[2];
            state.step = 'LINK';
            await ctx.reply("🔗 ডাউনলোড লিংক দিন:");
            return;
        }
        if (state.step === 'LINK') {
            state.data.link = text;
            state.data.active = true;
            await db.ref('products').push(state.data);
            delete adminState[ADMIN_ID];
            await ctx.reply("✅ প্রোডাক্ট সফলভাবে অ্যাড হয়েছে!");
        }
    }
}

// ============================================================
// 🌐 সার্ভার এবং এপিআই
// ============================================================

app.post('/api/reward', async (req, res) => {
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ error: 'No UID' });

    await updateUserBalance(uid, 10);
    const user = await getUser(uid);

    try {
        await bot.telegram.sendMessage(uid, "🎁 <b>+10 Coins Added!</b>", { parse_mode: 'HTML', disable_notification: true });
    } catch(e){}

    res.json({ success: true, newBalance: user ? user.balance : 0 });
});

app.use(bot.webhookCallback('/bot'));

app.listen(PORT, async () => {
    console.log(`Server running on ${PORT}`);
    if (DOMAIN) await bot.telegram.setWebhook(`${DOMAIN}/bot`);
});
