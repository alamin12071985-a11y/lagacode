const admin = require('firebase-admin');
require('dotenv').config();

let serviceAccount;

try {
    // ১. প্রথমে চেক করবে রেন্ডার বা সার্ভারের ENV তে 'FIREBASE_SERVICE_ACCOUNT' আছে কিনা
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } 
    // ২. না থাকলে লোকাল ফোল্ডারের ফাইল খুঁজবে
    else {
        serviceAccount = require('./serviceAccountKey.json');
    }
} catch (error) {
    console.error('❌ Firebase Error: serviceAccountKey.json missing or invalid ENV variable.');
    process.exit(1);
}

// ফায়ারবেস ইনিশিয়াল করা হচ্ছে
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DB_URL
    });
}

const db = admin.database();

console.log("🔥 Firebase Connected Successfully!");

module.exports = db;
