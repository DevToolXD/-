// =============================================================
//  UI / 라우팅 / 인터랙션 글루 코드
// =============================================================
import * as data from "./data.js";
import { classLabel, isValidClassCode, TEST_CODE, SUPER_ADMIN } from "../config.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------- 뷰 라우팅 ----------
const BACK_TARGET = {
  home: "class-gate",
  "student-login": "home",
  "admin-login": "home",
  "student-home": "home",
  "admin-home": "home",
  "super-admin": "home",
};

const LOGGED_IN_VIEWS = ["student-home", "admin-home", "super-admin"];
let currentView = "class-gate";

let hasRenderedOnce = false;
function showView(name) {
  const shouldChaosTransition =
    hasRenderedOnce && name !== currentView && document.body.classList.contains("flashy");
  currentView = name;
  $$("[data-view]").forEach((v) => v.classList.add("hidden"));
  $(`[data-view="${name}"]`).classList.remove("hidden");
  const backBtn = $("#btn-back");
  backBtn.classList.toggle("hidden", name === "class-gate");
  backBtn.textContent = LOGGED_IN_VIEWS.includes(name) ? "로그아웃" : "뒤로";
  window.scrollTo({ top: 0, behavior: "smooth" });
  updateSpecialMode();
  updateAdminQuickBtn();
  if (shouldChaosTransition) playChaosTransition();
  hasRenderedOnce = true;
}

let viewBeforeVote = null;
$("#btn-back").addEventListener("click", async () => {
  if (currentView === "mode-vote") {
    showView(viewBeforeVote || "class-gate");
    viewBeforeVote = null;
    return;
  }
  if (LOGGED_IN_VIEWS.includes(currentView)) {
    await logout();
    return;
  }
  const target = BACK_TARGET[currentView] || "class-gate";
  if (target === "class-gate") resetClass();
  student = null;
  adminSession = null;
  showView(target);
});

// =============================================================
//  확인 모달 (재사용) — window.confirm() 대신 리퀴드 글라스 모달 사용
// =============================================================
let confirmHideTimer = null;
function confirmModal(message) {
  return new Promise((resolve) => {
    const overlay = $("#confirm-modal");
    $("#confirm-modal-text").textContent = message;
    const okBtn = $("#confirm-modal-ok");
    const cancelBtn = $("#confirm-modal-cancel");
    clearTimeout(confirmHideTimer); // 이전 모달이 남긴 지연 hidden 처리 취소 (연속 호출 대비)
    overlay.classList.remove("hidden");
    void overlay.offsetWidth;
    overlay.classList.add("show");

    function cleanup(result) {
      overlay.classList.remove("show");
      clearTimeout(confirmHideTimer);
      confirmHideTimer = setTimeout(() => overlay.classList.add("hidden"), 200);
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onOverlay);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onOverlay(e) { if (e.target === overlay) cleanup(false); }

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onOverlay);
  });
}

// ---------- 토스트 ----------
let toastTimer;
function toast(msg, ok = true) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast " + (ok ? "ok" : "err");
  t.classList.remove("hidden");
  void t.offsetWidth; // 애니메이션 재시작
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 3000);
}

function setHint(sel, msg, ok = false) {
  const el = $(sel);
  el.textContent = msg || "";
  el.className = "hint " + (msg ? (ok ? "ok" : "err") : "");
}

function busy(btn, on, label) {
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.textContent = label || "처리 중…";
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.label || btn.textContent;
    btn.disabled = false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// =============================================================
//  개발자 도구 접근 억제 (완전한 차단은 불가능하지만 진입 장벽을 둠)
// =============================================================
document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("keydown", (e) => {
  const k = e.key;
  const blocked =
    k === "F12" ||
    (e.ctrlKey && e.shiftKey && ["I", "J", "C", "i", "j", "c"].includes(k)) ||
    (e.metaKey && e.altKey && ["I", "J", "C", "i", "j", "c"].includes(k)) ||
    (e.ctrlKey && (k === "u" || k === "U"));
  if (blocked) e.preventDefault();
});

// =============================================================
//  마우스 커서 글로우 + 로컬 스포트라이트(볼록 효과)
// =============================================================
const glow = $("#cursor-glow");
document.addEventListener("mousemove", (e) => {
  glow.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
  glow.classList.add("active");
  const el = e.target.closest(".glass-card, .btn");
  if (el) {
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
    el.style.setProperty("--my", ((e.clientY - r.top) / r.height) * 100 + "%");
  }
});
document.addEventListener("mouseleave", () => glow.classList.remove("active"));

// =============================================================
//  소원이 통 안으로 빨려들어가는 전체화면 연출
// =============================================================
function wishPortal(text) {
  return new Promise((resolve) => {
    const overlay = $("#wish-portal");
    const textEl = $("#wish-portal-text");
    const ring = $("#wish-portal-ring");
    textEl.textContent = text;
    overlay.classList.remove("hidden");
    void overlay.offsetWidth;
    overlay.classList.add("show");
    if (navigator.vibrate) navigator.vibrate([15, 40, 15]);

    ring.animate(
      [
        { transform: "scale(0.3)", opacity: 0 },
        { transform: "scale(1)", opacity: 0.9, offset: 0.55 },
        { transform: "scale(0.02)", opacity: 1 },
      ],
      { duration: 900, easing: "cubic-bezier(.4,0,.2,1)" }
    );
    const textAnim = textEl.animate(
      [
        { transform: "rotate(0deg) scale(1)", opacity: 1 },
        { transform: "rotate(180deg) scale(0.7)", opacity: 1, offset: 0.55 },
        { transform: "rotate(360deg) scale(0)", opacity: 0 },
      ],
      { duration: 900, easing: "cubic-bezier(.55,0,.55,1)" }
    );
    textAnim.onfinish = () => {
      overlay.classList.remove("show");
      setTimeout(() => {
        overlay.classList.add("hidden");
        resolve();
      }, 220);
    };
  });
}

// =============================================================
//  세션 상태 (localStorage에 저장 → 새로고침해도 로그인 유지)
// =============================================================
const SESSION_KEY = "manito.session";

function saveSession(session) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
}
function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

