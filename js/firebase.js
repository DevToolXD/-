// =============================================================
//  Firebase 초기화 (모듈 방식, CDN import)
//  CDN 로드 자체가 실패해도(네트워크 문제, 광고차단기 등) 이 모듈은 항상
//  정상적으로 로드됩니다 — 그래야 앱의 나머지 UI(버튼 등)가 죽지 않고,
//  실제 Firestore 호출 시점에만 사용자에게 친절한 에러를 보여줄 수 있습니다.
// =============================================================
import { firebaseConfig, APP } from "../config.js";

const FRIENDLY_MSG = "Firebase 연결에 실패했어요. 네트워크 상태를 확인하고 새로고침 해주세요.";

let dbInstance = null;
let firestoreApi = null;

try {
  const V = APP.firebaseVersion;
  const { initializeApp } = await import(
    `https://www.gstatic.com/firebasejs/${V}/firebase-app.js`
  );
  firestoreApi = await import(
    `https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`
  );
  const app = initializeApp(firebaseConfig);
  dbInstance = firestoreApi.getFirestore(app);
} catch (e) {
  console.error("Firebase 초기화 실패:", e);
}

export const db = dbInstance;
export const firebaseReady = !!firestoreApi;

function need(name) {
  if (!firestoreApi) {
    return () => { throw new Error(FRIENDLY_MSG); };
  }
  return firestoreApi[name];
}

export const collection = need("collection");
export const doc = need("doc");
export const getDoc = need("getDoc");
export const getDocs = need("getDocs");
export const setDoc = need("setDoc");
export const updateDoc = need("updateDoc");
export const addDoc = need("addDoc");
export const deleteDoc = need("deleteDoc");
export const writeBatch = need("writeBatch");
export const query = need("query");
export const orderBy = need("orderBy");
export const serverTimestamp = need("serverTimestamp");
