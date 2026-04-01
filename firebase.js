const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, get, child, remove, push, update, serverTimestamp } = require('firebase/database');

const firebaseConfig = {
  apiKey: "AIzaSyBScBRNNMxj1RqQtTy2V1PkmBBqb0ed4rA",
  authDomain: "lagacode-c30bf.firebaseapp.com",
  projectId: "lagacode-c30bf",
  storageBucket: "lagacode-c30bf.firebasestorage.app",
  messagingSenderId: "414251734880",
  appId: "1:414251734880:web:095a38b98bd029c87ab005"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const dbRef = ref(database);

module.exports = {
  database, dbRef, ref, set, get, child, remove, push, update, serverTimestamp
};
