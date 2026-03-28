require('dotenv').config();
const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const db = require('./firebase');

// ⚙️ Configuration
const PORT = process.env.PORT || 3000;
const ADMIN_ID = parseInt(process.env.ADMIN_ID); // Render Environment থেকে নিবে
const DOMAIN = process.env.RENDER_EXTERNAL_URL; // Render অটো দিবে
const BOT_TOKEN = process.env.BOT_TOKEN; // Render Environment থেকে নিবে
const REFERRAL_BONUS = 50;

if (!BOT_TOKEN || !ADMIN_ID) {
    console.error("Error: BOT_TOKEN or ADMIN_ID is missing in .env");
    process.exit(1);
}

const app = express();
const bot = new Telegraf(BOT_TOKEN);

app.use(express.json());
app.use(express.static('public'));

// 🧠 Admin State for Wizards
const adminState = {};

// ============================================================
// 🛠 Helper Functions
// ============================================================

// Fancy Text Converter (Small Caps)
const fancyText = (text) => {
    const map = {
        'a': 'ᴀ', 'b': 'ʙ', 'c': 'ᴄ', 'd': 'ᴅ', 'e': 'ᴇ', 'f': 'ꜰ', 'g': 'ɢ', 'h': 'ʜ',
        'i': 'ɪ', 'j': 'ᴊ', 'k': 'ᴋ', 'l': 'ʟ', 'm': 'ᴍ', 'n': 'ɴ', 'o': 'ᴏ', 'p': 'ᴘ',
        'q': 'ǫ', 'r': 'ʀ', 's': 'ꜱ', 't': 'ᴛ', 'u': 'ᴜ', 'v': 'ᴠ', 'w': 'ᴡ', 'x': 'x',
        'y': 'ʏ', 'z': 'ᴢ'
    };
    return text.toLowerCase().split('').map(c => map[c] || c).join('');
};

async function getUser(uid) {
    try {
        const snap = await db.ref(`users/${uid}`).once('value');
        return snap.val();
    } catch (e) { console.error("DB Error getUser:", e); return null; }
}

async function updateUserBalance(uid, amount) {
    try {
        await db.ref(`users/${uid}/balance`).transaction((current) => (current || 0) + amount);
    } catch (e) { console.error("DB Error updateBalance:", e); }
}

async function getActiveProducts() {
    try {
        const snap = await db.ref('products').orderByChild('active').equalTo(true).once('value');
        const data = snap.val();
        if (!data) return [];
        return Object.keys(data).map(key => ({ id: key, ...data[key] })).reverse();
    } catch (e) { console.error("DB Error getProducts:", e); return []; }
}

// ============================================================
// 🤖 Middleware & Registration
// ============================================================

bot.use(async (ctx, next) => {
    if (ctx.from) {
        const uid = ctx.from.id;
        const snap = await db.ref(`users/${uid}`).once('value');

        if (!snap.exists()) {
            let referrerId = null;
            // Referral Logic
            if (ctx.startPayload && ctx.startPayload != uid && !isNaN(ctx.startPayload)) {
                referrerId = parseInt(ctx.startPayload);
                await updateUserBalance(referrerId, REFERRAL_BONUS);
                await db.ref(`users/${referrerId}/referrals`).transaction(c => (c || 0) + 1);
                try {
                    await bot.telegram.sendMessage(referrerId, 
                        `🎉 <b>Nᴇᴡ Rᴇꜰᴇʀʀᴀʟ Jᴏɪɴᴇᴅ!</b>\n💰 Yᴏᴜ Iɴꜱᴛᴀɴᴛʟʏ Rᴇᴄᴇɪᴠᴇᴅ <b>+${REFERRAL_BONUS} Cᴏɪɴꜱ</b>!`, 
                        { parse_mode: 'HTML' }
                    );
                } catch (e) {}
            }

            await db.ref(`users/${uid}`).set({
                firstName: ctx.from.first_name,
                username: ctx.from.username || 'none',
                balance: 0,
                joinedAt: Date.now(),
                referredBy: referrerId
            });
        }
    }

    // Admin Wizard Handler
    if (ctx.from && ctx.from.id === ADMIN_ID && adminState[ADMIN_ID] && ctx.message) {
        return handleAdminWizard(ctx);
    }

    return next();
});

