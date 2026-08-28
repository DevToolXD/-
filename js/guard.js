// =============================================================
//  보안 가드 — 세션 토큰 + 요청 토큰(레이트리밋) + 로그인 잠금
// =============================================================
//  ⚠️ 이 스택의 한계를 먼저 밝힙니다.
//  이 앱은 Firebase Authentication도 서버(Cloud Functions)도 없는 정적
//  사이트입니다. 그래서 여기의 어떤 검사도 "서버가 강제하는 인증"이 될 수
//  없습니다. 개발자도구를 열어 localStorage를 고치거나 이 파일의 함수를
//  직접 부르면 우회할 수 있습니다.
//
//  그럼에도 이 층이 실제로 막아주는 것:
//   1) 세션 위조: 예전에는 localStorage에 {"role":"admin"} 한 줄만 넣으면
//      선생님 화면이 열렸습니다. 이제 토큰에 기기 키로 서명이 붙어 있어
//      값을 손으로 고치면 서명이 깨져 즉시 로그아웃됩니다.
//   2) 오래된 세션: 교실 공용 기기에서 앞 사람 세션이 계속 살아 있던 문제.
//      이제 유효기간이 있고, 쓰지 않으면 만료됩니다.
//   3) 연타·도배: 투표/항목추가/제보/문의를 정해진 시간 안에 4번까지만
//      허용합니다(행동마다 토큰 통이 따로).
//   4) 비밀번호 밀어넣기: 틀릴수록 길어지는 잠금.
// =============================================================
import { randomHex, hmacHex, safeEqual } from "./crypto.js?v=DEV";
import { eul } from "./korean.js?v=DEV";

const SESSION_KEY = "manito.session";
const DEVICE_KEY = "manito.deviceKey";
const BUCKET_KEY = "manito.buckets";
const LOCK_KEY = "manito.loginLocks";

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch {} };
const readJSON = (k, fallback) => {
  try { return JSON.parse(lsGet(k) || "") ?? fallback; } catch { return fallback; }
};

// ---------- 기기 키 ----------
// 이 기기에서만 유효한 서명 키. 세션 토큰은 이 키로 서명되므로, 다른 기기로
// 토큰을 복사해 가도 검증에 실패한다.
function deviceKey() {
  let k = lsGet(DEVICE_KEY);
  if (!k || !/^[0-9a-f]{64}$/.test(k)) {
    k = randomHex(32);
    lsSet(DEVICE_KEY, k);
  }
  return k;
}

// =============================================================
//  1) 세션 토큰
// =============================================================
//  역할마다 유효기간이 다르다. 권한이 클수록 짧게 잡는다.
//  예전엔 학생 8시간·선생님 2시간·전체관리자 1시간이었는데, 앱을 쓸 때마다
//  로그인이 풀려 있어 불편하다는 말이 계속 나왔다. 쓰는 동안(보호된 동작을
//  할 때마다 rotateSession 이 유효기간을 밀어준다)에는 어차피 안 끊기니,
//  그냥 오래 안 써서 끊기는 기준 자체를 넉넉하게 늘렸다.
export const SESSION_TTL = {
  student: 30 * 24 * 60 * 60 * 1000,   // 30일
  admin: 14 * 24 * 60 * 60 * 1000,     // 선생님 14일
  superadmin: 24 * 60 * 60 * 1000,     // 전체 관리자 하루 (권한이 커서 더 짧게)
};

function payloadString(p) {
  // 서명 대상 문자열. 필드 순서를 고정해 서명이 흔들리지 않게 한다.
  return [p.tid, p.role, p.classCode, p.subjectId ?? "", p.name ?? "", p.issuedAt, p.expiresAt].join("|");
}

/** 로그인 성공 시 세션 토큰을 발급한다. */
export async function issueSession({ role, classCode, subjectId = null, name = null }) {
  const ttl = SESSION_TTL[role] ?? SESSION_TTL.student;
  const now = Date.now();
  const payload = {
    tid: randomHex(16),        // 발급마다 새로 도는 토큰 ID
    role,
    classCode,
    subjectId,
    name,
    issuedAt: now,
    expiresAt: now + ttl,
    v: 2,
  };
  payload.sig = await hmacHex(deviceKey(), payloadString(payload));
  lsSet(SESSION_KEY, JSON.stringify(payload));
  return payload;
}