let classCode = null;
let student = null; // { id, name }
let adminSession = null; // { code(관리자코드) }
let saCurrentCode = null;

function resetClass() {
  classCode = null;
  clearSession();
  $("#class-chip").classList.add("hidden");
}

function setClassChip(code) {
  const chip = $("#class-chip");
  chip.textContent = classLabel(code);
  chip.classList.remove("hidden");
}

// 로그아웃: 이중 확인(쓸때없이 화려한 모드에서는 10단계 확인) 후 세션만 지우고
// 학급코드는 유지 (같은 기기에서 다음 학생이 이어서 로그인)
const NORMAL_LOGOUT_STEPS = [
  "정말 로그아웃 하시겠어요?",
  "한 번 더 확인할게요. 정말 나가시겠어요? 다시 로그인해야 해요.",
];
const CHAOS_LOGOUT_STEPS = [
  "로그아웃 하시겠습니까?",
  "정말요?",
  "진짜요?",
  "ㄹㅇ?",
  "진짜로?",
  "ㄹㅇ로?",
  "진짜 진짜?",
  "정말 정말?",
  "진짜 정말 정말로?",
  "진짜 정말 정말 정말로?",
];
async function logout() {
  const chaos = document.body.classList.contains("flashy");
  const steps = chaos ? CHAOS_LOGOUT_STEPS : NORMAL_LOGOUT_STEPS;
  for (let i = 0; i < steps.length; i++) {
    const remain = steps.length - i;
    const msg = chaos ? `${steps[i]} (남은 확인: ${remain}/${steps.length})` : steps[i];
    if (chaos) playBlipSound();
    if (!(await confirmModal(msg))) return;
  }
  clearSession();
  student = null;
  adminSession = null;
  showView("home");
}

// =============================================================
//  0603 학급 전용 이스터에그 (선생님/슈퍼관리자 화면 제외)
// =============================================================
const FLOURISH_VIEWS = ["home", "student-login", "student-home"];
let sparklesRendered = false;

function renderSparkles(active) {
  const layer = $("#sparkle-layer");
  if (active && !sparklesRendered) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 24; i++) {
      const s = document.createElement("span");
      s.className = "sparkle";
      s.style.left = Math.random() * 100 + "%";
      s.style.top = Math.random() * 100 + "%";
      s.style.animationDelay = Math.random() * 4 + "s";
      s.style.setProperty("--sz", 3 + Math.random() * 4 + "px");
      frag.appendChild(s);
    }
    layer.innerHTML = "";
    layer.appendChild(frag);
    sparklesRendered = true;
  }
  layer.classList.toggle("hidden", !active);
  if (!active) sparklesRendered = false;
}

function updateSpecialMode() {
  const active = classCode === SUPER_ADMIN.classCode && FLOURISH_VIEWS.includes(currentView);
  document.body.classList.toggle("special-0603", active);
  renderSparkles(active);
  $("#brand-name").textContent = active ? "광고문의(정후교에게)" : "마니또";
  $("#brand-free-tag").classList.toggle("hidden", !active);
}

// =============================================================
//  쓸때없이 화려한 모드용 효과음 (외부 파일 없이 Web Audio API로 즉석 합성)
// =============================================================
let audioCtx = null;
function getAudioCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function makeNoiseBuffer(ctx, seconds) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// "퍼버벙!!" 폭발음: 저음 쿵 + 감쇠하는 노이즈
function playBoomSound() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime;

  const noise = ctx.createBufferSource();
  noise.buffer = makeNoiseBuffer(ctx, 0.35);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1800, now);
  filter.frequency.exponentialRampToValueAtTime(120, now + 0.3);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.45, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  noise.connect(filter).connect(noiseGain).connect(ctx.destination);
  noise.start(now);
  noise.stop(now + 0.35);

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(150, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.25);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.55, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  osc.connect(oscGain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.25);
}

// 화면 전환용 "슈우우웅" 효과음
function playWhooshSound() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  const noise = ctx.createBufferSource();
  noise.buffer = makeNoiseBuffer(ctx, 0.5);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 0.8;
  filter.frequency.setValueAtTime(300, now);
  filter.frequency.exponentialRampToValueAtTime(3500, now + 0.35);
  filter.frequency.exponentialRampToValueAtTime(500, now + 0.5);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.32, now + 0.15);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
  noise.connect(filter).connect(gain).connect(ctx.destination);
  noise.start(now);
  noise.stop(now + 0.5);
}

// 로그아웃 단계마다 삑 소리
function playBlipSound() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(880, now);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.15, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.12);
}

// =============================================================
//  쓸때없이 화려한 모드 — 인도/대만 B급 저예산 CG 감성
//  (줌펀치 + 유리깨짐 + 만화 효과음 + 화면흔들림 + 어색한 번역투 문구)
// =============================================================
const FLASHY_KEY = "manito.flashy";

