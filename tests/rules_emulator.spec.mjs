// =============================================================
//  firestore.rules 를 Firestore 에뮬레이터에서 시험한다
// =============================================================
//  앱(js/data.js)이 실제로 보내는 쓰기 모양 그대로 — serverTimestamp,
//  increment, 묶음 쓰기까지 진짜 SDK 로 — 허용돼야 할 것과 막혀야 할 것을
//  확인한다. 규칙을 고쳤는데 앱의 동작 하나가 막히는 사고(서버에 게시한
//  뒤에야 학생 화면에서 권한 오류로 드러나던 것)를 게시 전에 잡는다.
//
//  CI(.github/workflows/pages.yml)가 규칙을 게시하기 전에 돌린다. 직접:
//    npm i --no-save @firebase/rules-unit-testing@3 firebase@10
//    npx firebase-tools@13 emulators:exec --only firestore --project demo-manito \
//      "node tests/rules_emulator.spec.mjs"
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import {
  doc, collection, setDoc, updateDoc, addDoc, getDoc, getDocs, deleteDoc, writeBatch,
  serverTimestamp, increment, Timestamp, query, where, getCountFromServer,
} from "firebase/firestore";

const RULES = process.env.RULES || "firestore.rules";
const env = await initializeTestEnvironment({
  projectId: "demo-manito",
  firestore: { rules: readFileSync(RULES, "utf8"), host: "127.0.0.1", port: 8080 },
});
const db = env.unauthenticatedContext().firestore();
const seed = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
const past = Timestamp.fromMillis(Date.now() - 864e5);

let ok = 0, bad = 0;
async function t(name, expect, fn) {
  try {
    await (expect === "allow" ? assertSucceeds(fn()) : assertFails(fn()));
    ok++; console.log(`  OK  ${name}`);
  } catch (e) {
    bad++; console.log(`  XX  ${name}  (기대: ${expect}) ${String(e.message || e).split("\n")[0].slice(0, 160)}`);
  }
}

console.log("[선생님 계정]");
await t("처음 등록(setDoc merge)", "allow", () => setDoc(doc(db, "classes/0603"), { adminSalt: "s", adminHash: "h", createdAt: serverTimestamp() }, { merge: true }));
await t("등록된 비번 덮어쓰기 차단", "deny", () => setDoc(doc(db, "classes/0603"), { adminSalt: "s2", adminHash: "evil", createdAt: serverTimestamp() }, { merge: true }));
await seed((d) => setDoc(doc(d, "classes/0604"), { createdAt: past }));
await t("해시 없는 문서엔 처음 등록 가능", "allow", () => setDoc(doc(db, "classes/0604"), { adminSalt: "s", adminHash: "h", createdAt: serverTimestamp() }, { merge: true }));

console.log("[명단·시크릿]");
const fresh = { hasPassword: false, wish: null, wishSetAt: null, wishRewriteNote: null, caringForId: null, caringForName: null };
await t("학생 등록(addStudents 배치)", "allow", async () => {
  const b = writeBatch(db);
  b.set(doc(db, "classes/0603/students/s1"), { name: "김철수", createdAt: serverTimestamp() });
  b.set(doc(db, "classes/0603/secrets/s1"), fresh);
  b.set(doc(db, "classes/0603/students/s2"), { name: "이영희", createdAt: serverTimestamp() });
  b.set(doc(db, "classes/0603/secrets/s2"), fresh);
  return b.commit();
});
await t("학생 문서에 딴 필드 차단", "deny", () => setDoc(doc(db, "classes/0603/students/s9"), { name: "x", createdAt: serverTimestamp(), admin: true }));
await t("학생 등록 시각 위조 차단", "deny", () => setDoc(doc(db, "classes/0603/students/s9"), { name: "x", createdAt: past }));
await t("소원 든 시크릿 새로 만들기 차단", "deny", () => setDoc(doc(db, "classes/0603/secrets/s9"), { ...fresh, wish: "몰래" }));
await t("계정 만들기(setStudentPassword)", "allow", () => updateDoc(doc(db, "classes/0603/secrets/s1"), { salt: "a", pwHash: "h1", hasPassword: true }));
await t("비번 있는 계정 바꿔치기 차단", "deny", () => updateDoc(doc(db, "classes/0603/secrets/s1"), { salt: "b", pwHash: "evil", hasPassword: true }));
await t("소원 등록(setMyWish)", "allow", () => updateDoc(doc(db, "classes/0603/secrets/s1"), { wish: "레고", wishSetAt: serverTimestamp(), wishRewriteNote: null }));
await t("소원 시각 위조 차단", "deny", () => updateDoc(doc(db, "classes/0603/secrets/s1"), { wish: "레고", wishSetAt: past }));
await t("다시 써 달라 요청(requestWishRewrite)", "allow", () => updateDoc(doc(db, "classes/0603/secrets/s1"), { wish: null, wishSetAt: null, wishRewriteNote: "다시" }));
await t("선생님 비번 초기화(resetStudentPassword)", "allow", () => updateDoc(doc(db, "classes/0603/secrets/s1"), { hasPassword: false, pwHash: null, salt: null }));
await t("초기화 뒤 새 비번 설정", "allow", () => updateDoc(doc(db, "classes/0603/secrets/s1"), { salt: "c", pwHash: "h2", hasPassword: true }));
await t("배정(assignManito set merge, 기존 문서)", "allow", () => setDoc(doc(db, "classes/0603/secrets/s1"),
  { caringForId: "s2", caringForName: "이영희", wish: null, wishSetAt: null, wishRewriteNote: null }, { merge: true }));
