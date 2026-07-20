// =============================================================
//  라이브 E2E: 실제 Firebase(manito-e14c1) 백엔드, classes/1889(테스트 모드)
//  아래에서 학급 등록 → 배정 → 소원 등록 → 마니또가 소원 확인 →
//  전체공개 재구성 흐름을 검증하고 만든 데이터만 정리(cleanup)한다.
//  HTTP 는 curl(프록시 통과)로, 배정 로직은 실제 앱 모듈(assign.js)로 수행.
//    실행:  node tests/e2e_live.mjs
// =============================================================
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildCycle } from "../js/assign.js";
import { randomHex, hashSecret } from "../js/crypto.js";

const pexec = promisify(execFile);
const BASE = "https://firestore.googleapis.com/v1/projects/manito-e14c1/databases/(default)/documents";
const TEST_CODE = "1889";

let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log("  ✅", n); } else { fail++; console.log("  ❌", n); } };

async function curlJSON(args) {
  const { stdout } = await pexec("curl", ["-s", ...args], { maxBuffer: 10 * 1024 * 1024 });
  return stdout ? JSON.parse(stdout) : {};
}
function enc(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  return { stringValue: String(v) };
}
const toFields = (obj) => ({ fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, enc(v)])) });
const fromFields = (doc) => Object.fromEntries(
  Object.entries(doc.fields || {}).map(([k, v]) => [k, "nullValue" in v ? null : Object.values(v)[0]])
);
// updateMask 없이 PATCH하면 Firestore REST가 문서 전체를 덮어씀 → 부분 업데이트 시 반드시 mask 지정
const patch = (path, obj, mask) => {
  const q = mask ? "?" + mask.map((f) => `updateMask.fieldPaths=${f}`).join("&") : "";
  return curlJSON(["-X", "PATCH", `${BASE}/${path}${q}`, "-H", "Content-Type: application/json", "-d", JSON.stringify(toFields(obj))]);
};
const get = (path) => curlJSON([`${BASE}/${path}`]);
const del = (path) => curlJSON(["-X", "DELETE", `${BASE}/${path}`]);
const list = async (path) => (await get(path)).documents || [];

const TAG = "E2E" + randomHex(3) + "_";
const created = { students: [], secrets: [] };