// ============================================================
// 🎨 Keyboards & Menus
// ============================================================

const getMainMenu = (isAdmin) => {
    let buttons = [
        [Markup.button.callback('🛒 Sᴏᴜʀᴄᴇ Cᴏᴅᴇꜱ', 'menu_shop')],
        [Markup.button.callback('🤝 Rᴇꜰᴇʀ & Eᴀʀɴ', 'menu_refer'), Markup.button.callback('💰 Wᴀʟʟᴇᴛ', 'menu_wallet')],
        [Markup.button.callback('📂 Mʏ Lɪʙʀᴀʀʏ', 'menu_library'), Markup.button.callback('💬 Sᴜᴘᴘᴏʀᴛ', 'menu_support')]
    ];
    if (isAdmin) buttons.push([Markup.button.callback('👑 Aᴅᴍɪɴ Pᴀɴᴇʟ', 'admin_panel')]);
    return Markup.inlineKeyboard(buttons);
};

bot.command('start', async (ctx) => await sendHome(ctx));

async function sendHome(ctx) {
    try { if (ctx.callbackQuery) await ctx.deleteMessage(); } catch (e) {}
    const user = await getUser(ctx.from.id);
    const bal = user ? user.balance : 0;
    
    const msg = `👋 Hᴇʟʟᴏ <b>${ctx.from.first_name}</b>!\n\n` +
                `💎 Bᴀʟᴀɴᴄᴇ: <b>${bal} Cᴏɪɴꜱ</b>\n` +
                `🛒 Wᴇʟᴄᴏᴍᴇ ᴛᴏ ᴛʜᴇ Pʀᴇᴍɪᴜᴍ Sᴛᴏʀᴇ.\n\n` +
                `Sᴇʟᴇᴄᴛ ᴀɴ ᴏᴘᴛɪᴏɴ ʙᴇʟᴏᴡ 👇`;
    
    await ctx.replyWithHTML(msg, getMainMenu(ctx.from.id === ADMIN_ID));
}

// ============================================================
// 🛍 SHOP SYSTEM (Catalog -> Detail)
// ============================================================

// Show Catalog List
bot.action('menu_shop', async (ctx) => {
    const products = await getActiveProducts();
    if (products.length === 0) {
        await ctx.answerCbQuery("🚫 Store is empty!", { show_alert: true });
        return ctx.replyWithHTML("<b>🚫 No products available yet.</b>", getMainMenu(ctx.from.id === ADMIN_ID));
    }

    // Create buttons with Titles only
    const buttons = products.map(p => [Markup.button.callback(`📦 ${p.title}`, `view_prod_${p.id}`)]);
    buttons.push([Markup.button.callback('🔙 Back', 'home_cmd')]);

    try { await ctx.deleteMessage(); } catch(e){}
    await ctx.replyWithHTML(
        `<b>🛒 Sᴏᴜʀᴄᴇ Cᴏᴅᴇ Cᴀᴛᴀʟᴏɢ</b>\n\nSelect an item to view details:`,
        Markup.inlineKeyboard(buttons)
    );
});

