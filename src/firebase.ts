import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBaoZhqd8t04_6p4Zhqe2cyrXvh2iqIxWM",
  authDomain: "nomad-815ab.firebaseapp.com",
  projectId: "nomad-815ab",
  storageBucket: "nomad-815ab.firebasestorage.app",
  messagingSenderId: "79352084459",
  appId: "1:79352084459:web:417c881c5d71c208e50bae",
  measurementId: "G-321EP6VC2S",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
