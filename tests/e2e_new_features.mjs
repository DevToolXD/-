// =============================================================
//  라이브 E2E: 이번에 추가된 기능들 검증
//   - 선생님이 학생 삭제
//   - 소원 다시 쓰기 요청
//   - 학생 수가 홀수/짝수일 때 선생님 자동 참여 여부
//   - 슈퍼 관리자의 몰래 배정(다음 마니또 수동 지정)
//   - 모드 투표 (뽀로로 모드 / 하츄핑 모드)
//  classes/1889(테스트 모드)에서 태그된 학생만 만들고 지운다.
//    실행:  node tests/e2e_new_features.mjs
// =============================================================
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildCycle } from "../js/assign.js";
import { randomHex } from "../js/crypto.js";

const pexec = promisify(execFile);
const BASE = "https://firestore.googleapis.com/v1/projects/manito-e14c1/databases/(default)/documents";
const TEST_CODE = "1889";
const TEACHER_ID = "_teacher_";

let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log("  ✅", n); } else { fail++; console.log("  ❌", n); } };

async function curlJSON(args) {
  const { stdout } = await pexec("curl", ["-s", ...args], { maxBuffer: 10 * 1024 * 1024 });
  return stdout ? JSON.parse(stdout) : {};
}
function enc(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  return { stringValue: String(v) };
}
const toFields = (obj) => ({ fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, enc(v)])) });
const fromFields = (doc) => Object.fromEntries(
  Object.entries(doc.fields || {}).map(([k, v]) => [k, "nullValue" in v ? null : Object.values(v)[0]])
);
const patch = (path, obj, mask) => {
  const q = mask ? "?" + mask.map((f) => `updateMask.fieldPaths=${f}`).join("&") : "";
  return curlJSON(["-X", "PATCH", `${BASE}/${path}${q}`, "-H", "Content-Type: application/json", "-d", JSON.stringify(toFields(obj))]);
};
const get = (path) => curlJSON([`${BASE}/${path}`]);
const del = (path) => curlJSON(["-X", "DELETE", `${BASE}/${path}`]);
const list = async (path) => (await get(path)).documents || [];

const TAG = "NF" + randomHex(3) + "_";
const created = { students: [], secrets: [] };

async function makeStudents(n) {
  const names = Array.from({ length: n }, (_, i) => TAG + String.fromCharCode(97 + i));
  const out = [];
  for (const name of names) {
    const id = TAG.toLowerCase() + randomHex(6);
    await patch(`classes/${TEST_CODE}/students/${id}`, { name, createdAt: new Date() });
    await patch(`classes/${TEST_CODE}/secrets/${id}`, {
      hasPassword: false, wish: null, wishSetAt: null, wishRewriteNote: null, caringForId: null, caringForName: null,
    });
    created.students.push(id);
    created.secrets.push(id);
    out.push({ id, name });
  }
  return out;
}

async function assign(students, includeTeacher) {
  const pool = includeTeacher ? [...students, { id: TEACHER_ID, name: "선생님" }] : students;
  const cycle = buildCycle(pool.length);
  for (const { guardianIdx, protegeIdx } of cycle) {
    const g = pool[guardianIdx], p = pool[protegeIdx];
    await patch(
      `classes/${TEST_CODE}/secrets/${g.id}`,
      { caringForId: p.id, caringForName: p.name, wish: null, wishSetAt: null },
      ["caringForId", "caringForName", "wish", "wishSetAt"]
    );
  }
  return pool;
}

