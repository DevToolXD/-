// =============================================================
//  한국어 조사 붙이기
// =============================================================
//  "밥 주기을(를) 너무 빨리 했어요" 처럼 괄호로 두 갈래를 다 적어 두면
//  읽을 때 걸린다. 앞말의 마지막 한글에 받침이 있는지 보고 하나만 고른다.
//
//  마지막 글자가 한글이 아니면(이름이 "Kim", "3반)" 같은 경우) 뒤에서부터
//  가장 가까운 한글을 찾는다. 그래도 없으면 받침 없는 쪽으로 둔다.

/** 마지막 한글 음절에 받침이 있으면 true. 한글이 하나도 없으면 null. */
export function hasFinalConsonant(word) {
  const s = String(word ?? "");
  for (let i = s.length - 1; i >= 0; i--) {
    const c = s.charCodeAt(i);
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 !== 0;
  }
  return null;
}

/**
 * 앞말에 맞는 조사를 붙여 돌려준다.
 *   josa("밥 주기", "을", "를")  -> "밥 주기를"
 *   josa("소원 등록", "을", "를") -> "소원 등록을"
 * @param {string} word 앞말
 * @param {string} withBatchim 받침이 있을 때 쓸 조사 (을/은/이/과/으로)
 * @param {string} without      받침이 없을 때 쓸 조사 (를/는/가/와/로)
 */
export function josa(word, withBatchim, without) {
  const has = hasFinalConsonant(word);
  return `${word}${has === null ? without : has ? withBatchim : without}`;
}

export const eul = (w) => josa(w, "을", "를");
export const eun = (w) => josa(w, "은", "는");
export const iga = (w) => josa(w, "이", "가");
