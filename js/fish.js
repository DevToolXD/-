// =============================================================
//  어항 — 물고기 성장 계산 (순수 함수, 서버 없이 성립)
// =============================================================
//  성장은 "저장된 크기"가 아니라 "태어난 시각 + 씨앗"에서 매번 다시 계산한다.
//  그래야 앱을 꺼둬도 물고기가 자라고, 여러 기기에서 같은 크기가 나온다.
//  서버에 크기를 계속 써 넣는 방식이었다면 2000마리가 20분마다 쓰기를
//  일으켰을 것이다.
//
//  20분이 한 구간이고, 구간마다 성장률이 다르다(요청: "성장률은 20분마다 랜덤").
//  구간 번호와 씨앗을 섞은 해시로 뽑으므로 누가 언제 계산해도 같은 값이 나온다.

export const PERIOD_MS = 20 * 60 * 1000;   // 성장 구간: 20분
export const BASE_SIZE = 1;                // 갓 그린 물고기 크기
export const MAX_SIZE = 26;                // 어항이 감당하는 최대 크기
export const FEED_GROWTH = [0.35, 0.9];    // 밥을 먹었을 때 늘어나는 폭(최소~최대)

// 32비트 정수 해시. 같은 입력이면 어디서든 같은 값.
function hash32(a, b) {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b + 0x85ebca6b), 0xcc9e2d51) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x1b873593) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}
const unit = (a, b) => hash32(a, b) / 4294967295;   // 0~1

// 하루에 자라는 양을 10분의 1로 줄였다. 예전에는 사흘이면 다 커버려서
// 금방 시시해졌는데, 이제 한 달쯤 걸린다.
const GROWTH_SCALE = 0.1;

/** 구간 하나에서 자라는 양. 대부분 조금, 가끔 많이 자란다. */
export function periodGrowth(seed, periodIndex) {
  const r = unit(seed >>> 0, periodIndex);
  // 제곱을 쓰면 작은 값이 많아지고 큰 값이 드물어진다 — 가끔 쑥 크는 느낌
  return (0.02 + r * r * 0.28) * GROWTH_SCALE;
}

/**
 * 물고기 크기.
 * @param {{seed:number, createdAt:number, fed:number, fedSeed?:number}} fish
 * @param {number} now  기준 시각(ms)
 */
// 서버 시각이 아직 안 온 문서(createdAt 이 null)는 방금 만든 것으로 본다.
// `|| now` 로 두면 createdAt 이 0 일 때도 방금 만든 것이 되어 버린다.
function bornAt(fish, now) {
  const t = Number(fish.createdAt);
  return Number.isFinite(t) ? t : now;
}

// 성장이 느려진 만큼 상한까지 도달하는 데 필요한 구간 수가 열 배로 늘었다.
// sizeOf 는 어항을 그리는 매 프레임마다 물고기 수만큼 불리므로, 그대로 두면
// 2000마리 × 수천 번의 덧셈이 초당 60번 돈다. 크기는 20분에 한 번만 바뀌니
// "몇 번째 구간인지"를 열쇠로 기억해 두고 그 구간 안에서는 다시 세지 않는다.
const sizeCache = new Map();

export function sizeOf(fish, now = Date.now()) {
  const born = bornAt(fish, now);
  const seed = Number(fish.seed) || 0;
  const elapsed = Math.max(0, now - born);
  const periods = Math.floor(elapsed / PERIOD_MS);
  const key = `${seed}|${born}|${fish.fed || 0}|${periods}`;
  const hit = sizeCache.get(key);
  if (hit !== undefined) return hit;
  let size = BASE_SIZE;
  // 구간 수가 많아도(며칠치) 합은 금방 상한에 걸리므로 상한에서 멈춘다
  for (let i = 0; i < periods; i++) {
    size += periodGrowth(seed, i);
    if (size >= MAX_SIZE) { sizeCache.set(key, MAX_SIZE); return MAX_SIZE; }
  }
  // 밥은 확률적으로 크게 만든다 — 먹은 횟수만큼 결정적으로 더한다
  const fed = Math.max(0, Math.min(9, Number(fish.fed) || 0));
  for (let i = 0; i < fed; i++) {
    const r = unit(seed >>> 0, 900000 + i);
    if (r < 0.55) continue;                       // 먹어도 안 클 수 있다
    size += FEED_GROWTH[0] + r * (FEED_GROWTH[1] - FEED_GROWTH[0]);
  }
  const out = Math.min(MAX_SIZE, size);
  // 20분마다 물고기 수만큼 새 열쇠가 생기므로 가끔 비워 준다
  if (sizeCache.size > 8000) sizeCache.clear();
  sizeCache.set(key, out);
  return out;
}

/** 무게(g). 길이의 세제곱에 비례한다고 보고 랭킹에 쓴다. */
export function weightOf(fish, now = Date.now()) {
  const s = sizeOf(fish, now);
  return Math.round(s * s * s * 12);
}

export function formatWeight(g) {
  if (g >= 1000) return (g / 1000).toFixed(2) + " kg";
  return g + " g";
}

/** 다음 성장까지 남은 밀리초 */
export function msToNextGrowth(fish, now = Date.now()) {
  const born = bornAt(fish, now);
  const elapsed = Math.max(0, now - born);
  return PERIOD_MS - (elapsed % PERIOD_MS);
}
