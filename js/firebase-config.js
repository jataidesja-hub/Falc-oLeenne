import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, collection } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCf0BWT5ZIXYeDrABwLJ3mEU0-WhlK_67M",
  authDomain: "falcaoleenne.firebaseapp.com",
  projectId: "falcaoleenne",
  storageBucket: "falcaoleenne.firebasestorage.app",
  messagingSenderId: "951824251597",
  appId: "1:951824251597:web:76f4fac1648a41065f0784"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db, doc, setDoc, onSnapshot, collection };