// 정상 문구 -> 번역기를 돌린 것 같은 어색한 문구. 무조건 마침표로 끝남.
const CHAOS_TEXT_MAP = [
  ["#class-gate-btn", "입장을 하다."],
  [".landing-main h1", "학급을 선택하는 것을 하다."],
  [".landing-main .eyebrow", "시작하기 전에 하는 것."],
  [".landing-main > p.muted", "왼쪽 목록을 누르는 것을 권장하다."],
  [".side-nav-item:nth-of-type(1) .side-nav-label", "육학년 삼반인 것."],
  ["#other-code-toggle", "다른 학급코드를 입력하는 것."],
  ['.role-btn[data-role="student"] .role-title', "학생이다."],
  ['.role-btn[data-role="student"] .role-desc', "로그인을 계정에 접속하다. 그리고 소원을 남기는 것을 하다."],
  ['.role-btn[data-role="admin"] .role-title', "선생님이다."],
  ['.role-btn[data-role="admin"] .role-desc', "명단을 관리하는 것과 마니또를 배정하는 것을 하다."],
  ['[data-view="student-login"] h2', "학생이 로그인을 계정에 접속하다."],
  ['[data-view="student-login"] label:nth-of-type(1) .label-text', "이름을 입력하는 것."],
  ['[data-view="student-login"] label:nth-of-type(2) .label-text', "비밀번호를 입력하는 것."],
  ['[data-view="admin-login"] label .label-text', "관리자 코드를 입력하는 것."],
  ["#student-login-btn", "로그인을 계정에 접속하다."],
  ['[data-view="student-home"] .muted:not(.small)', "마니또를 나의 도와줄 학생. 소원을 남기면 전달되는 것을 하다."],
  ['[data-view="student-home"] h3:nth-of-type(1)', "나의 소원인 것."],
  ["#my-wish-submit", "소원을 저장하는 것을 하다."],
  ['[data-view="student-home"] .row-between h3', "내가 도와주는 친구인 것."],
  ["#care-refresh", "새로고침을 하는 것."],
  ['[data-view="admin-login"] h2', "선생님이 로그인을 계정에 접속하다."],
  ["#admin-login-btn", "입장을 하다."],
  ['[data-view="admin-home"] h2', "관리자인 것."],
  ["#roster-add-btn", "명단에 추가를 하다."],
  ["#assign-btn", "마니또를 배정하는 것을 하다."],
  ["#reshuffle-btn", "재배정을 하는 것."],
  ["#reveal-btn", "전체 공개를 보는 것을 하다."],
  ['[data-view="super-admin"] h2', "전체 관리자인 것."],
];
let chaosTextApplied = false;

function applyChaosText(on) {
  if (on === chaosTextApplied) return;
  for (const [sel, chaosStr] of CHAOS_TEXT_MAP) {
    const el = $(sel);
    if (!el) continue;
    if (on) {
      if (el.dataset.normalText === undefined) el.dataset.normalText = el.textContent;
      el.textContent = chaosStr;
    } else if (el.dataset.normalText !== undefined) {
      el.textContent = el.dataset.normalText;
    }
  }
  chaosTextApplied = on;
}

function setFlashy(on) {
  document.body.classList.toggle("flashy", on);
  const btn = $("#flashy-toggle");
  btn.setAttribute("aria-pressed", String(on));
  btn.textContent = on ? "쓸때없이 화려한 모드 ON" : "쓸때없이 화려한 모드";
  applyChaosText(on);
  try { localStorage.setItem(FLASHY_KEY, on ? "1" : "0"); } catch {}
}

$("#flashy-toggle").addEventListener("click", () => {
  setFlashy(!document.body.classList.contains("flashy"));
});

// ---- 화면 흔들림 ----
let shakeTimer;
function screenShake() {
  document.body.classList.add("chaos-shake");
  clearTimeout(shakeTimer);
  shakeTimer = setTimeout(() => document.body.classList.remove("chaos-shake"), 350);
}

// ---- 만화 효과음 텍스트 (퍼버벙!!) ----
const BOOM_WORDS = ["퍼버벙!!", "펑!!!", "콰과광!!", "빠직!!", "슈웅퍽!!"];
function spawnBoomText(x, y) {
  const el = document.createElement("div");
  el.className = "chaos-boom";
  el.textContent = BOOM_WORDS[Math.floor(Math.random() * BOOM_WORDS.length)];
  el.style.left = x + "px";
  el.style.top = y + "px";
  el.style.color = ["#ffcc00", "#ff2fa0", "#00e5ff"][Math.floor(Math.random() * 3)];
  document.body.appendChild(el);
  const anim = el.animate(
    [
      { transform: "translate(-50%,-50%) scale(0.3) rotate(-8deg)", opacity: 0 },
      { transform: "translate(-50%,-50%) scale(1.3) rotate(4deg)", opacity: 1, offset: 0.35 },
      { transform: "translate(-50%,-50%) scale(1) rotate(-2deg)", opacity: 1, offset: 0.6 },
      { transform: "translate(-50%,-58%) scale(0.9) rotate(0deg)", opacity: 0 },
    ],
    { duration: 650, easing: "cubic-bezier(.2,.8,.2,1)" }
  );
  anim.onfinish = () => el.remove();
}

// ---- 유리 깨짐 이펙트 ----
function spawnShatter(x, y) {
  const lines = 8;
  for (let i = 0; i < lines; i++) {
    const s = document.createElement("div");
    s.className = "chaos-crack";
    s.style.left = x + "px";
    s.style.top = y + "px";
    const angle = (360 / lines) * i + (Math.random() * 20 - 10);
    const len = 30 + Math.random() * 50;
    s.style.transform = `rotate(${angle}deg) scaleX(${len / 60})`;
    document.body.appendChild(s);
    const anim = s.animate(
      [
        { opacity: 1 },
        { opacity: 0 },
      ],
      { duration: 400 + Math.random() * 200, easing: "ease-out" }
    );
    anim.onfinish = () => s.remove();
  }
}

// ---- 클릭된 요소 줌인/줌아웃 펀치 ----
function punchElement(el) {
  el.classList.remove("chaos-punch");
  void el.offsetWidth;
  el.classList.add("chaos-punch");
  setTimeout(() => el.classList.remove("chaos-punch"), 420);
}

