import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { initializeAuth, browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBA0En2SIOegzBUvJPCp3g1S3VJSqkM2fI",
  authDomain: "forhad-vhai.firebaseapp.com",
  databaseURL: "https://forhad-vhai-default-rtdb.firebaseio.com",
  projectId: "forhad-vhai",
  storageBucket: "forhad-vhai.firebasestorage.app",
  messagingSenderId: "927503182305",
  appId: "1:927503182305:web:f96f7191ac3fd87d014aa0",
  measurementId: "G-RMZGHNVSQW"
};
export const app = initializeApp(firebaseConfig);
export const auth = initializeAuth(app, { persistence: browserSessionPersistence });
export const db = getFirestore(app);