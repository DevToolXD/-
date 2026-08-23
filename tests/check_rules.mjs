// =============================================================
//  지금 게시된 Firestore 규칙이 firestore.rules 와 맞는지 확인
// =============================================================
//  실행: node tests/check_rules.mjs
//
//  앱 안에서도 전체 관리자 화면의 "서버 규칙" 칸이 같은 확인을 하지만,
//  브라우저를 열지 않고 확인하고 싶을 때 쓴다. 로그인 없이 웹 API 키로
//  실제 요청을 보내 보는 방식이라, 규칙 파일을 읽는 게 아니라 "지금 서버가
//  실제로 무엇을 허용하는지"를 본다.
import { firebaseConfig as CFG } from "../config.js";

const BASE = `https://firestore.googleapis.com/v1/projects/${CFG.projectId}` +
             `/databases/(default)/documents`;
const key = `key=${CFG.apiKey}`;

const req = async (path, init) => {
  try {
    const r = await fetch(`${BASE}/${path}${path.includes("?") ? "&" : "?"}${key}`, init);
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, status: 0, net: String(e.message || e) };
  }
};
const list = (p) => req(`${p}?pageSize=1`);
const get  = (p) => req(p);

// 최신 규칙에서만 열리는 자리들. 하나라도 막혀 있으면 예전 버전이다.
const CHECKS = [
  { name: "adminAccounts 목록 읽기", run: () => list("adminAccounts"),
    why: "전체 관리자 화면의 '관리자 계정' 목록" },
  { name: "eggStats 목록 읽기", run: () => list("eggStats"),
    why: "이스터에그 발견자 수(문서 하나씩 읽기로 우회 중)" },
];
// 이미 열려 있어야 정상인 자리들 — 여기서 막히면 규칙이 잘못 올라간 것이다.
const SHOULD_WORK = [
  { name: "voteItems 목록 읽기", run: () => list("voteItems") },
  { name: "feedback 목록 읽기", run: () => list("feedback") },
  { name: "adInquiries 목록 읽기", run: () => list("adInquiries") },
  { name: "학급 학생 목록 읽기", run: () => list("classes/0603/students") },
  { name: "eggStats 한 건 읽기", run: () => get("eggStats/vote") },
];

let missing = 0, broken = 0, offline = 0;

console.log(`\n프로젝트: ${CFG.projectId}\n`);
console.log("[1] 최신 규칙에서만 열리는 자리");
for (const c of CHECKS) {
  const r = await c.run();
  if (r.status === 0) { offline++; console.log(`  ??  ${c.name} — 네트워크 실패 (${r.net})`); continue; }
  if (r.ok) console.log(`  OK  ${c.name}`);
  else { missing++; console.log(`  --  ${c.name} (${r.status}) → ${c.why}`); }
}

console.log("\n[2] 이미 열려 있어야 하는 자리");
for (const c of SHOULD_WORK) {
  const r = await c.run();
  if (r.status === 0) { offline++; console.log(`  ??  ${c.name} — 네트워크 실패`); continue; }
  if (r.ok) console.log(`  OK  ${c.name}`);
  else { broken++; console.log(`  X   ${c.name} (${r.status})`); }
}

console.log("");
if (offline) {
  console.log("네트워크가 막혀 있어 확인하지 못했습니다.");
  process.exit(2);
}
if (broken) {
  console.log(`정상이어야 할 자리 ${broken}군데가 막혀 있습니다.`);
  console.log("firestore.rules 를 그대로 다시 붙여넣고 게시해 주세요.");
  process.exit(1);
}
if (missing) {
  console.log(`아직 안 올린 규칙이 있습니다 (${missing}군데).`);
  console.log("앱은 정상 동작하지만, 위에 적힌 기능은 기기 하나에서만 동작합니다.");
  console.log("");
  console.log(`  1) https://console.firebase.google.com/project/${CFG.projectId}/firestore/rules`);
  console.log("  2) 규칙 칸을 전부 지우고 firestore.rules 내용을 붙여넣기");
  console.log("  3) 게시 → 이 명령을 다시 실행");
  process.exit(1);
}
console.log("게시된 규칙이 firestore.rules 와 맞습니다. 더 하실 일 없습니다.");