/**
 * 저장된 세션을 검증해서 돌려준다. 서명이 깨졌거나 만료됐으면 null.
 * @returns {Promise<null | {role,classCode,subjectId,name,expiresAt}>}
 */
export async function readSession() {
  const raw = readJSON(SESSION_KEY, null);
  if (!raw || typeof raw !== "object") return null;
  // v2 이전(서명 없는) 세션은 더 이상 신뢰하지 않는다 → 다시 로그인
  if (raw.v !== 2 || !raw.sig) { lsDel(SESSION_KEY); return null; }
  if (!raw.expiresAt || Date.now() > raw.expiresAt) { lsDel(SESSION_KEY); return null; }
  const expect = await hmacHex(deviceKey(), payloadString(raw));
  if (!safeEqual(expect, raw.sig)) { lsDel(SESSION_KEY); return null; }
  return raw;
}

/**
 * 중요한 동작을 할 때마다 토큰을 새로 발급한다(회전).
 * 토큰 ID가 매번 바뀌므로 어딘가에 복사해둔 옛 토큰은 못 쓴다.
 */
export async function rotateSession() {
  const s = await readSession();
  if (!s) return null;
  return issueSession({ role: s.role, classCode: s.classCode, subjectId: s.subjectId, name: s.name });
}

export function clearSessionToken() { lsDel(SESSION_KEY); }

/** 지금 세션이 요구 역할 중 하나인지 확인하고, 맞으면 토큰을 회전시킨다. */
export async function requireRole(roles) {
  const s = await readSession();
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!s || !allowed.includes(s.role)) {
    const e = new Error("로그인이 만료됐어요. 다시 로그인해 주세요.");
    e.code = "session-invalid";
    throw e;
  }
  await rotateSession();
  return s;
}

// =============================================================
//  2) 요청 토큰 (행동마다 통이 따로인 토큰 버킷)
// =============================================================
//  각 행동은 자기 통에서 토큰을 하나 꺼내 쓴다. 통이 비면 다시 찰 때까지
//  거부한다. 통이 따로라서 투표를 많이 했다고 버그 제보가 막히지는 않는다.
//  통은 전부 "정해진 시간에 4번"이고, 창 길이만 그 행동의 실제 빈도에 맞춘다.
//  (예: 배정은 몇 분에 한 번이면 충분하지만, 명단 편집은 연달아 할 수 있다)
export const BUCKETS = {
  login:     { max: 4, windowMs: 60 * 1000,      label: "로그인 시도" },
  vote:      { max: 4, windowMs: 60 * 1000,      label: "투표" },
  voteAdd:   { max: 4, windowMs: 10 * 60 * 1000, label: "투표 항목 추가" },
  wish:      { max: 4, windowMs: 60 * 1000,      label: "소원 등록" },
  feedback:  { max: 4, windowMs: 5 * 60 * 1000,  label: "버그 제보" },
  adInquiry: { max: 4, windowMs: 10 * 60 * 1000, label: "광고 문의" },
  // ---- 선생님 작업: 무거운 것일수록 창을 길게 ----
  assign:    { max: 4, windowMs: 5 * 60 * 1000,  label: "마니또 배정",
               tip: "배정은 반 전체를 다시 쓰는 작업이라 자주 할 수 없어요." },
  roster:    { max: 4, windowMs: 30 * 1000,      label: "명단 추가",
               tip: "여러 명은 한 줄에 한 명씩 붙여넣어 한 번에 추가할 수 있어요." },
  studentOp: { max: 4, windowMs: 30 * 1000,      label: "학생 관리(삭제·비밀번호 초기화)" },
  wishMod:   { max: 4, windowMs: 30 * 1000,      label: "소원 수정·다시쓰기 요청" },
  reportOp:  { max: 4, windowMs: 30 * 1000,      label: "신고 처리" },
  // adminOp 는 예전에 이 목록에 없었다. 없는 이름으로 부르면 spendToken 이
  // 그냥 지나가므로, 관리자 권한을 거두는 동작에 아무 제한도 없었다.
  adminOp:   { max: 8, windowMs: 60 * 1000,      label: "관리자 권한 관리" },

  // ---- 어항 ----
  //  밥은 하루 3개뿐이라 개수 자체가 이미 제한이다. 여기서는 자동 클릭
  //  같은 것만 막을 만큼만 넉넉하게 둔다. (예전에는 "소원 등록" 통을
  //  같이 써서, 밥을 주는데 소원이 어떻다는 문구가 떴다)
  feed:      { max: 30, windowMs: 60 * 1000,     label: "밥 주기" },
  fishAdd:   { max: 4,  windowMs: 10 * 60 * 1000, label: "물고기 넣기" },
  foodGrant: { max: 20, windowMs: 60 * 1000,     label: "밥 나눠주기" },
  fishOp:    { max: 10, windowMs: 60 * 1000,     label: "어항 정리" },
};