// Show Product Detail
bot.action(/view_prod_(.+)/, async (ctx) => {
    const prodId = ctx.match[1];
    const pSnap = await db.ref(`products/${prodId}`).once('value');
    if (!pSnap.exists()) return ctx.answerCbQuery("Error: Not found!");
    const p = pSnap.val();

    const caption = `<b>📦 ${p.title}</b>\n\n` +
                    `📝 ${p.description}\n\n` +
                    `➖➖➖➖➖➖➖➖\n` +
                    `💰 Pʀɪᴄᴇ: <b>${p.price} Cᴏɪɴꜱ</b>\n` +
                    `📦 Vᴇʀꜱɪᴏɴ: ${p.version}\n` +
                    `🛠 Tᴇᴄʜ: ${p.tech}`;

    const buttons = Markup.inlineKeyboard([
        [Markup.button.callback(`🛒 Buy Now (${p.price} 🪙)`, `buy_${p.id}`)],
        [Markup.button.callback('🔙 Back to List', 'menu_shop')]
    ]);

    try {
        // If previous message is a photo, edit media. If text, delete and send new.
        if (ctx.callbackQuery.message.photo) {
            await ctx.editMessageMedia({ type: 'photo', media: p.imageId, caption: caption, parse_mode: 'HTML' }, buttons);
        } else {
            await ctx.deleteMessage();
            await ctx.replyWithPhoto(p.imageId, { caption: caption, parse_mode: 'HTML', ...buttons });
        }
    } catch (e) {
        // Fallback if edit fails
        try { await ctx.deleteMessage(); } catch(err){}
        await ctx.replyWithPhoto(p.imageId, { caption: caption, parse_mode: 'HTML', ...buttons });
    }
});

// Buy Logic
bot.action(/buy_(.+)/, async (ctx) => {
    const prodId = ctx.match[1];
    const uid = ctx.from.id;
    const user = await getUser(uid);
    const pSnap = await db.ref(`products/${prodId}`).once('value');
    const p = pSnap.val();

    // Check if already purchased
    const owned = await db.ref(`purchases/${uid}/${prodId}`).once('value');
    if (owned.exists()) return ctx.answerCbQuery("✅ Already Purchased!", { show_alert: true });

    // Check Balance
    if (!user || user.balance < p.price) {
        const short = p.price - (user ? user.balance : 0);
        const adUrl = `${DOMAIN}/ads.html?uid=${uid}`;
        
        try { await ctx.deleteMessage(); } catch(e){}
        return ctx.replyWithHTML(
            `⚠️ <b>Iɴꜱᴜꜰꜰɪᴄɪᴇɴᴛ Bᴀʟᴀɴᴄᴇ!</b>\n\n` +
            `Yᴏᴜ ɴᴇᴇᴅ <b>${short} ᴄᴏɪɴꜱ</b> ᴍᴏʀᴇ.\n` +
            `Wᴀᴛᴄʜ ᴀᴅs ᴛᴏ ᴇᴀʀɴ ꜰʀᴇᴇ ᴄᴏɪɴꜱ 👇`,
            Markup.inlineKeyboard([
                [Markup.button.webApp('📺 Earn Coins', adUrl)],
                [Markup.button.callback('🔙 Back', 'menu_shop')]
            ])
        );
    }

    // Success Transaction
    await updateUserBalance(uid, -p.price);
    await db.ref(`purchases/${uid}/${prodId}`).set({ purchasedAt: Date.now(), price: p.price });

    await ctx.editMessageCaption(
        `🎉 <b>Pᴜʀᴄʜᴀꜱᴇ Sᴜᴄᴄᴇꜱꜱꜰᴜʟ!</b>\n\n` +
        `📦 <b>${p.title}</b>\n` +
        `🔗 Download: ${p.link}\n\n` +
        `<i>Check 'My Library' for future access.</i>`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 Home', callback_data: 'home_cmd' }]] } }
    );
});

// ============================================================
// 🤝 Referral, Wallet, Library, Support
// ============================================================

bot.action('menu_refer', async (ctx) => {
    const uid = ctx.from.id;
    const user = await getUser(uid);
    const botInfo = await bot.telegram.getMe();
    const link = `https://t.me/${botInfo.username}?start=${uid}`;
    const count = user && user.referrals ? user.referrals : 0;

    try { await ctx.deleteMessage(); } catch(e){}
    ctx.replyWithHTML(
        `🤝 <b>Rᴇꜰᴇʀ & Eᴀʀɴ</b>\n\n` +
        `Eᴀʀɴ <b>${REFERRAL_BONUS} Cᴏɪɴꜱ</b> ꜰᴏʀ ᴇᴀᴄʜ ғʀɪᴇɴᴅ!\n\n` +
        `👥 Tᴏᴛᴀʟ Rᴇꜰᴇʀʀᴀʟꜱ: <b>${count}</b>\n` +
        `💰 Tᴏᴛᴀʟ Eᴀʀɴᴇᴅ: <b>${count * REFERRAL_BONUS}</b>\n\n` +
        `🔗 <code>${link}</code>`,
        Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'home_cmd')]])
    );
});