function chaosClickEffect(e) {
  screenShake();
  spawnBoomText(e.clientX, e.clientY);
  spawnShatter(e.clientX, e.clientY);
  playBoomSound();
  const target = e.target.closest(".btn, .glass-card, .role-btn");
  if (target) punchElement(target);
  if (navigator.vibrate) navigator.vibrate([10, 20, 30]);
}
document.addEventListener("click", (e) => {
  if (!document.body.classList.contains("flashy")) return;
  chaosClickEffect(e);
});

// ---- 영화 예고편 같은 화면 전환 ----
const CHAOS_TRANSITION_WORDS = ["슈우우우우숙", "부아아아앙", "콰과과광", "삐리리링", "두구두구두구"];
function playChaosTransition() {
  screenShake();
  playWhooshSound();
  const overlay = $("#chaos-transition");
  const text = $("#chaos-transition-text");
  text.textContent = CHAOS_TRANSITION_WORDS[Math.floor(Math.random() * CHAOS_TRANSITION_WORDS.length)] + "... 빠바!!";
  overlay.classList.remove("hidden");
  overlay.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], {
    duration: 550,
    easing: "ease",
  });
  text.animate(
    [
      { transform: "scale(2.4)", opacity: 0 },
      { transform: "scale(1)", opacity: 1, offset: 0.35 },
      { transform: "scale(1)", opacity: 1, offset: 0.7 },
      { transform: "scale(0.8)", opacity: 0 },
    ],
    { duration: 550, easing: "cubic-bezier(.2,.8,.2,1)" }
  );
  setTimeout(() => overlay.classList.add("hidden"), 560);
}

// =============================================================
//  1) 홈 (사이드바 바로가기 / 다른 학급코드 입력)
// =============================================================
function enterClass(code) {
  classCode = code;
  setClassChip(code);
  if (code === TEST_CODE) toast("테스트 모드로 진행합니다.");
  showView("home");
}

$$(".side-nav-item").forEach((b) =>
  b.addEventListener("click", () => enterClass(b.dataset.code))
);

$("#other-code-toggle").addEventListener("click", () => {
  $("#other-code-form").classList.toggle("hidden");
});

const codeInput = $("#class-code-input");
codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") $("#class-gate-btn").click(); });

$("#class-gate-btn").addEventListener("click", () => {
  const code = codeInput.value.trim();
  if (!isValidClassCode(code)) {
    setHint("#class-gate-hint", "올바른 학급코드가 아니에요. (예: 0603)");
    return;
  }
  setHint("#class-gate-hint", "");
  codeInput.value = "";
  enterClass(code);
});

// =============================================================
//  2) 역할 선택
// =============================================================
$$(".role-btn").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.dataset.role === "student") openStudentLogin();
    else openAdminLogin();
  })
);

// =============================================================
//  3) 학생
// =============================================================
let nameToId = new Map();

async function openStudentLogin() {
  showView("student-login");
  setHint("#student-login-hint", "");
  $("#student-pw").value = "";
  $("#student-name-input").value = "";
  const list = $("#student-name-list");
  list.innerHTML = "";
  nameToId = new Map();
  try {
    const students = await data.listStudents(classCode);
    if (students.length === 0) {
      setHint("#student-login-hint", "선생님이 먼저 명단을 등록해야 해요.");
    }
    for (const s of students) {
      nameToId.set(s.name, s.id);
      const opt = document.createElement("option");
      opt.value = s.name;
      list.appendChild(opt);
    }
  } catch (e) {
    setHint("#student-login-hint", "명단을 불러오지 못했습니다: " + e.message);
  }
}

$("#student-pw").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#student-login-btn").click(); });

$("#student-login-btn").addEventListener("click", async () => {
  const name = $("#student-name-input").value.trim();
  const pw = $("#student-pw").value;
  if (!name) return setHint("#student-login-hint", "이름을 입력해주세요.");
  const id = nameToId.get(name);
  if (!id) return setHint("#student-login-hint", "등록되지 않은 이름이에요. 목록에서 선택해주세요.");
  if (!pw) return setHint("#student-login-hint", "비밀번호를 입력해주세요.");

  const btn = $("#student-login-btn");
  busy(btn, true, "로그인 중…");
  try {
    let res = await data.verifyStudentPassword(classCode, id, pw);
    if (res === "needSetup") {
      await data.setStudentPassword(classCode, id, pw);
      res = "ok";
      toast("비밀번호가 설정되었어요. 다음부터 이 비밀번호로 로그인하세요.");
    }
    if (res !== "ok") {
      setHint("#student-login-hint", "비밀번호가 올바르지 않습니다.");
      return;
    }
    student = { id, name };
    if (id === SUPER_ADMIN.studentId) {
      saveSession({ classCode, role: "superadmin" });
      markSuperAdminAuthed();
      await enterSuperAdmin();
    } else {
      saveSession({ classCode, role: "student", studentId: id, studentName: name });
      await enterStudentHome();
    }
  } catch (e) {
    setHint("#student-login-hint", "오류: " + e.message);
  } finally {
    busy(btn, false);
  }
});

async function enterStudentHome() {
  showView("student-home");
  $("#student-greeting").textContent = student.name;
  $("#student-greeting-eyebrow").textContent = classLabel(classCode);
  // 페이지1(나의 소원)을 기본으로 보여줌. 페이지2(긁어서 확인하기)는
  // 사이드바에서 눌렀을 때만 불러온다 (독립된 큰 페이지로 분리).
  $$(".student-page-nav").forEach((b) => b.classList.toggle("active", b.dataset.page === "wish"));
  $$(".student-page").forEach((p) => p.classList.toggle("hidden", p.dataset.page !== "wish"));
  await refreshMyWish();
}

$$(".student-page-nav").forEach((b) =>
  b.addEventListener("click", async () => {
    $$(".student-page-nav").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    $$(".student-page").forEach((p) => p.classList.toggle("hidden", p.dataset.page !== b.dataset.page));
    if (b.dataset.page === "care") await refreshCareTarget();
  })
);

