require('dotenv').config();
const express = require('express');
const { Telegraf, Markup, session } = require('telegraf');
const db = require('./firebase');

// CONFIG
const PORT = process.env.PORT || 3000;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const DOMAIN = process.env.RENDER_EXTERNAL_URL;
const BOT_TOKEN = process.env.BOT_TOKEN;

const app = express();
const bot = new Telegraf(BOT_TOKEN);

app.use(express.json());
app.use(express.static('public'));

// ============================================================
// 🧠 STATE MANAGEMENT (For Admin Wizard)
// ============================================================
// We use a simple in-memory object to track Admin's progress
// when adding products.
const adminState = {}; 

// ============================================================
// 🛠 HELPER FUNCTIONS
// ============================================================

async function getUser(uid) {
    const snap = await db.ref(`users/${uid}`).once('value');
    return snap.val();
}

async function updateUserBalance(uid, amount) {
    const userRef = db.ref(`users/${uid}/balance`);
    await userRef.transaction((current) => (current || 0) + amount);
}

// Fetch all active products as an Array for Navigation
async function getActiveProducts() {
    const snap = await db.ref('products').orderByChild('active').equalTo(true).once('value');
    const data = snap.val();
    if (!data) return [];
    
    // Convert Object to Array and add ID inside
    return Object.keys(data).map(key => ({
        id: key,
        ...data[key]
    }));
}

// ============================================================
// 🤖 MIDDLEWARE & START
// ============================================================

bot.use(async (ctx, next) => {
    // 1. Check if user exists, if not create
    if (ctx.from) {
        const ref = db.ref(`users/${ctx.from.id}`);
        const snap = await ref.once('value');
        if (!snap.exists()) {
            await ref.set({
                firstName: ctx.from.first_name,
                username: ctx.from.username || 'none',
                balance: 0,
                joinedAt: Date.now()
            });
        }
    }

    // 2. Admin Wizard Handler (Intercepts messages if Admin is adding product)
    if (ctx.from && ctx.from.id === ADMIN_ID && adminState[ADMIN_ID]) {
        return handleAdminWizard(ctx);
    }

    return next();
});

// MAIN MENU
const getMainMenu = (isAdmin) => {
    let buttons = [
        [Markup.button.callback('🛍 Browse Source Codes', 'view_index_0')],
        [Markup.button.callback('📂 My Library', 'library'), Markup.button.callback('💰 Wallet', 'wallet')],
        [Markup.button.callback('💬 Support', 'support'), Markup.button.callback('ℹ️ Help', 'help')]
    ];
    if (isAdmin) buttons.push([Markup.button.callback('👑 Admin Panel', 'admin_panel')]);
    return Markup.inlineKeyboard(buttons);
};

bot.command('start', async (ctx) => {
    const user = await getUser(ctx.from.id);
    const msg = `🔰 <b>Welcome to Laga Code</b>\n\n` +
                `The #1 Marketplace for Premium Source Codes.\n` +
                `Your Balance: <b>${user.balance} Coins</b>\n\n` +
                `👇 <i>Tap below to start browsing:</i>`;
    
    // If user has an old menu (text), send new. If callback, edit.
    if(ctx.callbackQuery) {
        // Safe edit logic for text messages
        try { await ctx.deleteMessage(); } catch(e){}
        await ctx.replyWithHTML(msg, getMainMenu(ctx.from.id === ADMIN_ID));
    } else {
        await ctx.replyWithHTML(msg, getMainMenu(ctx.from.id === ADMIN_ID));
    }
});

// ============================================================
// 🛍 PREMIUM SHOP SYSTEM (IMAGE + NAVIGATION)
// ============================================================

