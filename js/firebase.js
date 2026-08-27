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
// firestore.rules 를 Firebase 콘솔에 아직 게시하지 않은 것 — 뿐이다.
//
// 다만 이 문구는 학생·선생님 화면 어디서나 뜨는데, 정작 규칙을 게시할 수
// 있는 사람은 전체 관리자뿐이다. 그래서 여기서는 짧게만 알리고, 실제로
// 무엇을 눌러야 하는지는 전체 관리자 화면의 "서버 규칙" 칸이 안내한다.
export const RULES_MSG =
  "아직 서버 준비가 안 됐어요. 관리자에게 알려 주세요.";

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

// 실시간 구독. 어항에서 누가 물고기를 넣거나 밥을 주면 다른 사람 화면에도
// 바로 보여야 해서 쓴다. CDN 로드가 실패했으면 아무 것도 하지 않는 해제
// 함수를 돌려준다 — 호출한 쪽이 분기하지 않아도 되게.
export const onSnapshot = firestoreApi
  ? (...args) => firestoreApi.onSnapshot(...args)
  : () => () => {};