async function refreshMyWish() {
  const form = $("#my-wish-form");
  const display = $("#my-wish-display");
  const noteEl = $("#my-wish-rewrite-note");
  try {
    const sec = await data.getSecret(classCode, student.id);
    if (sec?.wishRewriteNote) {
      noteEl.textContent = "다시 써주세요: " + sec.wishRewriteNote;
      noteEl.classList.remove("hidden");
    } else {
      noteEl.classList.add("hidden");
    }
    if (sec?.wishSetAt) {
      form.classList.add("hidden");
      display.classList.remove("hidden");
      $("#my-wish-display-text").textContent = sec.wish || "";
    } else {
      form.classList.remove("hidden");
      display.classList.add("hidden");
      $("#my-wish-text").value = "";
      setHint("#my-wish-hint", "");
    }
  } catch (e) {
    form.classList.remove("hidden");
    display.classList.add("hidden");
    setHint("#my-wish-hint", "불러오기 실패: " + e.message);
  }
}

$("#my-wish-submit").addEventListener("click", async () => {
  const text = $("#my-wish-text").value;
  if (!text.trim()) return setHint("#my-wish-hint", "소원을 입력해주세요.");
  const btn = $("#my-wish-submit");
  busy(btn, true, "등록 중…");
  try {
    const clean = await data.setMyWish(classCode, student.id, text);
    busy(btn, false);
    await wishPortal(clean);
    await refreshMyWish();
    toast("소원함에 추가되었습니다!");
  } catch (e) {
    setHint("#my-wish-hint", e.message);
    busy(btn, false);
  }
});

async function refreshCareTarget() {
  const empty = $("#care-empty");
  const content = $("#care-content");
  try {
    const target = await data.getCareTarget(classCode, student.id);
    if (!target) {
      empty.classList.remove("hidden");
      content.classList.add("hidden");
      return;
    }
    empty.classList.add("hidden");
    content.classList.remove("hidden");
    $("#care-name").textContent = target.name;
    $("#care-wish").textContent = target.wish
      ? target.wish
      : "아직 소원을 등록하지 않았어요. 조금 뒤에 다시 확인해보세요.";
    setupScratchCard();
  } catch (e) {
    empty.classList.remove("hidden");
    content.classList.add("hidden");
    empty.textContent = "불러오기 실패: " + e.message;
  }
}
$("#care-refresh").addEventListener("click", refreshCareTarget);

