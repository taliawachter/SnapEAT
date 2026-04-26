import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import fs from "fs";

const serviceAccount = JSON.parse(
  fs.readFileSync("./firebase-service-account.json", "utf8")
);

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential: cert(serviceAccount),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      });

export const db = getFirestore(app);
export const bucket = getStorage(app).bucket();