// Handler to view a product by INDEX (0, 1, 2...)
bot.action(/view_index_(\d+)/, async (ctx) => {
    const index = parseInt(ctx.match[1]);
    const products = await getActiveProducts();

    if (products.length === 0) {
        return ctx.answerCbQuery("No products available yet.");
    }

    // Bounds checking
    if (index < 0 || index >= products.length) return ctx.answerCbQuery("End of list.");

    const p = products[index];

    // Build Caption
    const caption = `💻 <b>${p.title}</b>\n\n` +
                    `${p.description}\n\n` +
                    `➖➖➖➖➖➖➖➖\n` +
                    `💰 <b>Price: ${p.price} Coins</b>\n` +
                    `📦 Version: ${p.version}\n` +
                    `🛠 Tech: ${p.tech}`;

    // Build Buttons
    // Row 1: BIG BUY BUTTON
    const btnBuy = [Markup.button.callback(`🛒 BUY NOW (${p.price} 🪙)`, `buy_${p.id}`)];
    
    // Row 2: Navigation (Prev | Next)
    const btnNav = [];
    if (index > 0) btnNav.push(Markup.button.callback('⬅️ Prev', `view_index_${index - 1}`));
    if (index < products.length - 1) btnNav.push(Markup.button.callback('Next ➡️', `view_index_${index + 1}`));

    // Row 3: Back
    const btnBack = [Markup.button.callback('🔙 Back to Menu', 'home_clean')];

    const keyboard = Markup.inlineKeyboard([btnBuy, btnNav, btnBack]);

    // LOGIC: If the message has a photo, we edit the media. 
    // If it was a text message (Start menu), we must delete and send photo.
    
    try {
        if (ctx.callbackQuery.message.photo) {
            // Already a photo message, edit it
            await ctx.editMessageMedia({
                type: 'photo',
                media: p.imageId || 'https://via.placeholder.com/800x400.png?text=No+Image', // Fallback URL
                caption: caption,
                parse_mode: 'HTML'
            }, keyboard);
        } else {
            // Was text, delete and send photo
            await ctx.deleteMessage();
            await ctx.replyWithPhoto(p.imageId || { url: 'https://via.placeholder.com/800x400.png?text=Laga+Code' }, {
                caption: caption,
                parse_mode: 'HTML',
                ...keyboard
            });
        }
    } catch (e) {
        console.error(e);
        // Fallback if edit fails (e.g. media type mismatch)
        await ctx.replyWithPhoto(p.imageId, { caption: caption, parse_mode: 'HTML', ...keyboard });
    }
});

// BUY HANDLER
bot.action(/buy_(.+)/, async (ctx) => {
    const prodId = ctx.match[1];
    const uid = ctx.from.id;
    const user = await getUser(uid);
    const productSnap = await db.ref(`products/${prodId}`).once('value');
    const product = productSnap.val();

    if (!product) return ctx.answerCbQuery("Product error.");

    // Check ownership
    const owned = await db.ref(`purchases/${uid}/${prodId}`).once('value');
    if (owned.exists()) return ctx.answerCbQuery("You already own this!", { show_alert: true });

    if (user.balance < product.price) {
        return ctx.answerCbQuery(`⚠️ Need ${product.price - user.balance} more coins!`, { show_alert: true });
    }

    // Process
    await updateUserBalance(uid, -product.price);
    await db.ref(`purchases/${uid}/${prodId}`).set({ purchasedAt: Date.now(), price: product.price });
    
    ctx.answerCbQuery("✅ Purchased successfully!");
    
    // Send delivery immediately
    await ctx.replyWithHTML(`🎉 <b>Purchase Successful!</b>\n\n📦 <b>${product.title}</b>\n🔗 Link: ${product.link}\n\n<i>Saved to "My Library".</i>`);
});

// HOME CLEANUP (Deletes photo, sends text menu)
bot.action('home_clean', async (ctx) => {
    try { await ctx.deleteMessage(); } catch(e){}
    const user = await getUser(ctx.from.id);
    const msg = `🔰 <b>Laga Code</b>\nBalance: <b>${user.balance} Coins</b>\nSelect option:`;
    await ctx.replyWithHTML(msg, getMainMenu(ctx.from.id === ADMIN_ID));
});

// ============================================================
// 📂 LIBRARY & WALLET
// ============================================================

bot.action('library', async (ctx) => {
    const purchases = (await db.ref(`purchases/${ctx.from.id}`).once('value')).val();
    if (!purchases) return ctx.answerCbQuery("Empty Library.", { show_alert: true });

    // Simple list for library
    let msg = "📂 <b>My Collection:</b>\n\n";
    const buttons = [];
    
    for (const pid of Object.keys(purchases)) {
        const p = (await db.ref(`products/${pid}`).once('value')).val();
        if(p) {
            msg += `🔹 ${p.title}\n`;
            buttons.push([Markup.button.callback(`📥 Download ${p.title}`, `dl_${pid}`)]);
        }
    }
    buttons.push([Markup.button.callback('🔙 Back', 'home_clean')]);
    
    // Library is text-based to avoid photo complexity
    try { await ctx.deleteMessage(); } catch(e){}
    ctx.replyWithHTML(msg, Markup.inlineKeyboard(buttons));
});