// ---- 복권처럼 긁어서 마니또 대상 이름을 확인하는 스크래치 카드 ----
function setupScratchCard() {
  const wrap = $("#care-content .scratch-wrap");
  const nameEl = $("#care-name");
  const canvas = $("#care-scratch-canvas");
  if (!wrap || !canvas) return;
  const ctx = canvas.getContext("2d");

  requestAnimationFrame(() => {
    const nameRect = nameEl.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const w = Math.max(nameRect.width, 40);
    const h = Math.max(nameRect.height, 24);
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.style.top = nameRect.top - wrapRect.top + "px";
    canvas.style.left = nameRect.left - wrapRect.left + "px";
    canvas.classList.remove("scratched-away");
    canvas.style.opacity = "1";
    canvas.style.pointerEvents = "auto";

    const big = w > 150;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#b9c2bd";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#5b6b62";
    ctx.font = (big ? 16 : 11) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("긁어서 확인", w / 2, h / 2);

    let scratching = false;
    const brushRadius = big ? 24 : 13;
    function scratchAt(x, y) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(x, y, brushRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    function pointFromEvent(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function checkRevealed() {
      const data = ctx.getImageData(0, 0, w, h).data;
      let cleared = 0, total = 0;
      for (let i = 3; i < data.length; i += 4 * 6) {
        total++;
        if (data[i] === 0) cleared++;
      }
      if (total > 0 && cleared / total > 0.45) {
        canvas.classList.add("scratched-away");
        setTimeout(() => { canvas.style.pointerEvents = "none"; }, 400);
      }
    }
    canvas.onpointerdown = (e) => { scratching = true; const p = pointFromEvent(e); scratchAt(p.x, p.y); };
    canvas.onpointermove = (e) => { if (!scratching) return; const p = pointFromEvent(e); scratchAt(p.x, p.y); };
    window.addEventListener("pointerup", () => { if (scratching) { scratching = false; checkRevealed(); } });
    canvas.onpointerleave = () => { if (scratching) checkRevealed(); };
  });
}

// =============================================================
//  4) 선생님(학급 관리자)
// =============================================================
async function openAdminLogin() {
  showView("admin-login");
  $("#admin-code").value = "";
  setHint("#admin-login-hint", "");
  try {
    const exists = await data.adminConfigExists(classCode);
    $("#admin-setup-note").textContent = exists
      ? "관리자 코드를 입력하세요."
      : "최초 실행입니다. 지금 입력하는 코드가 이 학급의 관리자 코드로 등록됩니다.";
  } catch {
    $("#admin-setup-note").textContent = "";
  }
}

$("#admin-code").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#admin-login-btn").click(); });

$("#admin-login-btn").addEventListener("click", async () => {
  const code = $("#admin-code").value;
  if (!code) return setHint("#admin-login-hint", "코드를 입력해주세요.");
  const btn = $("#admin-login-btn");
  busy(btn, true, "확인 중…");
  try {
    const exists = await data.adminConfigExists(classCode);
    if (!exists) {
      await data.setupAdmin(classCode, code);
      toast("관리자 코드가 등록되었습니다.");
    } else {
      const ok = await data.verifyAdmin(classCode, code);
      if (!ok) {
        setHint("#admin-login-hint", "관리자 코드가 올바르지 않습니다.");
        return;
      }
    }
    adminSession = { code };
    saveSession({ classCode, role: "admin" });
    await enterAdminHome();
  } catch (e) {
    setHint("#admin-login-hint", "오류: " + e.message);
  } finally {
    busy(btn, false);
  }
});

async function enterAdminHome() {
  showView("admin-home");
  $("#reveal-wrap").classList.add("hidden");
  await Promise.all([refreshRoster(), refreshAdminWishlist(), refreshTeacherParticipation()]);
}

async function refreshRoster() {
  const ul = $("#roster-list");
  ul.innerHTML = "";
  try {
    const students = (await data.listStudents(classCode)).filter((s) => !s.synthetic);
    const assigned = await data.isAssigned(classCode);
    $("#admin-status").textContent =
      `${classLabel(classCode)} · 학생 ${students.length}명 등록됨 · ` +
      (assigned ? "마니또 배정 완료" : "아직 배정 전");
    ul.innerHTML = students
      .map(
        (s) => `<li class="chip chip-removable" data-id="${s.id}">
          ${escapeHtml(s.name)}<button class="chip-del" data-id="${s.id}" title="삭제">×</button>
        </li>`
      )
      .join("");
    $$(".chip-del").forEach((b) =>
      b.addEventListener("click", async () => {
        const s = students.find((x) => x.id === b.dataset.id);
        if (!s) return;
        if (!(await confirmModal(`${s.name} 학생을 명단에서 삭제할까요?`))) return;
        try {
          await data.deleteStudent(classCode, s.id);
          toast("학생을 삭제했습니다.");
          await refreshRoster();
          await refreshAdminWishlist();
        } catch (e) {
          toast("삭제 실패: " + e.message, false);
        }
      })
    );
  } catch (e) {
    $("#admin-status").textContent = "상태 불러오기 실패: " + e.message;
  }
}

$("#roster-add-btn").addEventListener("click", async () => {
  const names = $("#roster").value.split("\n");
  const btn = $("#roster-add-btn");
  busy(btn, true, "추가 중…");
  try {
    const n = await data.addStudents(classCode, names);
    $("#roster").value = "";
    setHint("#roster-hint", `${n}명 추가되었습니다.`, true);
    await refreshRoster();
  } catch (e) {
    setHint("#roster-hint", "오류: " + e.message);
  } finally {
    busy(btn, false);
  }
});

async function doAssign(btn) {
  busy(btn, true, "배정 중…");
  setHint("#assign-hint", "");
  try {
    const n = await data.assignManito(classCode);
    setHint("#assign-hint", `${n}명 마니또 배정 완료!`, true);
    toast("마니또 배정 완료!");
    $("#reveal-wrap").classList.add("hidden");
    await Promise.all([refreshRoster(), refreshAdminWishlist(), refreshTeacherParticipation()]);
  } catch (e) {
    setHint("#assign-hint", "오류: " + e.message);
  } finally {
    busy(btn, false);
  }
}
$("#assign-btn").addEventListener("click", (e) => doAssign(e.currentTarget));
$("#reshuffle-btn").addEventListener("click", async (e) => {
  if (!(await confirmModal("재배정하면 기존 배정과 학생들이 등록한 소원이 초기화됩니다. 진행할까요?"))) return;
  await doAssign(e.currentTarget);
});

$("#reveal-btn").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  busy(btn, true, "불러오는 중…");
  setHint("#reveal-hint", "");
  try {
    const pairs = await data.revealMapping(classCode);
    if (!pairs.length) {
      setHint("#reveal-hint", "아직 배정된 마니또가 없습니다.");
      return;
    }
    $("#reveal-table tbody").innerHTML = pairs
      .map((p) => `<tr><td>${escapeHtml(p.guardianName)}</td><td>→</td><td>${escapeHtml(p.protegeName)}</td></tr>`)
      .join("");
    $("#reveal-wrap").classList.remove("hidden");
  } catch (e2) {
    setHint("#reveal-hint", "불러오기 실패: " + e2.message);
  } finally {
    busy(btn, false);
  }
});

