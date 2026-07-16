// =============================================================
//  순수 배정 로직 (외부 의존성 없음 → 브라우저/Node 양쪽에서 테스트 가능)
// =============================================================

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 순환(사이클) 방식 배정: 자기 자신 제외, 1:1, 중복 없음 보장.
// order[i] 가 order[i+1] 의 마니또(수호자)가 된다. (마지막은 첫번째로 순환)
// 반환: [{ guardianIdx, protegeIdx }, ...]  (인덱스는 원본 배열 기준)
export function buildCycle(n) {
  if (n < 2) throw new Error("학생이 2명 이상이어야 합니다.");
  const idx = shuffle([...Array(n).keys()]);
  return idx.map((g, i) => ({
    guardianIdx: g,
    protegeIdx: idx[(i + 1) % n],
  }));
}