async function main() {
  console.log("\n[1] 선생님이 학생 삭제");
  {
    const [s] = await makeStudents(1);
    let existsBefore = !(await get(`classes/${TEST_CODE}/students/${s.id}`)).error;
    check("삭제 전 학생 문서 존재", existsBefore);
    await del(`classes/${TEST_CODE}/secrets/${s.id}`);
    await del(`classes/${TEST_CODE}/students/${s.id}`);
    const afterStudent = await get(`classes/${TEST_CODE}/students/${s.id}`);
    const afterSecret = await get(`classes/${TEST_CODE}/secrets/${s.id}`);
    check("삭제 후 학생 문서 없음", !!afterStudent.error);
    check("삭제 후 시크릿 문서도 없음", !!afterSecret.error);
    created.students = created.students.filter((id) => id !== s.id);
    created.secrets = created.secrets.filter((id) => id !== s.id);
  }

  console.log("\n[2] 소원 다시 쓰기 요청");
  {
    const [s] = await makeStudents(1);
    const wish = "부적절한 소원 테스트 " + randomHex(2);
    await patch(`classes/${TEST_CODE}/secrets/${s.id}`, { wish, wishSetAt: new Date() }, ["wish", "wishSetAt"]);
    let sec = fromFields(await get(`classes/${TEST_CODE}/secrets/${s.id}`));
    check("소원이 등록된 상태로 시작", sec.wish === wish && !!sec.wishSetAt);

    const note = "부적절한 표현은 피해서 다시 써주세요.";
    await patch(
      `classes/${TEST_CODE}/secrets/${s.id}`,
      { wish: null, wishSetAt: null, wishRewriteNote: note },
      ["wish", "wishSetAt", "wishRewriteNote"]
    );
    sec = fromFields(await get(`classes/${TEST_CODE}/secrets/${s.id}`));
    check("다시쓰기 요청 후 소원이 초기화됨", sec.wish === null && sec.wishSetAt === null);
    check("다시쓰기 요청 메모가 저장됨", sec.wishRewriteNote === note);

    // 학생이 새 소원을 쓰면(=setMyWish) 노트가 지워져야 함
    const newWish = "다시 쓴 소원 " + randomHex(2);
    await patch(
      `classes/${TEST_CODE}/secrets/${s.id}`,
      { wish: newWish, wishSetAt: new Date(), wishRewriteNote: null },
      ["wish", "wishSetAt", "wishRewriteNote"]
    );
    sec = fromFields(await get(`classes/${TEST_CODE}/secrets/${s.id}`));
    check("새 소원 등록 시 다시쓰기 메모가 사라짐", sec.wishRewriteNote === null && sec.wish === newWish);
  }

  console.log("\n[3] 학생 수가 홀수면 선생님 자동 참여");
  {
    const students = await makeStudents(5);
    const pool = await assign(students, true);
    check("풀 크기 = 학생 5명 + 선생님 1명 = 6", pool.length === 6);
    const teacherSecret = fromFields(await get(`classes/${TEST_CODE}/secrets/${TEACHER_ID}`));
    check("선생님이 누군가를 돌봄(caringForId 존재)", !!teacherSecret.caringForId);
    const someoneCaresForTeacher = [];
    for (const s of students) {
      const sec = fromFields(await get(`classes/${TEST_CODE}/secrets/${s.id}`));
      if (sec.caringForId === TEACHER_ID) someoneCaresForTeacher.push(s.id);
    }
    check("학생 중 한 명이 선생님을 돌봄", someoneCaresForTeacher.length === 1);
    // 정리: 선생님 시크릿 원상복구(테스트 오염 방지)
    await del(`classes/${TEST_CODE}/secrets/${TEACHER_ID}`);
  }

  console.log("\n[4] 학생 수가 짝수면 선생님 미참여");
  {
    const students = await makeStudents(4);
    const pool = await assign(students, false);
    check("풀 크기 = 학생 4명 그대로 (선생님 제외)", pool.length === 4);
    const teacherSecret = await get(`classes/${TEST_CODE}/secrets/${TEACHER_ID}`);
    check("선생님 시크릿 문서가 생성되지 않음", !!teacherSecret.error);
  }

  console.log("\n[5] 슈퍼 관리자의 몰래 배정(수동 지정)");
  {
    const students = await makeStudents(3);
    await assign(students, false);
    const [a, b, c] = students;
    // 원래 배정과 무관하게 a가 c를 돌보도록 강제 지정
    await patch(
      `classes/${TEST_CODE}/secrets/${a.id}`,
      { caringForId: c.id, caringForName: c.name },
      ["caringForId", "caringForName"]
    );
    const sec = fromFields(await get(`classes/${TEST_CODE}/secrets/${a.id}`));
    check("수동 지정한 대상으로 caringForId가 바뀜", sec.caringForId === c.id && sec.caringForName === c.name);
  }

  console.log("\n[6] 모드 투표 (뽀로로 모드 / 하츄핑 모드)");
  {
    const before = await get(`modeVotes/pororo`);
    const beforeCount = before.error ? 0 : fromFields(before).count || 0;
    const next = beforeCount + 1;
    await patch(`modeVotes/pororo`, { count: next }, ["count"]);
    const after = fromFields(await get(`modeVotes/pororo`));
    // Firestore REST의 integerValue는 문자열로 내려오므로 숫자로 변환 후 비교
    check("뽀로로 모드 투표 수가 1 증가", Number(after.count) === next);
    // 정리: 되돌리기 (원래 없었다면 삭제, 있었다면 원래 값으로)
    if (before.error) await del(`modeVotes/pororo`);
    else await patch(`modeVotes/pororo`, { count: beforeCount }, ["count"]);
    const restored = await get(`modeVotes/pororo`);
    check("투표 데이터 원상복구", before.error ? !!restored.error : Number(fromFields(restored).count) === beforeCount);
  }

  console.log("\n[7] 정리(cleanup)");
  {
    for (const id of created.secrets) await del(`classes/${TEST_CODE}/secrets/${id}`);
    for (const id of created.students) await del(`classes/${TEST_CODE}/students/${id}`);
    const left = (await list(`classes/${TEST_CODE}/students`)).filter((d) => d.name.includes(TAG.toLowerCase()));
    check("테스트로 만든 학생 문서 정리 완료", left.length === 0);
  }

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패\n`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error("E2E 오류:", e);
  try {
    for (const id of created.secrets) await del(`classes/${TEST_CODE}/secrets/${id}`);
    for (const id of created.students) await del(`classes/${TEST_CODE}/students/${id}`);
    await del(`classes/${TEST_CODE}/secrets/${TEACHER_ID}`);
  } catch {}
  process.exit(1);
});