// ---- 우리 반 학생 소원 열람 + 다시 쓰기 요청 ----
async function refreshAdminWishlist() {
  const tbody = $("#admin-wishlist-body");
  tbody.innerHTML = `<tr><td colspan="3" class="muted small">불러오는 중…</td></tr>`;
  try {
    const rows = (await data.classDetail(classCode)).filter((r) => r.id !== data.TEACHER_ID);
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="muted small">등록된 학생이 없어요.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map(
        (r) => `<tr data-id="${r.id}" data-name="${escapeHtml(r.name)}">
          <td>${escapeHtml(r.name)}</td>
          <td>${r.wish ? escapeHtml(r.wish) : "<span class='muted small'>아직 없음</span>"}</td>
          <td>${r.wish ? '<button class="btn btn-ghost btn-sm wishlist-rewrite-btn">다시 쓰기 요청</button>' : ""}</td>
        </tr>`
      )
      .join("");
    $$(".wishlist-rewrite-btn").forEach((b) =>
      b.addEventListener("click", async () => {
        const tr = b.closest("tr");
        const id = tr.dataset.id;
        const name = tr.dataset.name;
        if (!(await confirmModal(`${name} 학생에게 소원을 다시 쓰도록 요청할까요?`))) return;
        busy(b, true, "요청 중…");
        try {
          await data.requestWishRewrite(classCode, id, "부적절하거나 잘못 쓴 내용은 피해서 다시 써주세요.");
          toast("다시 쓰기를 요청했습니다.");
          await refreshAdminWishlist();
        } catch (e) {
          toast("요청 실패: " + e.message, false);
          busy(b, false);
        }
      })
    );
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="3" class="err">불러오기 실패: ${escapeHtml(e.message)}</td></tr>`;
  }
}
$("#admin-wishlist-refresh").addEventListener("click", refreshAdminWishlist);

// ---- 학생 수가 홀수라서 선생님도 마니또에 참여했을 때 ----
async function refreshTeacherParticipation() {
  const card = $("#teacher-participate-card");
  try {
    const participating = await data.isTeacherParticipating(classCode);
    card.classList.toggle("hidden", !participating);
    if (!participating) return;

    const sec = await data.getSecret(classCode, data.TEACHER_ID);
    const form = $("#teacher-wish-form");
    const display = $("#teacher-wish-display");
    if (sec?.wishSetAt) {
      form.classList.add("hidden");
      display.classList.remove("hidden");
      $("#teacher-wish-display-text").textContent = sec.wish || "";
    } else {
      form.classList.remove("hidden");
      display.classList.add("hidden");
    }

    const target = await data.getCareTarget(classCode, data.TEACHER_ID);
    const careEmpty = $("#teacher-care-empty");
    const careContent = $("#teacher-care-content");
    if (!target) {
      careEmpty.classList.remove("hidden");
      careContent.classList.add("hidden");
    } else {
      careEmpty.classList.add("hidden");
      careContent.classList.remove("hidden");
      $("#teacher-care-name").textContent = target.name;
      $("#teacher-care-wish").textContent = target.wish || "아직 소원을 등록하지 않았어요.";
    }
  } catch (e) {
    setHint("#teacher-wish-hint", "불러오기 실패: " + e.message);
  }
}

$("#teacher-wish-submit").addEventListener("click", async () => {
  const text = $("#teacher-wish-text").value;
  if (!text.trim()) return setHint("#teacher-wish-hint", "소원을 입력해주세요.");
  const btn = $("#teacher-wish-submit");
  busy(btn, true, "등록 중…");
  try {
    await data.setMyWish(classCode, data.TEACHER_ID, text);
    toast("소원을 등록했습니다.");
    await refreshTeacherParticipation();
  } catch (e) {
    setHint("#teacher-wish-hint", e.message);
  } finally {
    busy(btn, false);
  }
});

// =============================================================
//  5) 슈퍼 관리자 (전체 학급)
// =============================================================
async function enterSuperAdmin() {
  showView("super-admin");
  $("#sa-detail").classList.add("hidden");
  saCurrentCode = null;
  await Promise.all([refreshOverview(), refreshSaVotes()]);
}

async function refreshOverview() {
  const tbody = $("#sa-overview-body");
  tbody.innerHTML = `<tr><td colspan="4" class="muted small">불러오는 중…</td></tr>`;
  try {
    const rows = await data.superAdminOverview();
    tbody.innerHTML = rows
      .map(
        (r) => `<tr>
          <td>${escapeHtml(classLabel(r.code))}</td>
          <td>${r.count}</td>
          <td>${r.assigned ? "배정 완료" : "배정 전"}</td>
          <td><button class="btn btn-ghost btn-sm sa-view-btn" data-code="${r.code}">보기</button></td>
        </tr>`
      )
      .join("");
    $$(".sa-view-btn").forEach((b) =>
      b.addEventListener("click", () => loadClassDetail(b.dataset.code))
    );
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="err">불러오기 실패: ${escapeHtml(e.message)}</td></tr>`;
  }
}

async function loadClassDetail(code) {
  saCurrentCode = code;
  $("#sa-detail").classList.remove("hidden");
  $("#sa-detail-title").textContent = classLabel(code) + " 상세";
  setHint("#sa-detail-hint", "");
  const tbody = $("#sa-detail-body");
  tbody.innerHTML = `<tr><td colspan="4" class="muted small">불러오는 중…</td></tr>`;
  try {
    const rows = await data.classDetail(code);
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted small">등록된 학생이 없어요.</td></tr>`;
      return;
    }
    const optionsFor = (selfId) =>
      rows
        .filter((r) => r.id !== selfId)
        .map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`)
        .join("");
    tbody.innerHTML = rows
      .map(
        (r) => `<tr data-id="${r.id}">
          <td>${escapeHtml(r.name)}</td>
          <td>
            <select class="sa-care-select">
              <option value="">- 없음 -</option>
              ${optionsFor(r.id)}
            </select>
          </td>
          <td><textarea rows="2" class="sa-wish-input">${escapeHtml(r.wish || "")}</textarea></td>
          <td>
            <button class="btn btn-ghost btn-sm sa-care-save-btn">배정 저장</button>
            <button class="btn btn-ghost btn-sm sa-save-btn">소원 저장</button>
          </td>
        </tr>`
      )
      .join("");
    $$(".sa-care-select").forEach((sel) => {
      const tr = sel.closest("tr");
      const row = rows.find((r) => r.id === tr.dataset.id);
      if (row?.caringForId) sel.value = row.caringForId;
    });
    $$(".sa-care-save-btn").forEach((b) =>
      b.addEventListener("click", async () => {
        const tr = b.closest("tr");
        const guardianId = tr.dataset.id;
        const protegeId = tr.querySelector(".sa-care-select").value;
        if (!protegeId) return toast("돌볼 대상을 선택해주세요.", false);
        busy(b, true, "저장…");
        try {
          await data.superAdminSetCare(code, guardianId, protegeId);
          toast("다음 배정을 지정했습니다.");
        } catch (e) {
          toast("저장 실패: " + e.message, false);
        } finally {
          busy(b, false);
        }
      })
    );
    $$(".sa-save-btn").forEach((b) =>
      b.addEventListener("click", async () => {
        const tr = b.closest("tr");
        const id = tr.dataset.id;
        const text = tr.querySelector(".sa-wish-input").value;
        busy(b, true, "저장…");
        try {
          await data.superAdminSetWish(code, id, text);
          toast("소원을 수정했습니다.");
        } catch (e) {
          toast("저장 실패: " + e.message, false);
        } finally {
          busy(b, false);
        }
      })
    );
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="err">불러오기 실패: ${escapeHtml(e.message)}</td></tr>`;
  }
}