bot.action('menu_wallet', async (ctx) => {
    const user = await getUser(ctx.from.id);
    const bal = user ? user.balance : 0;
    const adUrl = `${DOMAIN}/ads.html?uid=${ctx.from.id}`;

    try { await ctx.deleteMessage(); } catch(e){}
    ctx.replyWithHTML(
        `💰 <b>Yᴏᴜʀ Wᴀʟʟᴇᴛ</b>\n\nCᴜʀʀᴇɴᴛ Bᴀʟᴀɴᴄᴇ: <b>${bal} Cᴏɪɴꜱ</b>`,
        Markup.inlineKeyboard([
            [Markup.button.webApp('📺 Watch Ad (+10)', adUrl)],
            [Markup.button.callback('🔙 Back', 'home_cmd')]
        ])
    );
});

bot.action('menu_library', async (ctx) => {
    const snap = await db.ref(`purchases/${ctx.from.id}`).once('value');
    const data = snap.val();
    if (!data) return ctx.answerCbQuery("🚫 Library is empty!", { show_alert: true });

    let buttons = [];
    for (const pid of Object.keys(data)) {
        const pSnap = await db.ref(`products/${pid}`).once('value');
        if (pSnap.val()) buttons.push([Markup.button.callback(`📥 ${pSnap.val().title}`, `dl_${pid}`)]);
    }
    buttons.push([Markup.button.callback('🔙 Back', 'home_cmd')]);

    try { await ctx.deleteMessage(); } catch(e){}
    ctx.replyWithHTML(`📂 <b>Mʏ Lɪʙʀᴀʀʏ</b>`, Markup.inlineKeyboard(buttons));
});

bot.action(/dl_(.+)/, async (ctx) => {
    const p = (await db.ref(`products/${ctx.match[1]}`).once('value')).val();
    if (p) ctx.replyWithHTML(`🔗 <b>${p.title}</b>\n\nDownload Link: ${p.link}`);
});

bot.action('menu_support', async (ctx) => {
    try { await ctx.deleteMessage(); } catch(e){}
    ctx.replyWithHTML(
        `💬 <b>Nᴇᴇᴅ Hᴇʟᴘ?</b>\n\nContact support for any issues.`,
        Markup.inlineKeyboard([
            [Markup.button.url('📩 Contact Admin', 'https://t.me/lagatech')],
            [Markup.button.callback('🔙 Back', 'home_cmd')]
        ])
    );
});

bot.action('home_cmd', (ctx) => sendHome(ctx));

// ============================================================
// 👑 Admin Panel
// ============================================================

bot.action('admin_panel', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    try { await ctx.deleteMessage(); } catch(e){}
    ctx.replyWithHTML("👑 <b>Aᴅᴍɪɴ Pᴀɴᴇʟ</b>", Markup.inlineKeyboard([
        [Markup.button.callback('➕ Add Product', 'admin_add_start')],
        [Markup.button.callback('🗑 Delete Product', 'admin_delete_list')],
        [Markup.button.callback('📢 Broadcast', 'admin_cast_start')],
        [Markup.button.callback('🔙 Home', 'home_cmd')]
    ]));
});

// Delete List
bot.action('admin_delete_list', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const products = await getActiveProducts();
    const buttons = products.map(p => [Markup.button.callback(`🗑 ${p.title}`, `del_${p.id}`)]);
    buttons.push([Markup.button.callback('🔙 Back', 'admin_panel')]);

    try { await ctx.deleteMessage(); } catch(e){}
    ctx.replyWithHTML("🗑 <b>Select product to delete:</b>", Markup.inlineKeyboard(buttons));
});

bot.action(/del_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await db.ref(`products/${ctx.match[1]}`).remove();
    ctx.answerCbQuery("✅ Deleted!");
    ctx.triggerAction('admin_delete_list');
});