await t("배정(set merge, 없던 문서 = 예전 선생님 칸)", "allow", () => setDoc(doc(db, "classes/0603/secrets/_teacher_"),
  { caringForId: "s1", caringForName: "김철수", wish: null, wishSetAt: null, wishRewriteNote: null }, { merge: true }));
await t("전체 관리자 소원 수정(superAdminSetWish)", "allow", () => updateDoc(doc(db, "classes/0603/secrets/s2"), { wish: "새 소원", wishSetAt: serverTimestamp(), wishRewriteNote: null }));
await t("전체 관리자 배정 지정(superAdminSetCare)", "allow", () => updateDoc(doc(db, "classes/0603/secrets/s2"), { caringForId: "s1", caringForName: "김철수" }));
await t("배정 상태 기록(meta/state)", "allow", () => setDoc(doc(db, "classes/0603/meta/state"), { assignedAt: serverTimestamp(), studentCount: 2, teacherIncluded: false }));

console.log("[어항]");
const fishDoc = { ownerId: "s1", ownerName: "김철수", name: "뽀글이", art: "2:AC:AzCC", seed: 7, fed: 0 };
let fid;
await t("물고기 넣기(새 앱, touchedAt)", "allow", async () => { fid = (await addDoc(collection(db, "classes/0603/fish"), { ...fishDoc, createdAt: serverTimestamp(), touchedAt: serverTimestamp() })).id; });
await t("물고기 넣기(예전 앱)", "allow", () => addDoc(collection(db, "classes/0603/fish"), { ...fishDoc, createdAt: serverTimestamp() }));
await t("touchedAt 위조 차단", "deny", () => addDoc(collection(db, "classes/0603/fish"), { ...fishDoc, createdAt: serverTimestamp(), touchedAt: past }));
await t("밥주기(increment + touchedAt)", "allow", () => updateDoc(doc(db, "classes/0603/fish", fid), { fed: increment(1), touchedAt: serverTimestamp() }));
for (let i = 0; i < 9; i++) await updateDoc(doc(db, "classes/0603/fish", fid), { fed: increment(1), touchedAt: serverTimestamp() });
await t("11번째 밥(예전 게시본은 막던 것)", "allow", () => updateDoc(doc(db, "classes/0603/fish", fid), { fed: increment(1), touchedAt: serverTimestamp() }));
await t("밥주기(예전 앱: fed 값을 직접 +1)", "allow", () => updateDoc(doc(db, "classes/0603/fish", fid), { fed: 12 }));
await t("오래된 fed 로 +1 (예전 방식의 버그 재현)", "deny", () => updateDoc(doc(db, "classes/0603/fish", fid), { fed: 5 }));
await t("주인 이름 바꿔치기 차단", "deny", () => updateDoc(doc(db, "classes/0603/fish", fid), { fed: increment(1), ownerName: "딴사람" }));
await t("새로 바뀐 물고기만 조회(touchedAt >)", "allow", () => getDocs(query(collection(db, "classes/0603/fish"), where("touchedAt", ">", past))));
await t("물고기 개수 세기", "allow", () => getCountFromServer(collection(db, "classes/0603/fish")));
await t("물고기 빼기", "allow", () => deleteDoc(doc(db, "classes/0603/fish", fid)));

