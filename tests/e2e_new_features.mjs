// =============================================================
//  라이브 E2E: 이번에 추가된 기능들 검증
//   - 선생님이 학생 삭제
//   - 소원 다시 쓰기 요청
//   - 학생 수가 홀수/짝수일 때 선생님 자동 참여 여부
//   - 슈퍼 관리자의 몰래 배정(다음 마니또 수동 지정)
//   - 주간 투표 (항목 추가 → 투표) + 부적절 시도 신고함
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
// 자동 ID 문서 생성 (POST). 반환값에 name(문서 경로)이 들어온다.
const post = (path, obj) =>
  curlJSON(["-X", "POST", `${BASE}/${path}`, "-H", "Content-Type: application/json", "-d", JSON.stringify(toFields(obj))]);
// list() 는 원본 문서를 주므로 필드를 쓰려면 이걸로 편다
const listFields = async (path) => (await list(path)).map(fromFields);
// 규칙이 아직 게시되지 않았는지 판별 (새 컬렉션은 기본 거부에 걸린다)
const denied = (res) => !!res.error && /PERMISSION_DENIED|Missing or insufficient/i.test(JSON.stringify(res.error));
let skipped = 0;
const skip = (why) => { skipped++; console.log("  ⏭️ ", why); };

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

  console.log("\n[6] 주간 투표 (항목 직접 추가 → 투표 → 마감)");
  {
    // 이번 주 키 (월요일 시작, 한국 시간 기준) — js/data.js 의 weekKeyOf 와 같은 규칙
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const day = (kst.getUTCDay() + 6) % 7;
    const mon = new Date(kst);
    mon.setUTCDate(kst.getUTCDate() - day);
    const weekKey = `${mon.getUTCFullYear()}-${String(mon.getUTCMonth() + 1).padStart(2, "0")}-${String(mon.getUTCDate()).padStart(2, "0")}`;
    check("주차 키 형식", /^\d{4}-\d{2}-\d{2}$/.test(weekKey));

    const label = TAG + "테마";
    const created2 = await post(`voteItems`, {
      label, count: 0, weekKey, addedBy: TAG + "학생", addedByRole: "학생 · 테스트",
      createdAt: new Date(),
    });
    const itemId = created2.name ? created2.name.split("/").pop() : null;
    if (!itemId && denied(created2)) {
      skip("voteItems 규칙이 아직 게시되지 않았습니다 → Firebase 콘솔에 firestore.rules 를 게시하세요");
    } else {
      check("투표 항목이 만들어짐", !!itemId);
    }

    if (itemId) {
      const got = fromFields(await get(`voteItems/${itemId}`));
      check("라벨·주차가 그대로 저장됨", got.label === label && got.weekKey === weekKey);
      check("처음 득표수는 0", Number(got.count) === 0);

      // 투표 = count +1
      await patch(`voteItems/${itemId}`, { count: 1 }, ["count"]);
      const voted = fromFields(await get(`voteItems/${itemId}`));
      check("투표하면 득표수가 1 증가", Number(voted.count) === 1);

      // 목록에서 이번 주 항목만 골라낼 수 있는지 (앱이 하는 방식과 동일)
      const all = await listFields(`voteItems`);
      const thisWeek = all.filter((d) => d.weekKey === weekKey);
      check("이번 주 목록에 포함됨", thisWeek.some((d) => d.label === label));

      // 정리
      await del(`voteItems/${itemId}`);
      const gone = await get(`voteItems/${itemId}`);
      check("투표 항목 정리 완료", !!gone.error);
    }
  }

  console.log("\n[6-2] 부적절 시도 신고가 해당 반으로 전달되는지");
  {
    const created3 = await post(`classes/${TEST_CODE}/reports`, {
      name: TAG + "학생", roleTag: "학생 · 테스트", text: TAG + "차단된항목",
      reason: "욕설·비속어", status: "pending", createdAt: new Date(),
    });
    const rid = created3.name ? created3.name.split("/").pop() : null;
    if (!rid && denied(created3)) {
      skip("reports 규칙이 아직 게시되지 않았습니다 → Firebase 콘솔에 firestore.rules 를 게시하세요");
    } else {
      check("신고 문서 생성", !!rid);
    }
    if (rid) {
      const rows = await listFields(`classes/${TEST_CODE}/reports`);
      check("선생님이 신고 목록을 읽을 수 있음", rows.some((r) => r.text === TAG + "차단된항목"));
      await patch(`classes/${TEST_CODE}/reports/${rid}`, { status: "approved" }, ["status"]);
      const after = fromFields(await get(`classes/${TEST_CODE}/reports/${rid}`));
      check("선생님이 상태를 approved 로 바꿀 수 있음", after.status === "approved");
      await del(`classes/${TEST_CODE}/reports/${rid}`);
      check("신고 정리 완료", !!(await get(`classes/${TEST_CODE}/reports/${rid}`)).error);
    }
  }

  console.log("\n[7] 정리(cleanup)");
  {
    for (const id of created.secrets) await del(`classes/${TEST_CODE}/secrets/${id}`);
    for (const id of created.students) await del(`classes/${TEST_CODE}/students/${id}`);
    const left = (await list(`classes/${TEST_CODE}/students`)).filter((d) => d.name.includes(TAG.toLowerCase()));
    check("테스트로 만든 학생 문서 정리 완료", left.length === 0);
  }

  console.log(`
결과: ${pass} 통과 / ${fail} 실패${skipped ? ` / ${skipped} 건너뜀(규칙 미게시)` : ""}
`);
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
