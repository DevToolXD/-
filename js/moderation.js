// =============================================================
//  투표 항목 검열 (성적인 표현 · 특정인 비하 · 욕설)
// =============================================================
//  이 필터는 "완벽한 판정기"가 아니라 "1차 거름망"입니다. 일부러 띄어쓰기나
//  특수문자를 끼워 넣어 우회하는 시도까지 잡으려고 정규화를 거치지만,
//  새로운 은어는 언제든 빠져나갈 수 있고 반대로 멀쩡한 말이 걸릴 수도
//  있습니다. 그래서 걸린 항목은 삭제하지 않고 선생님 신고함으로 보내,
//  선생님이 "잘못된 판정"이라고 판단하면 그대로 투표 목록에 올립니다.
// =============================================================

// 한글 음절에서 초성만 뽑아낸다 ("시발" → "ㅅㅂ").
// ㅅㅂ, ㅄ 처럼 초성만 적어 우회하는 경우를 같은 문자열로 만들어 비교한다.
const CHOSUNG = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];

export function toChosung(text) {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      out += CHOSUNG[Math.floor((code - 0xac00) / 588)];
    } else if (/[ㄱ-ㅎ]/.test(ch)) {
      out += ch;
    }
  }
  return out;
}

const JUNGSUNG = [
  "ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ",
  "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ",
];
const JONGSUNG = [
  "", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ",
  "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ",
  "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];

// 한글을 자모로 풀어헤친 뒤 소리 없는 초성 ㅇ을 지우고 반복 자모를 합친다.
// "시이이이발" → ㅅㅣㅣㅣㅣㅂㅏㄹ → ㅅㅣㅂㅏㄹ = "시발" 과 같은 문자열이 되어,
// 글자를 끼워 넣어 필터를 피하려는 시도를 잡아낸다.
export function toJamo(text) {
  let out = "";
  for (const ch of String(text ?? "").toLowerCase()) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const i = code - 0xac00;
      const cho = CHOSUNG[Math.floor(i / 588)];
      const jung = JUNGSUNG[Math.floor((i % 588) / 28)];
      const jong = JONGSUNG[i % 28];
      if (cho !== "ㅇ") out += cho; // 초성 ㅇ은 음가가 없어 끼워넣기에 쓰인다
      out += jung + jong;
    } else if (/[0-9a-z]/.test(ch)) {
      out += ch;
    }
  }
  return out.replace(/(.)\1+/g, "$1");
}

// 공백·문장부호·이모지를 걷어내고, 같은 글자를 3번 이상 늘여 쓴 것을
// 2번으로 줄인다 ("시이이이발" 류의 늘려쓰기 우회 대응).
export function normalizeForScreening(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[\s​-‏﻿]/g, "")
    .replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]/g, "")
    .replace(/(.)\1{2,}/g, "$1$1");
}

// ---- 금칙어 목록 ----
// 짧은 낱말은 멀쩡한 단어에 섞여 오탐이 나므로(예: "성" → "성실"),
// 되도록 그 자체로 뜻이 분명한 형태만 넣는다.
const SEXUAL = [
  "섹스", "sex", "야동", "포르노", "porn", "자위", "몸캠", "성관계", "성행위",
  "보지", "자지", "꼬추", "젖가슴", "가슴만지", "엉덩이만지", "애무", "변태",
  "강간", "성폭행", "성추행", "성희롱", "19금", "알몸", "나체", "벗기기",
  "야한", "야설", "에로", "딸딸", "빨아줘", "박아줘",
];
const PROFANITY = [
  "시발", "씨발", "시팔", "씨팔", "실바", "쒸발", "ㅅㅂ", "ㅆㅂ",
  "병신", "ㅂㅅ", "새끼", "색기", "ㅅㄲ", "지랄", "ㅈㄹ", "개새", "개소리",
  "좆", "존나", "ㅈㄴ", "닥쳐", "꺼져", "뒤져라", "디져라", "엿먹",
  "또라이", "돌아이", "등신", "머저리", "호로", "미친놈", "미친년",
  "fuck", "shit", "bitch", "asshole", "bastard", "retard",
];
const DEGRADING = [
  "못생김", "못생긴", "못생겼", "뚱뚱이", "돼지같", "뚱보", "냄새나", "냄새남",
  "왕따", "찐따", "찌질이", "루저", "빻았", "오징어같", "혐오", "역겨",
  "급식충", "틀딱", "한남", "김치녀", "장애인같", "애자", "불구자",
  "죽어라", "자살해", "꺼지라",
];
// 특정인을 겨냥했는지 판단할 때 쓰는 부정 표현 (이름과 함께 나오면 비하로 본다)
const NEGATIVE_NEAR_NAME = [
  ...PROFANITY, ...DEGRADING,
  "싫어", "짜증", "밉다", "미워", "바보", "멍청", "재수없", "꼴보기싫",
  "따돌", "때리", "괴롭",
];

function findHit(haystack, list) {
  for (const word of list) {
    if (haystack.includes(word)) return word;
  }
  return null;
}

/**
 * 투표 항목으로 올려도 되는 문구인지 검사한다.
 * @param {string} raw 사용자가 입력한 원문
 * @param {string[]} rosterNames 같은 반 학생 이름 (특정인 비하 판정용)
 * @returns {{ok: boolean, reason: string, matched: string}}
 */
export function screenVoteLabel(raw, rosterNames = []) {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: false, reason: "빈 내용", matched: "" };

  const norm = normalizeForScreening(text);
  const cho = toChosung(text.replace(/\s/g, ""));
  const jamo = toJamo(text);
  // 원문 그대로 / 초성만 / 자모 분해, 세 가지 형태 모두에서 찾는다.
  const hitAny = (list) =>
    findHit(norm, list) ||
    findHit(cho, list.filter((w) => /^[ㄱ-ㅎ]+$/.test(w))) ||
    findHit(jamo, list.filter((w) => /[가-힣]/.test(w)).map(toJamo));

  let hit = hitAny(SEXUAL);
  if (hit) return { ok: false, reason: "성적인 표현", matched: hit };

  hit = hitAny(PROFANITY);
  if (hit) return { ok: false, reason: "욕설·비속어", matched: hit };

  hit = hitAny(DEGRADING);
  if (hit) return { ok: false, reason: "비하 표현", matched: hit };

  // 반 친구 이름 + 부정 표현이 함께 있으면 특정인을 겨냥한 것으로 본다.
  for (const name of rosterNames) {
    const n = normalizeForScreening(name);
    if (n.length < 2 || !norm.includes(n)) continue;
    const near = findHit(norm, NEGATIVE_NEAR_NAME);
    if (near) return { ok: false, reason: `특정인(${name}) 비하`, matched: near };
    // 이름만 덜렁 적은 항목도 사람을 대상으로 한 투표라 막는다.
    if (norm.replace(n, "").length <= 2) {
      return { ok: false, reason: `특정인(${name}) 지목`, matched: name };
    }
  }
  return { ok: true, reason: "", matched: "" };
}

// 검열에 걸렸을 때 화면에 그대로 띄우는 문구 (요청받은 문장 그대로)
export const BLOCK_MESSAGE =
  "부적절한 항목을 추가하려 시도 하였습니다. 당신의 시도가 기록되었습니다. " +
  "선생님께 전송됩니다. 만약 잘못된게 아니라면 다시 추가 됩니다.";
