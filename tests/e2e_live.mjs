// =============================================================
//  라이브 E2E: 실제 Firebase(manito-e14c1) 백엔드에 대해
//  배정 → 메시지 전송 → 조회 → 전체공개 흐름을 검증하고 정리(cleanup).
//  HTTP 는 curl(프록시 통과)로, 로직/암호화는 실제 앱 모듈로 수행.
//    실행:  node tests/e2e_live.mjs
// =============================================================
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildCycle } from "../js/assign.js";
import { randomHex, hashSecret, encryptJSON, decryptJSON } from "../js/crypto.js";

const pexec = promisify(execFile);
const BASE =
  "https://firestore.googleapis.com/v1/projects/manito-e14c1/databases/(default)/documents";

let pass = 0, fail = 0;
const created = { students: [], secrets: [], channels: new Set(), meta: [] };
function check(name, cond) {
  if (cond) { pass++; console.log("  ✅", name); }
  else { fail++; console.log("  ❌", name); }
}

// ---- Firestore REST (curl) ----
async function curlJSON(args) {
  const { stdout } = await pexec("curl", ["-s", ...args], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout ? JSON.parse(stdout) : {};
}
function enc(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  return { stringValue: String(v) };
}
function toFields(obj) {
  const fields = {};
  for (const [k, val] of Object.entries(obj)) fields[k] = enc(val);
  return { fields };
}
function fromFields(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) {
    out[k] = "nullValue" in v ? null : Object.values(v)[0];
  }
  return out;
}
const patch = (path, obj) =>
  curlJSON(["-X", "PATCH", `${BASE}/${path}`, "-H", "Content-Type: application/json",
            "-d", JSON.stringify(toFields(obj))]);
const post = (path, obj) =>
  curlJSON(["-X", "POST", `${BASE}/${path}`, "-H", "Content-Type: application/json",
            "-d", JSON.stringify(toFields(obj))]);
const get = (path) => curlJSON([`${BASE}/${path}`]);
const del = (path) => curlJSON(["-X", "DELETE", `${BASE}/${path}`]);
const list = async (path) => (await get(path)).documents || [];

const CODE = "TEST-ADMIN-" + randomHex(3);
const TAG = "【E2E-" + randomHex(2) + "】";

