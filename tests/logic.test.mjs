// 순수 로직 검증용 Node 테스트 (네트워크/Firebase 불필요)
//   실행:  node tests/logic.test.mjs
import { buildCycle } from "../js/assign.js";
import { hashSecret, randomHex } from "../js/crypto.js";

let pass = 0,
  fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ✅", name); }
  else { fail++; console.log("  ❌", name); }
}

console.log("\n[1] 배정 로직 (buildCycle) — 자기제외 / 1:1 / 중복없음 / 단일순환");
for (const n of [2, 3, 5, 10, 30, 31]) {
  for (let t = 0; t < 300; t++) {
    const pairs = buildCycle(n);
    const noSelf = pairs.every((p) => p.guardianIdx !== p.protegeIdx);
    const guardians = new Set(pairs.map((p) => p.guardianIdx));
    const proteges = new Set(pairs.map((p) => p.protegeIdx));
    const bijection =
      guardians.size === n && proteges.size === n && pairs.length === n;
    // 단일 순환인지: guardian→protege 를 따라가면 n스텝 만에 전부 방문
    const next = new Map(pairs.map((p) => [p.guardianIdx, p.protegeIdx]));
    let cur = 0, seen = new Set();
    for (let k = 0; k < n; k++) { seen.add(cur); cur = next.get(cur); }
    const singleCycle = seen.size === n && cur === 0;
    if (!noSelf || !bijection || !singleCycle) {
      check(`n=${n} trial=${t}`, false);
      t = 1e9; n; break;
    }
  }
  check(`n=${n}: 300회 모두 유효한 배정`, true);
}
check("n<2 이면 예외", (() => { try { buildCycle(1); return false; } catch { return true; } })());

console.log("\n[2] caringForId 그래프 재구성 (슈퍼 관리자 열람 로직과 동일한 방식)");
{
  const students = ["김철수", "이영희", "박민수", "최지우"].map((name, i) => ({ id: "s" + i, name }));
  const pairs = buildCycle(students.length);
  // assignManito()가 하는 것과 동일: guardian 문서에 caringForId 를 저장
  const secrets = new Map(students.map((s) => [s.id, { caringForId: null, caringForName: null }]));
  for (const { guardianIdx, protegeIdx } of pairs) {
    secrets.get(students[guardianIdx].id).caringForId = students[protegeIdx].id;
    secrets.get(students[protegeIdx].id); // 존재 확인
  }
  // revealMapping()과 동일한 재구성
  const rebuilt = students
    .filter((s) => secrets.get(s.id).caringForId)
    .map((s) => ({ guardian: s.name, protege: students.find((x) => x.id === secrets.get(s.id).caringForId).name }));
  check("재구성된 관계 수 == 학생 수", rebuilt.length === students.length);
  check("자기 자신에게 배정된 관계 없음", rebuilt.every((r) => r.guardian !== r.protege));
}

console.log("\n[3] 비밀번호 해시 (PBKDF2)");
{
  const salt = randomHex(16);
  const h1 = await hashSecret("1234", salt);
  const h2 = await hashSecret("1234", salt);
  const h3 = await hashSecret("9999", salt);
  check("같은 입력+같은 salt → 동일 해시", h1 === h2);
  check("다른 비번 → 다른 해시", h1 !== h3);
  check("해시에 원문 비번 미포함", !h1.includes("1234"));
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패\n`);
process.exit(fail ? 1 : 0);