// ---------- 변조 감지 ----------
//  연타 제한과 로그인 잠금은 localStorage 에 그냥 적혀 있었다. 개발자
//  도구에서 used 를 0 으로 고치면 모든 제한이 즉시 풀렸다는 뜻이다.
//  이제 기기 키로 만든 체크섬을 같이 적어서, 값만 손대면 알아채고 그
//  기록을 "가득 쓴 상태"로 되돌린다.
//
//  솔직한 한계: 브라우저에 있는 값이라 통째로 지우면 초기화되는 건
//  막을 수 없다(서버가 없으니). 다만 "숫자 하나 고치기"로는 못 뚫는다.
//  spendToken 은 곳곳에서 동기로 불리므로 여기서는 WebCrypto(비동기)를
//  못 쓴다. 대신 기기 키를 섞은 빠른 해시를 쓴다.
function checksum(str) {
  const key = deviceKey();
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const mix = key + "|" + str;
  for (let i = 0; i < mix.length; i++) {
    const c = mix.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = (Math.imul(h2 + c, 2246822519) ^ (h2 >>> 13)) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36));
}

/** {v, sum} 봉투에 담아 저장한다. */
function saveGuarded(key, value) {
  const body = JSON.stringify(value);
  lsSet(key, JSON.stringify({ v: body, sum: checksum(body) }));
}