async function main() {
  console.log("\n[1] 관리자 코드 등록 + 검증");
  {
    const adminSalt = randomHex(16);
    const adminHash = await hashSecret(CODE, adminSalt);
    await patch("meta/e2e_config", { adminSalt, adminHash });
    created.meta.push("e2e_config");
    const back = fromFields(await get("meta/e2e_config"));
    check("관리자 설정 저장됨", back.adminHash === adminHash);
    check("올바른 코드 검증 통과", (await hashSecret(CODE, back.adminSalt)) === back.adminHash);
    check("틀린 코드 검증 실패", (await hashSecret("nope", back.adminSalt)) !== back.adminHash);
  }

  console.log("\n[2] 학생 명단 등록");
  const names = ["가", "나", "다", "라", "마"].map((x) => TAG + x);
  const students = [];
  for (const name of names) {
    const id = "e2e_" + randomHex(6);
    await patch(`students/${id}`, { name, createdAt: new Date() });
    await patch(`secrets/${id}`, { hasPassword: false, sendChannel: null, readChannel: null });
    created.students.push(id);
    created.secrets.push(id);
    students.push({ id, name });
  }
  check(`${names.length}명 등록`, students.length === 5);

  console.log("\n[3] 마니또 배정 (순환) + 매핑 암호화 저장");
  const cycle = buildCycle(students.length);
  const updates = new Map(students.map((s) => [s.id, { hasPassword: false }]));
  const pairs = [];
  for (const { guardianIdx, protegeIdx } of cycle) {
    const g = students[guardianIdx], p = students[protegeIdx];
    const channel = randomHex(16);
    created.channels.add(channel);
    updates.get(g.id).readChannel = channel;
    updates.get(p.id).sendChannel = channel;
    pairs.push({ guardianId: g.id, guardianName: g.name, protegeId: p.id, protegeName: p.name });
  }
  for (const [id, fields] of updates) {
    await patch(`secrets/${id}`, {
      hasPassword: false,
      sendChannel: fields.sendChannel ?? null,
      readChannel: fields.readChannel ?? null,
    });
  }
  const encrypted = await encryptJSON({ assignedAt: new Date().toISOString(), pairs }, CODE);
  await patch("meta/e2e_mapping", encrypted);
  created.meta.push("e2e_mapping");
  check("자기 자신 배정 없음", pairs.every((p) => p.guardianId !== p.protegeId));
  check("모두 1:1 (수호자/대상 각 1회)",
    new Set(pairs.map((p) => p.guardianId)).size === 5 &&
    new Set(pairs.map((p) => p.protegeId)).size === 5);

  console.log("\n[4] 전체공개(reveal): 관리자 코드로만 복호화 가능");
  {
    const stored = fromFields(await get("meta/e2e_mapping"));
    check("저장된 매핑에 평문 이름 없음(암호문)",
      !JSON.stringify(stored).includes(TAG));
    const revealed = await decryptJSON(stored, CODE);
    check("올바른 코드로 복호화 → pairs 복원",
      revealed.pairs.length === 5 && revealed.pairs[0].guardianName.startsWith(TAG));
    let blocked = false;
    try { await decryptJSON(stored, "STUDENT-GUESS"); } catch { blocked = true; }
    check("틀린 코드(학생)로는 복호화 불가", blocked);
  }

  console.log("\n[5] 소원 메시지: 대상이 보내고 → 수호자가 익명으로 받음");
  {
    // 대상 P(가) 가 자기 sendChannel 로 소원 전송
    const P = students[0];
    const pSecret = fromFields(await get(`secrets/${P.id}`));
    const wish = "다음 수학시간에 짝지어 도와주면 좋겠어요! " + randomHex(2);
    await post(`channels/${pSecret.sendChannel}/messages`, { text: wish, createdAt: new Date() });

    // 그 채널을 readChannel 로 가진 수호자 G 를 찾는다
    const pair = pairs.find((x) => x.protegeId === P.id);
    const G = students.find((s) => s.id === pair.guardianId);
    const gSecret = fromFields(await get(`secrets/${G.id}`));
    check("수호자 readChannel == 대상 sendChannel", gSecret.readChannel === pSecret.sendChannel);

    const msgs = await list(`channels/${gSecret.readChannel}/messages`);
    const texts = msgs.map((m) => fromFields(m).text);
    check("수호자 소원함에 메시지 도착", texts.includes(wish));
    const anon = msgs.every((m) => {
      const f = fromFields(m);
      return !("sender" in f) && !("name" in f) && !("from" in f);
    });
    check("메시지에 발신자 정보 없음(익명)", anon);
  }

  console.log("\n[6] 정리(cleanup): 생성한 테스트 데이터 삭제");
  {
    for (const cid of created.channels) {
      for (const m of await list(`channels/${cid}/messages`)) {
        const short = m.name.split("/documents/")[1];
        await del(short);
      }
    }
    for (const id of created.students) await del(`students/${id}`);
    for (const id of created.secrets) await del(`secrets/${id}`);
    for (const id of created.meta) await del(`meta/${id}`);
    // 확인
    const leftS = (await list("students")).filter((d) => d.name.includes("/students/e2e_"));
    check("테스트 학생 문서 정리 완료", leftS.length === 0);
    const cfg = await get("meta/e2e_config");
    check("테스트 meta 정리 완료", !!cfg.error || Object.keys(cfg).length === 0);
  }

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패\n`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error("E2E 오류:", e);
  // 오류 시에도 최대한 정리
  try {
    for (const id of created.students) await del(`students/${id}`);
    for (const id of created.secrets) await del(`secrets/${id}`);
    for (const id of created.meta) await del(`meta/${id}`);
  } catch {}
  process.exit(1);
});
