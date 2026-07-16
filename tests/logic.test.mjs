// 순수 로직 검증용 Node 테스트 (네트워크/Firebase 불필요)
//   실행:  node tests/logic.test.mjs
import { buildCycle } from "../js/assign.js";
import { encryptJSON, decryptJSON, hashSecret, randomHex } from "../js/crypto.js";

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

console.log("\n[2] 관리자 코드 암호화 라운드트립 (AES-GCM)");
{
  const mapping = { assignedAt: new Date().toISOString(), pairs: [
    { guardianName: "김철수", protegeName: "이영희" },
    { guardianName: "이영희", protegeName: "박민수" },
  ]};
  const code = "secret-teacher-code-123";
  const enc = await encryptJSON(mapping, code);
  check("암호문에 salt/iv/ct 포함", enc.salt && enc.iv && enc.ct);
  check("암호문이 원문 이름을 노출하지 않음", !enc.ct.includes("김철수"));
  const dec = await decryptJSON(enc, code);
  check("올바른 코드로 복호화 성공", JSON.stringify(dec) === JSON.stringify(mapping));
  let wrongFailed = false;
  try { await decryptJSON(enc, "wrong-code"); } catch { wrongFailed = true; }
  check("틀린 코드로는 복호화 실패", wrongFailed);
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