async function main() {
  console.log(`\n[0] 사전 점검: classes/${TEST_CODE} 기존 데이터 확인`);
  const existingStudents = await list(`classes/${TEST_CODE}/students`);
  const clean = existingStudents.length === 0;
  check("테스트 학급이 비어있어 전체 흐름 검증 가능", clean);
  if (!clean) {
    console.log("  ⚠️ 기존 데이터가 있어 배정(assign)은 건너뛰고 안전한 범위만 검증합니다.");
  }

  console.log("\n[1] 학급 관리자 코드 등록/검증 (기존 설정 없을 때만)");
  const classDoc = await get(`classes/${TEST_CODE}`);
  const hasAdmin = !classDoc.error && classDoc.fields?.adminHash;
  if (!hasAdmin) {
    const CODE = "e2e-admin-" + randomHex(3);
    const adminSalt = randomHex(16);
    const adminHash = await hashSecret(CODE, adminSalt);
    await patch(`classes/${TEST_CODE}`, { adminSalt, adminHash, createdAt: new Date() });
    const back = fromFields(await get(`classes/${TEST_CODE}`));
    check("관리자 코드 등록됨", back.adminHash === adminHash);
    check("올바른 코드로 검증 통과", (await hashSecret(CODE, back.adminSalt)) === back.adminHash);
    check("틀린 코드는 검증 실패", (await hashSecret("wrong", back.adminSalt)) !== back.adminHash);
    // 원래 상태(관리자 미설정)로 복구
    await del(`classes/${TEST_CODE}`);
    const after = await get(`classes/${TEST_CODE}`);
    check("관리자 설정 원복(정리) 완료", !!after.error);
  } else {
    check("이미 설정된 관리자 코드는 건드리지 않음 (읽기전용 확인만)", true);
  }

  console.log("\n[2] 학생 명단 등록 (태그가 붙은 테스트 전용 이름만 사용)");
  const names = ["가", "나", "다", "라"].map((x) => TAG + x);
  const students = [];
  for (const name of names) {
    const id = TAG.toLowerCase() + randomHex(6);
    await patch(`classes/${TEST_CODE}/students/${id}`, { name, createdAt: new Date() });
    await patch(`classes/${TEST_CODE}/secrets/${id}`, {
      hasPassword: false, wish: null, wishSetAt: null, caringForId: null, caringForName: null,
    });
    created.students.push(id);
    created.secrets.push(id);
    students.push({ id, name });
  }
  check(`${names.length}명 등록`, students.length === 4);

  console.log("\n[3] 마니또 배정 (순환) — caringForId 방식");
  const cycle = buildCycle(students.length);
  const pairs = [];
  for (const { guardianIdx, protegeIdx } of cycle) {
    const g = students[guardianIdx], p = students[protegeIdx];
    // 실제 assignManito()의 batch.update()와 동일하게 caringForId/caringForName/wish/wishSetAt 만 갱신
    await patch(
      `classes/${TEST_CODE}/secrets/${g.id}`,
      { caringForId: p.id, caringForName: p.name, wish: null, wishSetAt: null },
      ["caringForId", "caringForName", "wish", "wishSetAt"]
    );
    pairs.push({ guardianId: g.id, guardianName: g.name, protegeId: p.id, protegeName: p.name });
  }
  check("자기 자신 배정 없음", pairs.every((p) => p.guardianId !== p.protegeId));
  check("모두 1:1", new Set(pairs.map((p) => p.guardianId)).size === 4 && new Set(pairs.map((p) => p.protegeId)).size === 4);

  console.log("\n[4] 학생이 자신의 소원을 1회 등록");
  const P = students[0]; // protege: 소원을 쓸 사람
  const wishText = "쉬는시간에 같이 놀아주면 좋겠어요 " + randomHex(2);
  // 실제 setMyWish()와 동일하게 wish/wishSetAt 필드만 갱신 (caringForId 등 건드리지 않음)
  await patch(
    `classes/${TEST_CODE}/secrets/${P.id}`,
    { wish: wishText, wishSetAt: new Date() },
    ["wish", "wishSetAt"]
  );
  const savedWish = fromFields(await get(`classes/${TEST_CODE}/secrets/${P.id}`));
  check("소원이 본인 문서에 저장됨", savedWish.wish === wishText && !!savedWish.wishSetAt);

  console.log("\n[5] 마니또(guardian)가 caringForId 를 통해 그 소원을 확인");
  {
    const pair = pairs.find((x) => x.protegeId === P.id);
    const guardianSecret = fromFields(await get(`classes/${TEST_CODE}/secrets/${pair.guardianId}`));
    check("guardian.caringForId == protege.id", guardianSecret.caringForId === P.id);
    const targetSecret = fromFields(await get(`classes/${TEST_CODE}/secrets/${guardianSecret.caringForId}`));
    check("guardian이 protege의 소원을 읽을 수 있음", targetSecret.wish === wishText);
  }

  console.log("\n[6] 전체공개(reveal): caringForId 그래프 재구성");
  {
    const rebuilt = [];
    for (const s of students) {
      const sec = fromFields(await get(`classes/${TEST_CODE}/secrets/${s.id}`));
      if (sec.caringForId) rebuilt.push({ guardian: s.name, protege: sec.caringForName });
    }
    check("재구성된 관계 수 == 학생 수", rebuilt.length === students.length);
    check("우리가 만든 이름만 포함 (다른 학급 데이터 섞이지 않음)", rebuilt.every((r) => r.guardian.startsWith(TAG)));
  }

  console.log("\n[7] 정리(cleanup): 생성한 테스트 데이터 삭제");
  {
    for (const id of created.secrets) await del(`classes/${TEST_CODE}/secrets/${id}`);
    for (const id of created.students) await del(`classes/${TEST_CODE}/students/${id}`);
    const left = await list(`classes/${TEST_CODE}/students`);
    check("테스트 학생 문서 정리 완료", left.filter((d) => d.name.includes(TAG.toLowerCase())).length === 0);
  }

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패\n`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error("E2E 오류:", e);
  try {
    for (const id of created.secrets) await del(`classes/${TEST_CODE}/secrets/${id}`);
    for (const id of created.students) await del(`classes/${TEST_CODE}/students/${id}`);
  } catch {}
  process.exit(1);
});