// Add Product Wizard Start
bot.action('admin_add_start', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    adminState[ADMIN_ID] = { type: 'PRODUCT', step: 'PHOTO', data: {} };
    ctx.reply("📸 Step 1/5: Send Cover Photo.");
});

// Broadcast Wizard Start
bot.action('admin_cast_start', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    adminState[ADMIN_ID] = { type: 'BROADCAST', step: 'PHOTO', data: {} };
    ctx.reply("📢 Step 1/3: Send Photo (or type 'skip').");
});

// ============================================================
// 🧞 Wizard Handler (Logic for Steps)
// ============================================================
async function handleAdminWizard(ctx) {
    const state = adminState[ADMIN_ID];
    const text = ctx.message.text || '';

    // --- Broadcast Flow ---
    if (state.type === 'BROADCAST') {
        if (state.step === 'PHOTO') {
            if (ctx.message.photo) state.data.photo = ctx.message.photo.pop().file_id;
            state.step = 'TEXT';
            ctx.reply("📝 Step 2/3: Send Caption text:");
        } else if (state.step === 'TEXT') {
            state.data.text = text;
            state.step = 'BTN';
            ctx.reply("🔘 Step 3/3: Button (Name|URL) or 'skip'):");
        } else if (state.step === 'BTN') {
            const users = (await db.ref('users').once('value')).val() || {};
            let count = 0;
            let extra = { parse_mode: 'HTML' };
            if (text.includes('|')) {
                const [name, url] = text.split('|');
                extra.reply_markup = { inline_keyboard: [[{ text: name, url: url }]] };
            }
            
            ctx.reply("⏳ Broadcasting...");
            for (const uid of Object.keys(users)) {
                try {
                    if (state.data.photo) await bot.telegram.sendPhoto(uid, state.data.photo, { caption: state.data.text, ...extra });
                    else await bot.telegram.sendMessage(uid, state.data.text, extra);
                    count++;
                    if (count % 20 === 0) await new Promise(r => setTimeout(r, 1000)); // Rate limit
                } catch (e) {}
            }
            delete adminState[ADMIN_ID];
            ctx.reply(`✅ Broadcast sent to ${count} users.`);
        }
        return;
    }

    // --- Product Add Flow ---
    if (state.type === 'PRODUCT') {
        if (state.step === 'PHOTO') {
            if (!ctx.message.photo) return ctx.reply("❌ Photo required!");
            state.data.imageId = ctx.message.photo.pop().file_id;
            state.step = 'TITLE';
            ctx.reply("📝 Step 2/5: Send Title:");
        } else if (state.step === 'TITLE') {
            state.data.title = text;
            state.step = 'DESC';
            ctx.reply("📄 Step 3/5: Send Description:");
        } else if (state.step === 'DESC') {
            state.data.description = text;
            state.step = 'INFO';
            ctx.reply("💰 Step 4/5: Format: Price|Version|Tech (e.g: 500|v1.0|Node.js)");
        } else if (state.step === 'INFO') {
            const p = text.split('|');
            if (p.length < 3) return ctx.reply("❌ Invalid format. Try again.");
            state.data.price = parseInt(p[0]);
            state.data.version = p[1];
            state.data.tech = p[2];
            state.step = 'LINK';
            ctx.reply("🔗 Step 5/5: Send Download Link:");
        } else if (state.step === 'LINK') {
            state.data.link = text;
            state.data.active = true;
            await db.ref('products').push(state.data);
            delete adminState[ADMIN_ID];
            ctx.reply("✅ Product Added Successfully!");
        }
    }
}

// ============================================================
// 🌐 API & Server
// ============================================================

app.post('/api/reward', async (req, res) => {
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ error: 'No UID' });

    await updateUserBalance(uid, 10);
    const user = await getUser(uid);

    res.json({ success: true, newBalance: user ? user.balance : 0 });
});

app.use(bot.webhookCallback('/bot'));

app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    if (DOMAIN) {
        await bot.telegram.setWebhook(`${DOMAIN}/bot`);
        console.log(`Webhook set to ${DOMAIN}/bot`);
    }
});