bot.action(/dl_(.+)/, async (ctx) => {
    const pid = ctx.match[1];
    // Security check
    const owned = await db.ref(`purchases/${ctx.from.id}/${pid}`).once('value');
    if(!owned.exists()) return;
    
    const p = (await db.ref(`products/${pid}`).once('value')).val();
    ctx.replyWithHTML(`🔗 <b>${p.title}</b>\n\nSource: ${p.link}`);
});

bot.action('wallet', async (ctx) => {
    const user = await getUser(ctx.from.id);
    const adUrl = `${DOMAIN}/ads.html?uid=${ctx.from.id}`;
    
    try { await ctx.deleteMessage(); } catch(e){}
    
    ctx.replyWithHTML(
        `💰 <b>Wallet Balance: ${user.balance} Coins</b>\n\n👇 <b>Earn Free Coins:</b>`,
        Markup.inlineKeyboard([
            [Markup.button.webApp('📺 Watch Ad (+10 Coins)', adUrl)],
            [Markup.button.callback('🔙 Back', 'home_clean')]
        ])
    );
});

// ============================================================
// 👑 ADVANCED ADMIN WIZARD (STEP-BY-STEP ADD)
// ============================================================

bot.action('admin_panel', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    try { await ctx.deleteMessage(); } catch(e){}
    ctx.replyWithHTML("👑 <b>Admin Panel</b>", Markup.inlineKeyboard([
        [Markup.button.callback('➕ Add Product (Wizard)', 'admin_add_start')],
        [Markup.button.callback('🔙 Home', 'home_clean')]
    ]));
});

bot.action('admin_add_start', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    adminState[ADMIN_ID] = { step: 'PHOTO', data: {} }; // Init State
    ctx.reply("📸 <b>Step 1/5:</b>\nSend the <b>Cover Image</b> for this product.");
});

// WIZARD HANDLER FUNCTION
async function handleAdminWizard(ctx) {
    const state = adminState[ADMIN_ID];
    const text = ctx.message.text;

    // STEP 1: PHOTO
    if (state.step === 'PHOTO') {
        if (ctx.message.photo) {
            // Get the highest resolution photo id
            state.data.imageId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            state.step = 'TITLE';
            ctx.reply("📝 <b>Step 2/5:</b>\nEnter the <b>Title</b> of the source code.");
        } else {
            ctx.reply("❌ Please send an image (compressed), not a file.");
        }
        return;
    }

    // STEP 2: TITLE
    if (state.step === 'TITLE') {
        state.data.title = text;
        state.step = 'DESC';
        ctx.reply("📄 <b>Step 3/5:</b>\nEnter the <b>Description</b> (You can use multiple lines).");
        return;
    }

    // STEP 3: DESCRIPTION
    if (state.step === 'DESC') {
        state.data.description = text;
        state.step = 'PRICE_TECH';
        ctx.reply("💰 <b>Step 4/5:</b>\nEnter <b>Price,Version,TechStack</b> separated by |.\nExample: <i>500|v2.0|Node.js</i>");
        return;
    }

    // STEP 4: DETAILS
    if (state.step === 'PRICE_TECH') {
        const parts = text.split('|');
        if (parts.length < 3) return ctx.reply("❌ Format wrong. Try: 500|v1.0|Python");
        
        state.data.price = parseInt(parts[0].trim());
        state.data.version = parts[1].trim();
        state.data.tech = parts[2].trim();
        
        state.step = 'LINK';
        ctx.reply("🔗 <b>Step 5/5:</b>\nEnter the <b>Download Link</b> (Google Drive / GitHub).");
        return;
    }

    // STEP 5: LINK & SAVE
    if (state.step === 'LINK') {
        state.data.link = text;
        state.data.active = true;

        // SAVE TO FIREBASE
        await db.ref('products').push(state.data);

        // RESET
        delete adminState[ADMIN_ID];
        ctx.replyWithPhoto(state.data.imageId, {
            caption: `✅ <b>Product Added Successfully!</b>\n\n${state.data.title}\nPrice: ${state.data.price}`,
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Admin Panel', 'admin_panel')]])
        });
    }
}

// ============================================================
// 🚀 SERVER
// ============================================================

// Ad Reward Endpoint (Same as before)
app.post('/api/reward', async (req, res) => {
    const { uid } = req.body; // Add secret check in production
    await updateUserBalance(uid, 10);
    bot.telegram.sendMessage(uid, "🎉 You earned 10 Coins!");
    res.json({ success: true });
});

app.use(bot.webhookCallback('/bot'));

app.listen(PORT, async () => {
    console.log(`Server running on ${PORT}`);
    if (DOMAIN) {
        await bot.telegram.setWebhook(`${DOMAIN}/bot`);
    }
});