$("#sa-back-btn").addEventListener("click", () => {
  $("#sa-detail").classList.add("hidden");
  saCurrentCode = null;
});

$("#sa-reassign-btn").addEventListener("click", async (e) => {
  if (!saCurrentCode) return;
  if (!(await confirmModal(`${classLabel(saCurrentCode)}을(를) 재배정할까요? 기존 소원이 초기화됩니다.`))) return;
  const btn = e.currentTarget;
  busy(btn, true, "배정 중…");
  try {
    await data.assignManito(saCurrentCode);
    toast("재배정 완료!");
    await loadClassDetail(saCurrentCode);
    await refreshOverview();
  } catch (err) {
    setHint("#sa-detail-hint", "오류: " + err.message);
  } finally {
    busy(btn, false);
  }
});

// ---- 모드 투표 관리 (슈퍼 관리자) ----
async function refreshSaVotes() {
  const tbody = $("#sa-votes-body");
  tbody.innerHTML = `<tr><td colspan="2" class="muted small">불러오는 중…</td></tr>`;
  try {
    const votes = await data.getModeVotes();
    tbody.innerHTML = votes
      .map((v) => `<tr><td>${escapeHtml(v.label)}</td><td>${v.count}</td></tr>`)
      .join("");
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="2" class="err">불러오기 실패: ${escapeHtml(e.message)}</td></tr>`;
  }
}
$("#sa-votes-refresh").addEventListener("click", refreshSaVotes);
$("#sa-votes-reset").addEventListener("click", async (e) => {
  if (!(await confirmModal("모드 투표 결과를 모두 초기화할까요?"))) return;
  const btn = e.currentTarget;
  busy(btn, true, "초기화…");
  try {
    await data.resetModeVotes();
    toast("투표를 초기화했습니다.");
    await refreshSaVotes();
  } catch (e) {
    toast("초기화 실패: " + e.message, false);
  } finally {
    busy(btn, false);
  }
});

// =============================================================
//  6) 정후교 전용 "관리자" 바로가기 버튼
//  한 번이라도 슈퍼 관리자로 인증하면 이 기기에서는 어느 화면에 있든
//  버튼 하나로 바로 전체 관리자 패널로 점프할 수 있음.
// =============================================================
const SUPERADMIN_AUTHED_KEY = "manito.superadminAuthed";

function markSuperAdminAuthed() {
  try { localStorage.setItem(SUPERADMIN_AUTHED_KEY, "1"); } catch {}
  updateAdminQuickBtn();
}
function updateAdminQuickBtn() {
  let authed = false;
  try { authed = localStorage.getItem(SUPERADMIN_AUTHED_KEY) === "1"; } catch {}
  $("#admin-quick-btn").classList.toggle("hidden", !authed || currentView === "super-admin");
}
$("#admin-quick-btn").addEventListener("click", async () => {
  await enterSuperAdmin();
});

// =============================================================
//  7) 모드 투표 (뽀로로 모드 / 하츄핑 모드)
// =============================================================
const VOTED_MODE_KEY = "manito.votedMode";

$("#vote-nav-btn").addEventListener("click", async () => {
  viewBeforeVote = currentView;
  showView("mode-vote");
  await refreshVoteCandidates();
});

async function refreshVoteCandidates() {
  const wrap = $("#vote-candidates");
  wrap.innerHTML = `<p class="muted small">불러오는 중…</p>`;
  setHint("#vote-hint", "");
  let alreadyVoted = null;
  try { alreadyVoted = localStorage.getItem(VOTED_MODE_KEY); } catch {}
  try {
    const votes = await data.getModeVotes();
    wrap.innerHTML = votes
      .map(
        (v) => `<button class="role-btn glass-card vote-item" data-id="${v.id}" ${alreadyVoted ? "disabled" : ""}>
          <span class="role-title">${escapeHtml(v.label)}</span>
          <span class="role-desc">${v.count}표</span>
        </button>`
      )
      .join("");
    if (alreadyVoted) {
      setHint("#vote-hint", "이미 투표하셨어요. 결과는 위에서 실시간으로 볼 수 있어요.", true);
    }
    $$(".vote-item").forEach((b) =>
      b.addEventListener("click", async () => {
        if (alreadyVoted) return;
        busy(b, true, "투표 중…");
        try {
          await data.voteForMode(b.dataset.id);
          try { localStorage.setItem(VOTED_MODE_KEY, b.dataset.id); } catch {}
          toast("투표 완료! 감사합니다.");
          await refreshVoteCandidates();
        } catch (e) {
          toast("투표 실패: " + e.message, false);
          busy(b, false);
        }
      })
    );
  } catch (e) {
    wrap.innerHTML = `<p class="err">불러오기 실패: ${escapeHtml(e.message)}</p>`;
  }
}

// =============================================================
//  시작: 저장된 세션이 있으면 로그인 상태로 바로 복원
// =============================================================
try {
  setFlashy(localStorage.getItem(FLASHY_KEY) === "1");
} catch {}

(async function init() {
  const saved = loadSession();
  if (saved && isValidClassCode(saved.classCode)) {
    classCode = saved.classCode;
    setClassChip(classCode);
    try {
      if (saved.role === "admin") {
        adminSession = {};
        await enterAdminHome();
        return;
      }
      if (saved.role === "superadmin") {
        student = { id: SUPER_ADMIN.studentId, name: SUPER_ADMIN.name };
        markSuperAdminAuthed();
        await enterSuperAdmin();
        return;
      }
      if (saved.role === "student" && saved.studentId) {
        student = { id: saved.studentId, name: saved.studentName };
        await enterStudentHome();
        return;
      }
    } catch {
      // 저장된 세션 복원 실패 시 조용히 초기 화면으로
    }
    clearSession();
  }
  showView("class-gate");
})();
