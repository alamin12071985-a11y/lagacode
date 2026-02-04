const { initializeApp } = require('firebase/app');
const { getDatabase, ref } = require('firebase/database');

// আপনার Firebase Console থেকে Config কপি করে নিচে বসান
const firebaseConfig = {
  apiKey: "AIzaSyD1PPDhogcw7fBu27PkO1iuMfGFLUwMN70",
  authDomain: "fir-55206.firebaseapp.com",
  databaseURL: "https://fir-55206-default-rtdb.firebaseio.com",
  projectId: "fir-55206",v
  storageBucket: "fir-55206.firebasestorage.app",
  messagingSenderId: "24586463698",
  appId: "1:24586463698:web:8b2f21073295ef4382400b",
  measurementId: "G-K676BWHYR4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

module.exports = { db, ref };