console.log("[투표]");
let vid;
await t("항목 올리기(touchedAt)", "allow", async () => { vid = (await addDoc(collection(db, "voteItems"), { label: "수영장", count: 0, weekKey: "2026-09-28", addedBy: "김철수", addedByRole: "학생 · 6-3", createdAt: serverTimestamp(), touchedAt: serverTimestamp() })).id; });
await t("신고 승인으로 올리기(approveReport, touchedAt 없음)", "allow", () => addDoc(collection(db, "voteItems"), { label: "승인된 것", count: 0, weekKey: "2026-09-28", addedBy: "이영희", addedByRole: "", createdAt: serverTimestamp() }));
await t("투표(increment + touchedAt)", "allow", () => updateDoc(doc(db, "voteItems", vid), { count: increment(1), touchedAt: serverTimestamp() }));
await t("투표(예전 앱: 값 +1)", "allow", () => updateDoc(doc(db, "voteItems", vid), { count: 2 }));
await t("+2 차단", "deny", () => updateDoc(doc(db, "voteItems", vid), { count: 4 }));
await t("꼬리표 바꾸기 차단", "deny", () => updateDoc(doc(db, "voteItems", vid), { count: increment(1), addedByRole: "선생님" }));
await t("이번 주 항목만 조회", "allow", () => getDocs(query(collection(db, "voteItems"), where("weekKey", "==", "2026-09-28"))));
await t("투표 기록(ballot)", "allow", () => setDoc(doc(db, "voteBallots", "2026-09-28_0603_s1"), { weekKey: "2026-09-28", classCode: "0603", voterId: "s1", votedAt: serverTimestamp() }));
await t("같은 주 두 번째 투표 기록 차단", "deny", () => setDoc(doc(db, "voteBallots", "2026-09-28_0603_s1"), { weekKey: "2026-09-28", classCode: "0603", voterId: "s1", votedAt: serverTimestamp() }));

console.log("[이스터에그·베타 초기화·기타]");
await t("이스터에그 첫 발견(increment, 새 문서)", "allow", () => setDoc(doc(db, "eggStats", "logo"), { count: increment(1) }, { merge: true }));
await t("이스터에그 +1(increment)", "allow", () => setDoc(doc(db, "eggStats", "logo"), { count: increment(1) }, { merge: true }));
await t("이스터에그 +5 차단", "deny", () => setDoc(doc(db, "eggStats", "logo"), { count: increment(5) }, { merge: true }));
await t("베타 초기화 표시 만들기", "allow", () => setDoc(doc(db, "classes/0603/meta/betaReset"), { at: serverTimestamp() }));
await t("베타 초기화 표시 읽기", "allow", () => getDoc(doc(db, "classes/0603/meta/betaReset")));
await t("베타 초기화 표시 지우기 차단", "deny", () => deleteDoc(doc(db, "classes/0603/meta/betaReset")));
await t("밥 나눠주기", "allow", () => setDoc(doc(db, "classes/0603/foodGrants/s1"), { total: 5, updatedAt: serverTimestamp() }, { merge: true }));
await t("버그 제보", "allow", () => addDoc(collection(db, "feedback"), { name: "김철수", roleTag: "학생", message: "버그", createdAt: serverTimestamp() }));
await t("따옴표 든 ID 로 투표 항목 만들기 차단", "deny", () => setDoc(doc(db, "voteItems", 'x" autofocus onfocus="1'),
  { label: "해킹", count: 0, weekKey: "2026-09-28", addedBy: "x", addedByRole: "", createdAt: serverTimestamp() }));
await t("꺾쇠 든 ID 로 학생 만들기 차단", "deny", () => setDoc(doc(db, "classes/0603/students/<b>x"), { name: "x", createdAt: serverTimestamp() }));
await t("모르는 경로 차단", "deny", () => setDoc(doc(db, "hack/x"), { a: 1 }));
await t("잘못된 반 코드 차단", "deny", () => getDocs(collection(db, "classes/9999/students")));

await env.cleanup();
console.log(`\n결과: ${ok} 통과 / ${bad} 실패`);
process.exit(bad ? 1 : 0);
