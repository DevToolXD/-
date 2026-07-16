// =============================================================
//  Firebase 초기화 (모듈 방식, CDN import)
// =============================================================
import { firebaseConfig, APP } from "../config.js";

const V = APP.firebaseVersion;
const { initializeApp } = await import(
  `https://www.gstatic.com/firebasejs/${V}/firebase-app.js`
);
const firestore = await import(
  `https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`
);

const app = initializeApp(firebaseConfig);
export const db = firestore.getFirestore(app);

// 자주 쓰는 Firestore 함수들을 그대로 재수출
export const {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  writeBatch,
  query,
  orderBy,
  serverTimestamp,
} = firestore;
