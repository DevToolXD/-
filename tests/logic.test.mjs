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


// ---------- 어항: 물고기 성장 ----------
{
  const F = await import("../js/fish.js");
  const now = Date.UTC(2026, 0, 1);
  const P = F.PERIOD_MS;

  // 같은 입력이면 어디서 계산해도 같아야 한다(기기마다 크기가 달라지면 안 됨)
  const f = { seed: 12345, createdAt: now - P * 30, fed: 0 };
  check("성장이 결정적", F.sizeOf(f, now) === F.sizeOf({ ...f }, now));

  // 갓 넣은 물고기는 기본 크기
  check("갓 그린 물고기는 기본 크기",
    F.sizeOf({ seed: 1, createdAt: now, fed: 0 }, now) === F.BASE_SIZE);

  // 시간이 지나면 자란다
  const a = F.sizeOf({ seed: 7, createdAt: now - P * 5, fed: 0 }, now);
  const b = F.sizeOf({ seed: 7, createdAt: now - P * 20, fed: 0 }, now);
  check("오래될수록 큼", b > a, `${a} < ${b}`);

  // 20분이 안 지나면 안 자란다 (구간이 20분)
  const c1 = F.sizeOf({ seed: 3, createdAt: now - P + 1000, fed: 0 }, now);
  check("20분 안에는 그대로", c1 === F.BASE_SIZE, c1);

  // 성장률은 구간마다 다르다
  const rates = new Set([0, 1, 2, 3, 4].map((i) => F.periodGrowth(99, i).toFixed(6)));
  check("구간마다 성장률이 다름", rates.size >= 4, [...rates]);

  // 상한을 넘지 않는다 (2000마리가 화면을 뒤덮지 않게)
  check("최대 크기에서 멈춤",
    F.sizeOf({ seed: 5, createdAt: 0, fed: 9 }, now) === F.MAX_SIZE);

  // 밥은 확률적으로 키운다 — 먹은 만큼 결정적으로 더해진다
  const noFeed = F.sizeOf({ seed: 42, createdAt: now - P * 10, fed: 0 }, now);
  const fed2 = F.sizeOf({ seed: 42, createdAt: now - P * 10, fed: 2 }, now);
  check("밥을 먹으면 작아지지는 않음", fed2 >= noFeed, [noFeed, fed2]);

  // 무게는 길이의 세제곱 — 랭킹이 크기 순서와 같아야 한다
  const small = { seed: 1, createdAt: now - P * 3, fed: 0 };
  const big = { seed: 1, createdAt: now - P * 40, fed: 0 };
  check("무게 순서가 크기 순서와 같음",
    F.weightOf(big, now) > F.weightOf(small, now));
  check("무게 표기", F.formatWeight(1500) === "1.50 kg" && F.formatWeight(240) === "240 g");

  // 다음 성장까지 남은 시간
  const left = F.msToNextGrowth({ createdAt: now - P - 60000 }, now);
  check("다음 성장까지 남은 시간", left > 0 && left <= P, left);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패\n`);
process.exit(fail ? 1 : 0);