/** 봉투를 열어 확인한다. 체크섬이 안 맞으면 onTamper() 의 값을 쓴다. */
function loadGuarded(key, onTamper) {
  const raw = readJSON(key, null);
  if (!raw || typeof raw !== "object") return {};
  // 봉투가 아니면 빈 기록으로 본다. 옛 형식을 그대로 받아주면 "옛 형식으로
  // 써 넣기"가 곧 우회 수단이 되므로 받아주지 않는다. (업데이트 직후 한 번
  // 카운터가 초기화되는데, 이는 키를 지우는 것과 같은 정도라 더 약해지지 않는다)
  if (typeof raw.v !== "string" || typeof raw.sum !== "string") return {};
  if (checksum(raw.v) !== raw.sum) {
    console.warn(`[guard] ${key} 가 손대진 흔적이 있어 초기화합니다.`);
    const safe = onTamper();
    saveGuarded(key, safe);
    return safe;
  }
  try {
    const parsed = JSON.parse(raw.v);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// 연타 제한 기록을 고쳤으면, 모든 통을 방금 가득 쓴 상태로 되돌린다.
// 고쳐서 얻을 수 있는 게 없도록.
function bucketsOnTamper() {
  const now = Date.now();
  const out = {};
  for (const [name, cfg] of Object.entries(BUCKETS)) {
    out[name] = { since: now, used: cfg.max };
  }
  return out;
}

function loadBuckets() {
  return loadGuarded(BUCKET_KEY, bucketsOnTamper);
}

/** 남은 토큰 수를 계산한다(창이 지났으면 가득 찬 상태로 리셋). */
export function tokensLeft(name) {
  const cfg = BUCKETS[name];
  if (!cfg) return FALLBACK_BUCKET.max;
  const st = loadBuckets()[name];
  if (!st || Date.now() - st.since >= cfg.windowMs) return cfg.max;
  return Math.max(0, cfg.max - st.used);
}

/** 토큰이 다시 찰 때까지 남은 밀리초 */
export function refillIn(name) {
  const cfg = BUCKETS[name];
  const st = loadBuckets()[name];
  if (!cfg || !st) return 0;
  return Math.max(0, cfg.windowMs - (Date.now() - st.since));
}

function humanWait(ms) {
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) return `${sec}초`;
  return `${Math.ceil(sec / 60)}분`;
}

/**
 * 행동 하나에 토큰 하나를 쓴다. 통이 비었으면 에러를 던진다.
 * @throws {Error & {code:'rate-limited'}}
 */
// 목록에 없는 이름으로 부르면 예전에는 아무 제한 없이 통과시켰다.
// (adminOp 오타 하나로 관리자 권한 회수가 무제한이었다) 이제는 조용히
// 넘기지 않고, 보수적인 기본값을 씌운 뒤 개발자 콘솔에만 알린다.
const FALLBACK_BUCKET = { max: 4, windowMs: 60 * 1000, label: "이 동작" };
function bucketOf(name) {
  const cfg = BUCKETS[name];
  if (cfg) return cfg;
  console.warn(`[guard] 알 수 없는 제한 통 "${name}" — 기본값으로 막습니다.`);
  return FALLBACK_BUCKET;
}

export function spendToken(name) {
  const cfg = bucketOf(name);
  const all = loadBuckets();
  const now = Date.now();
  let st = all[name];
  if (!st || now - st.since >= cfg.windowMs) st = { since: now, used: 0 };
  if (st.used >= cfg.max) {
    // 짧고 사람 말처럼. 몇 번까지인지·몇 분 창인지는 학생이 알 필요가 없다.
    const e = new Error(
      `${eul(cfg.label)} 너무 빨리 했어요. ${humanWait(cfg.windowMs - (now - st.since))} 뒤에 다시 해주세요.` +
      (cfg.tip ? ` ${cfg.tip}` : "")
    );
    e.code = "rate-limited";
    throw e;
  }
  st.used += 1;
  all[name] = st;
  saveGuarded(BUCKET_KEY, all);
}

/** 실패해서 되돌려야 할 때(예: 서버가 거부) 쓴 토큰을 돌려준다. */
export function refundToken(name) {
  const all = loadBuckets();
  const st = all[name];
  if (!st || !st.used) return;
  st.used -= 1;
  all[name] = st;
  lsSet(BUCKET_KEY, JSON.stringify(all));
}

// =============================================================
//  3) 로그인 잠금 (틀릴수록 길어짐)
// =============================================================
const LOCK_STEPS = [0, 0, 0, 10, 30, 60, 180, 600]; // 초 단위

// 잠금 기록을 고쳤으면 가장 긴 잠금을 건다.
function locksOnTamper() {
  const until = Date.now() + LOCK_STEPS[LOCK_STEPS.length - 1] * 1000;
  return { "*": { fails: LOCK_STEPS.length, until } };
}
function loadLocks() { return loadGuarded(LOCK_KEY, locksOnTamper); }

export function loginLockLeft(key) {
  const locks = loadLocks();
  // 기록을 손댄 흔적이 있으면 어떤 키로 물어도 잠긴 것으로 본다
  if (locks["*"]?.until > Date.now()) return locks["*"].until - Date.now();
  const st = locks[key];
  if (!st?.until) return 0;
  return Math.max(0, st.until - Date.now());
}

export function assertLoginAllowed(key) {
  const left = loginLockLeft(key);
  if (left > 0) {
    const e = new Error(`비밀번호를 여러 번 틀렸어요. ${humanWait(left)} 뒤에 다시 시도해 주세요.`);
    e.code = "locked";
    throw e;
  }
}

export function noteLoginFailure(key) {
  const locks = loadLocks();
  const st = locks[key] || { fails: 0, until: 0 };
  st.fails += 1;
  const step = LOCK_STEPS[Math.min(st.fails, LOCK_STEPS.length - 1)];
  st.until = step ? Date.now() + step * 1000 : 0;
  locks[key] = st;
  saveGuarded(LOCK_KEY, locks);
  return st;
}

export function clearLoginFailures(key) {
  const locks = loadLocks();
  delete locks[key];
  saveGuarded(LOCK_KEY, locks);
}

// 테스트·초기화용
export function resetGuards() {
  lsDel(BUCKET_KEY);
  lsDel(LOCK_KEY);
}
