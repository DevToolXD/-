// =============================================================
//  Firebase 초기화 (모듈 방식, CDN import)
//  CDN 로드 자체가 실패해도(네트워크 문제, 광고차단기 등) 이 모듈은 항상
//  정상적으로 로드됩니다 — 그래야 앱의 나머지 UI(버튼 등)가 죽지 않고,
//  실제 Firestore 호출 시점에만 사용자에게 친절한 에러를 보여줄 수 있습니다.
// =============================================================
import { firebaseConfig, APP } from "../config.js?v=DEV";

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

// Firestore 가 돌려주는 "Missing or insufficient permissions." 는 사용자가
// 보기엔 아무 의미가 없다. 이 앱에서 이 오류는 사실상 하나의 원인 —
// firestore.rules 를 Firebase 콘솔에 아직 게시하지 않은 것 — 뿐이므로,
// 무엇을 해야 하는지 한국어로 알려준다.
export const RULES_MSG =
  "아직 서버 준비가 안 됐어요. (관리자: Firebase 콘솔 → Firestore → 규칙에 " +
  "firestore.rules 를 붙여넣고 게시해 주세요)";

export function isPermissionError(e) {
  const code = e?.code || "";
  const msg = String(e?.message || e || "");
  return code === "permission-denied" || /Missing or insufficient permissions/i.test(msg);
}

function friendlyError(e) {
  if (isPermissionError(e)) {
    const err = new Error(RULES_MSG);
    err.code = "permission-denied";
    return err;
  }
  return e;
}

// 비동기 Firestore 호출을 감싸 권한 오류만 알아보기 쉬운 메시지로 바꾼다.
function wrapAsync(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      throw friendlyError(e);
    }
  };
}

function need(name, isAsync = false) {
  if (!firestoreApi) {
    return () => { throw new Error(FRIENDLY_MSG); };
  }
  const fn = firestoreApi[name];
  return isAsync ? wrapAsync(fn) : fn;
}

export const collection = need("collection");
export const doc = need("doc");
export const getDoc = need("getDoc", true);
export const getDocs = need("getDocs", true);
export const setDoc = need("setDoc", true);
export const updateDoc = need("updateDoc", true);
export const addDoc = need("addDoc", true);
export const deleteDoc = need("deleteDoc", true);

// writeBatch 는 commit() 이 실제 네트워크 호출이라 그 쪽을 감싼다.
export const writeBatch = firestoreApi
  ? (...args) => {
      const batch = firestoreApi.writeBatch(...args);
      const commit = batch.commit.bind(batch);
      batch.commit = async () => {
        try {
          return await commit();
        } catch (e) {
          throw friendlyError(e);
        }
      };
      return batch;
    }
  : () => { throw new Error(FRIENDLY_MSG); };
export const query = need("query");
export const orderBy = need("orderBy");
export const limit = need("limit");
export const serverTimestamp = need("serverTimestamp");
