import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore/lite";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDBnFuvJhpCsu4_9dtQq-SoyxIruWXWVtQ",
  authDomain: "snapeat-3d9ce.firebaseapp.com",
  projectId: "snapeat-3d9ce",
  storageBucket: "snapeat-3d9ce.firebasestorage.app",
  messagingSenderId: "148177813646",
  appId: "1:148177813646:web:878eefcbd36611a35a09df",
  measurementId: "G-ZPZZ70LFHR"
};

export const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);

export const auth = getAuth(app);