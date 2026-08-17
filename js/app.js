// =============================================================
//  UI / 라우팅 / 인터랙션 글루 코드
// =============================================================
import * as data from "./data.js?v=DEV";
import { classLabel, isValidClassCode, TEST_CODE, SUPER_ADMIN } from "../config.js?v=DEV";

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

function showView(name) {
  currentView = name;
  $$("[data-view]").forEach((v) => v.classList.add("hidden"));
  $(`[data-view="${name}"]`).classList.remove("hidden");
  const backBtn = $("#btn-back");
  backBtn.classList.toggle("hidden", name === "class-gate");
  backBtn.textContent = LOGGED_IN_VIEWS.includes(name) ? "로그아웃" : "뒤로";
  // 학생 홈에서만 고정 사이드바 + 햄버거 버튼 활성화
  document.body.classList.toggle("student-mode", name === "student-home");
  $("#sidebar-toggle").classList.toggle("hidden", name !== "student-home");
  if (name !== "student-home") document.body.classList.remove("sidebar-collapsed");
  window.scrollTo({ top: 0, behavior: "smooth" });
  updateSpecialMode();
  updateAdminQuickBtn();
  syncTopbarHeight();
}

// 상단바는 버튼이 늘거나 줄면(관리자·도감·뒤로) 높이가 달라지고, 좁은 화면에선
// 줄바꿈까지 된다. 그 실제 높이를 CSS 변수로 넘겨 사이드바가 가려지지 않게 한다.
function syncTopbarHeight() {
  const h = document.querySelector(".topbar").offsetHeight;
  document.documentElement.style.setProperty("--topbar-h", h + "px");
}
window.addEventListener("resize", syncTopbarHeight);

let viewBeforeVote = null;
let viewBeforeFeedback = null;
$("#btn-back").addEventListener("click", async () => {
  if (currentView === "mode-vote") {
    showView(viewBeforeVote || "class-gate");
    viewBeforeVote = null;
    return;
  }
  if (currentView === "feedback-board") {
    showView(viewBeforeFeedback || "class-gate");
    viewBeforeFeedback = null;
    return;
  }
  if (currentView === "codex") {
    showView(viewBeforeCodex || "class-gate");
    viewBeforeCodex = null;
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
  if (blocked) {
    e.preventDefault();
    findEgg("f12"); // 막아둔 키를 눌러본 사람에게 주는 이스터에그
  }
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

// 로그아웃: 이중 확인 후 세션만 지우고
// 학급코드는 유지 (같은 기기에서 다음 학생이 이어서 로그인)
const LOGOUT_STEPS = [
  "정말 로그아웃 하시겠어요?",
  "한 번 더 확인할게요. 정말 나가시겠어요? 다시 로그인해야 해요.",
];
async function logout() {
  for (const msg of LOGOUT_STEPS) {
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
//  뽀로로 모드 — 눈 내리는 하늘색 겨울 테마 + 펭귄 마스코트
//  (외부 이미지 없이 인라인 SVG로 직접 그린 원본 마스코트 사용)
// =============================================================
const PORORO_KEY = "manito.pororo";

// 조종사 모자 + 왕눈 고글을 쓴 아기 펭귄 (뽀로로 감성, 직접 그린 그림)
// "정품 아닌 느낌"의 테무산 짝퉁 뽀로로: 좌우 비대칭, 짝짝이 고글·눈,
// 삐뚤어진 모자, 어긋난 굵은 스티커 테두리, 싸구려 금색 별 스티커.
const PORORO_MASCOT_SVG = `
<svg class="pororo-mascot" viewBox="0 0 200 220" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <!-- 몸통 (살짝 비뚤어짐) -->
  <ellipse cx="102" cy="151" rx="64" ry="56" fill="#1e78c9" stroke="#000" stroke-width="4" transform="rotate(-3 102 151)"/>
  <ellipse cx="98" cy="162" rx="40" ry="42" fill="#f4faff" stroke="#000" stroke-width="3" transform="rotate(-3 98 162)"/>
  <!-- 날개 (짝짝이 크기) -->
  <ellipse cx="32" cy="152" rx="15" ry="30" fill="#14588f" stroke="#000" stroke-width="3" transform="rotate(24 32 152)"/>
  <ellipse cx="170" cy="148" rx="19" ry="36" fill="#14588f" stroke="#000" stroke-width="3" transform="rotate(-14 170 148)"/>
  <!-- 머리 (몸통 중심에서 살짝 어긋남) -->
  <circle cx="96" cy="77" r="53" fill="#2382d4" stroke="#000" stroke-width="4"/>
  <!-- 삐딱한 조종사 모자 -->
  <g transform="rotate(-9 96 60)">
    <path d="M 42 76 A 54 54 0 0 1 150 76 L 150 60 A 54 46 0 0 0 42 60 Z" fill="#f0b23e" stroke="#000" stroke-width="3"/>
    <path d="M 42 76 Q 96 42 150 76 L 150 58 Q 96 24 42 58 Z" fill="#e29a1f" stroke="#000" stroke-width="3"/>
    <ellipse cx="96" cy="28" rx="15" ry="9" fill="#e29a1f" stroke="#000" stroke-width="2.5"/>
  </g>
  <!-- 짝짝이 고글 (왼쪽이 더 큼, 오른쪽으로 미끄러짐) -->
  <circle cx="70" cy="84" r="27" fill="#fff" stroke="#e8632b" stroke-width="8"/>
  <circle cx="128" cy="80" r="21" fill="#fff" stroke="#ff8a3d" stroke-width="7"/>
  <rect x="94" y="76" width="10" height="7" fill="#e8632b" transform="rotate(6 99 80)"/>
  <!-- 짝짝이 눈 (사시 느낌) -->
  <circle cx="66" cy="88" r="8.5" fill="#123a55"/>
  <circle cx="129" cy="78" r="5.5" fill="#123a55"/>
  <circle cx="69" cy="85" r="2.6" fill="#fff"/>
  <circle cx="130.5" cy="76" r="1.8" fill="#fff"/>
  <!-- 부리 (비대칭) -->
  <path d="M 78 108 Q 98 98 122 112 Q 104 128 78 108 Z" fill="#f7bd4a" stroke="#000" stroke-width="2.5"/>
  <!-- 싸구려 금색 별 스티커 -->
  <path d="M100 138 l4.4 9.3 10.2 1.3-7.4 7.2 1.8 10.1-9-4.9-9 4.9 1.8-10.1-7.4-7.2 10.2-1.3z"
        fill="#ffd23f" stroke="#000" stroke-width="2" transform="rotate(-8 100 150)"/>
  <!-- 발 (짝짝이) -->
  <ellipse cx="70" cy="205" rx="19" ry="9" fill="#e8632b" stroke="#000" stroke-width="2.5" transform="rotate(-6 70 205)"/>
  <ellipse cx="132" cy="207" rx="23" ry="10" fill="#e8632b" stroke="#000" stroke-width="2.5" transform="rotate(8 132 207)"/>
</svg>`;

let pororoLayerRendered = false;
function renderPororoLayer(on) {
  const layer = $("#pororo-layer");
  if (on && !pororoLayerRendered) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 36; i++) {
      const s = document.createElement("span");
      s.className = "pororo-snow";
      s.style.left = Math.random() * 100 + "%";
      s.style.setProperty("--sz", 3 + Math.random() * 6 + "px");
      s.style.setProperty("--dur", 6 + Math.random() * 8 + "s");
      s.style.setProperty("--delay", -Math.random() * 12 + "s");
      s.style.setProperty("--drift", Math.random() * 80 - 40 + "px");
      frag.appendChild(s);
    }
    layer.innerHTML = "";
    layer.appendChild(frag);
    layer.insertAdjacentHTML("beforeend", PORORO_MASCOT_SVG);
    pororoLayerRendered = true;
  }
  layer.classList.toggle("hidden", !on);
  if (!on) pororoLayerRendered = false;
}

// 같은 펭귄 그림을 다른 클래스로 재사용 (큰 마스코트 / 작은 방해꾼)
function pororoSvg(cls) {
  return PORORO_MASCOT_SVG.replace('class="pororo-mascot"', `class="${cls}"`);
}

// ---- 매 순간 거슬리게 끼어드는 짝퉁 뽀로로 ----
const PORORO_NAGS = [
  "뽀롱뽀롱!",
  "안녕! 나는 정품 아니야.",
  "뽀로로 모드 좋아요?",
  "여기도 뽀로로!",
  "정품은 투표하러 가세요.",
  "뽀! 뽀! 뽀!",
  "나 좀 봐줘!",
  "이거 진짜 뽀로로 맞아요.",
  "친구를 도와주는 것을 하다.",
  "뽀로로가 보고 있다.",
];
const PORORO_POPS = ["뽀!", "뽀롱!", "펭!", "뽀뽀!", "뽀롱뽀롱!"];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

let pororoNagTimer = null;

// 화면 옆에서 미끄러져 들어와 말풍선을 띄우고 사라지는 방해꾼
function spawnPororoNag() {
  if (!document.body.classList.contains("pororo")) return;
  const fromLeft = Math.random() < 0.5;
  const wrap = document.createElement("div");
  wrap.className = "pororo-nag " + (fromLeft ? "from-left" : "from-right");
  wrap.style.top = 12 + Math.random() * 66 + "vh";
  wrap.innerHTML =
    `<div class="pororo-nag-bubble">${escapeHtml(pick(PORORO_NAGS))}</div>` +
    pororoSvg("pororo-nag-peng");
  document.body.appendChild(wrap);
  const outX = fromLeft ? "-115%" : "115%";
  const anim = wrap.animate(
    [
      { transform: `translateX(${outX})`, opacity: 0 },
      { transform: "translateX(0)", opacity: 1, offset: 0.18 },
      { transform: "translateX(0)", opacity: 1, offset: 0.72 },
      { transform: `translateX(${outX})`, opacity: 0 },
    ],
    { duration: 3400, easing: "cubic-bezier(.3,1.4,.4,1)" }
  );
  anim.onfinish = () => wrap.remove();
  anim.oncancel = () => wrap.remove();
}

// 클릭할 때마다 커서 위치에서 튀어나오는 작은 펭귄 + 의성어
function spawnPororoPop(x, y) {
  const el = document.createElement("div");
  el.className = "pororo-pop";
  el.style.left = x + "px";
  el.style.top = y + "px";
  el.innerHTML = pororoSvg("pororo-pop-peng") + `<span>${escapeHtml(pick(PORORO_POPS))}</span>`;
  document.body.appendChild(el);
  const anim = el.animate(
    [
      { transform: "translate(-50%,-50%) scale(0.2) rotate(-14deg)", opacity: 0 },
      { transform: "translate(-50%,-70%) scale(1.15) rotate(8deg)", opacity: 1, offset: 0.4 },
      { transform: "translate(-50%,-115%) scale(0.9) rotate(-4deg)", opacity: 0 },
    ],
    { duration: 900, easing: "cubic-bezier(.2,.8,.2,1)" }
  );
  anim.onfinish = () => el.remove();
  anim.oncancel = () => el.remove();
}

function startPororoNag() {
  stopPororoNag();
  // 2.6초마다 계속 끼어든다 (거슬림이 목적)
  pororoNagTimer = setInterval(spawnPororoNag, 2600);
  setTimeout(spawnPororoNag, 500);
}
function stopPororoNag() {
  clearInterval(pororoNagTimer);
  pororoNagTimer = null;
  document.querySelectorAll(".pororo-nag, .pororo-pop").forEach((el) => el.remove());
}

document.addEventListener("click", (e) => {
  if (!document.body.classList.contains("pororo")) return;
  spawnPororoPop(e.clientX, e.clientY);
});

function setPororo(on) {
  document.body.classList.toggle("pororo", on);
  const btn = $("#pororo-toggle");
  btn.setAttribute("aria-pressed", String(on));
  btn.textContent = on ? "뽀로로 모드 (테무산) ON" : "뽀로로 모드 (테무산)";
  renderPororoLayer(on);
  if (on) { startPororoNag(); findEgg("pororo"); }
  else stopPororoNag();
  try { localStorage.setItem(PORORO_KEY, on ? "1" : "0"); } catch {}
}

let pororoToggleCount = 0;
$("#pororo-toggle").addEventListener("click", () => {
  setPororo(!document.body.classList.contains("pororo"));
  if (++pororoToggleCount >= 10) findEgg("flicker");
});

// =============================================================
//  1) 홈 (사이드바 바로가기 / 다른 학급코드 입력)
// =============================================================
function enterClass(code) {
  if (code === TEST_CODE) findEgg("test1889");
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
  if (code === "0000") findEgg("code0000");
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

// 줄 3개(햄버거) 버튼으로 사이드바 열기/닫기
$("#sidebar-toggle").addEventListener("click", () => {
  const collapsed = document.body.classList.toggle("sidebar-collapsed");
  $("#sidebar-toggle").setAttribute("aria-expanded", String(!collapsed));
});
$("#sidebar-backdrop").addEventListener("click", () => {
  document.body.classList.add("sidebar-collapsed");
  $("#sidebar-toggle").setAttribute("aria-expanded", "false");
});

async function enterStudentHome() {
  showView("student-home");
  // 데스크톱은 펼친 채로 시작, 좁은 화면(모바일)은 접힌 채로 시작
  document.body.classList.toggle("sidebar-collapsed", window.innerWidth < 900);
  $("#student-greeting").textContent = student.name;
  $("#student-greeting-eyebrow").textContent = classLabel(classCode);
  $("#sidebar-student-name").textContent = `${classLabel(classCode)} · ${student.name}`;
  // 페이지1(나의 소원)을 기본으로 보여줌. 페이지2(긁어서 확인하기)는
  // 사이드바에서 눌렀을 때만 불러온다 (독립된 큰 페이지로 분리).
  $$(".student-page-nav").forEach((b) => b.classList.toggle("active", b.dataset.page === "wish"));
  $$(".student-page").forEach((p) => p.classList.toggle("hidden", p.dataset.page !== "wish"));
  await refreshMyWish();
}

// 사이드바는 클로드 코드처럼 항상 고정: 클릭해도 화면(뷰) 자체는 절대
// 벗어나지 않고, 오른쪽 내용 영역만 바뀐다. "투표"도 예외 없이 동일하게
// student-page 중 하나로 취급한다 (별도 뷰로 이동하지 않음).
const visitedStudentPages = new Set(["wish"]); // 진입 시 기본으로 열려 있는 페이지
$$(".student-page-nav").forEach((b) =>
  b.addEventListener("click", async () => {
    $$(".student-page-nav").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    $$(".student-page").forEach((p) => p.classList.toggle("hidden", p.dataset.page !== b.dataset.page));
    // 모바일(오버레이 모드)에서는 항목을 고르면 사이드바를 접어 내용을 보여줌
    if (window.innerWidth < 900) document.body.classList.add("sidebar-collapsed");
    visitedStudentPages.add(b.dataset.page);
    if (visitedStudentPages.size >= 5) findEgg("allpages");
    if (b.dataset.page === "friend") await refreshFriendTarget();
    if (b.dataset.page === "scratch") await refreshScratchTarget();
    if (b.dataset.page === "vote") await refreshVoteCandidates("#student-vote-candidates", "#student-vote-hint");
    if (b.dataset.page === "feedback") await refreshFeedbackBoard("#student-feedback-list");
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

$("#my-wish-text").addEventListener("input", (e) => {
  if (e.target.value.includes("1974")) findEgg("wish1974");
});

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

async function refreshFriendTarget() {
  const empty = $("#friend-empty");
  const content = $("#friend-content");
  try {
    const target = await data.getCareTarget(classCode, student.id);
    if (!target) {
      empty.classList.remove("hidden");
      content.classList.add("hidden");
      return;
    }
    empty.classList.add("hidden");
    content.classList.remove("hidden");
    $("#friend-wish").textContent = target.wish
      ? target.wish
      : "아직 소원을 등록하지 않았어요. 조금 뒤에 다시 확인해보세요.";
  } catch (e) {
    empty.classList.remove("hidden");
    content.classList.add("hidden");
    empty.textContent = "불러오기 실패: " + e.message;
  }
}
$("#friend-refresh").addEventListener("click", refreshFriendTarget);

async function refreshScratchTarget() {
  const empty = $("#scratch-empty");
  const content = $("#scratch-content");
  try {
    const target = await data.getCareTarget(classCode, student.id);
    if (!target) {
      empty.classList.remove("hidden");
      content.classList.add("hidden");
      return;
    }
    empty.classList.add("hidden");
    content.classList.remove("hidden");
    $("#scratch-name").textContent = target.name;
    setupScratchCard();
  } catch (e) {
    empty.classList.remove("hidden");
    content.classList.add("hidden");
    empty.textContent = "불러오기 실패: " + e.message;
  }
}
$("#scratch-refresh").addEventListener("click", refreshScratchTarget);

// ---- 복권처럼 긁어서 마니또 대상 이름을 확인하는 스크래치 카드 ----
function setupScratchCard() {
  const wrap = $("#scratch-content .scratch-wrap");
  const nameEl = $("#scratch-name");
  const canvas = $("#scratch-canvas");
  if (!wrap || !canvas) return;
  const ctx = canvas.getContext("2d");

  requestAnimationFrame(() => {
    // 카드 전체(이름 글자만이 아니라 큰 박스 전체)를 긁는 영역으로 삼는다
    const wrapRect = wrap.getBoundingClientRect();
    const w = Math.max(wrapRect.width, 40);
    const h = Math.max(wrapRect.height, 40);
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.style.top = "0px";
    canvas.style.left = "0px";
    canvas.classList.remove("scratched-away");
    canvas.style.opacity = "1";
    canvas.style.pointerEvents = "auto";

    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#b9c2bd";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#5b6b62";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const hintLabel = "긁어서 확인";
    let fontSize = Math.round(Math.min(w, h) * 0.14);
    ctx.font = "bold " + fontSize + "px sans-serif";
    while (ctx.measureText(hintLabel).width > w * 0.82 && fontSize > 10) {
      fontSize -= 2;
      ctx.font = "bold " + fontSize + "px sans-serif";
    }
    ctx.fillText(hintLabel, w / 2, h / 2);

    let scratching = false;
    const brushRadius = Math.max(36, Math.min(w, h) * 0.14);
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

async function refreshVoteCandidates(wrapSel = "#vote-candidates", hintSel = "#vote-hint") {
  const wrap = $(wrapSel);
  wrap.innerHTML = `<p class="muted small">불러오는 중…</p>`;
  setHint(hintSel, "");
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
      setHint(hintSel, "이미 투표하셨어요. 결과는 위에서 실시간으로 볼 수 있어요.", true);
    }
    wrap.querySelectorAll(".vote-item").forEach((b) =>
      b.addEventListener("click", async () => {
        if (alreadyVoted) return;
        busy(b, true, "투표 중…");
        try {
          await data.voteForMode(b.dataset.id);
          try { localStorage.setItem(VOTED_MODE_KEY, b.dataset.id); } catch {}
          toast("투표 완료! 감사합니다.");
          findEgg("vote");
          await refreshVoteCandidates(wrapSel, hintSel);
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
//  8) 피드백 게시판 (반 구분 없이 전체 공용, 누구나 남기고 볼 수 있음)
// =============================================================
// 현재 로그인 상태에서 이름/역할 태그를 뽑아낸다. 로그인 전(홈/로그인
// 화면)에는 null을 반환하고, 그때는 사용자가 직접 이름을 입력한다.
function currentIdentity() {
  if (currentView === "student-home" && student) {
    return { name: student.name, roleTag: `학생 · ${classLabel(classCode)}` };
  }
  if (currentView === "super-admin") {
    return { name: SUPER_ADMIN.name, roleTag: "전체 관리자" };
  }
  if (currentView === "admin-home" && adminSession) {
    return { name: "선생님", roleTag: `선생님 · ${classLabel(classCode)}` };
  }
  return null;
}

function formatFeedbackTime(createdAt) {
  try {
    if (createdAt?.toDate) {
      return createdAt.toDate().toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    }
  } catch {}
  return "방금 전";
}

function isSuperAdminAuthed() {
  try { return localStorage.getItem(SUPERADMIN_AUTHED_KEY) === "1"; } catch { return false; }
}

function feedbackItemHtml(p) {
  const delBtn = isSuperAdminAuthed()
    ? `<button class="link-btn feedback-del-btn" data-id="${p.id}">삭제</button>`
    : "";
  return `<li class="feedback-item" data-id="${p.id}">
    <div class="row-between">
      <span class="feedback-author">${escapeHtml(p.name)}${p.roleTag ? ` <span class="feedback-time">· ${escapeHtml(p.roleTag)}</span>` : ""}</span>
      ${delBtn}
    </div>
    <p class="feedback-message">${escapeHtml(p.message)}</p>
    <span class="feedback-time">${formatFeedbackTime(p.createdAt)}</span>
  </li>`;
}

async function refreshFeedbackBoard(listSel) {
  const list = $(listSel);
  list.innerHTML = `<p class="muted small">불러오는 중…</p>`;
  try {
    const posts = await data.listFeedback();
    list.innerHTML = posts.length
      ? posts.map(feedbackItemHtml).join("")
      : `<p class="muted small">아직 등록된 피드백이 없어요. 첫 피드백을 남겨보세요!</p>`;
    if (posts.length) revealChildren(list);
    list.querySelectorAll(".feedback-del-btn").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!(await confirmModal("이 피드백을 삭제할까요?"))) return;
        try {
          await data.deleteFeedback(b.dataset.id);
          await refreshFeedbackBoard(listSel);
        } catch (e) {
          toast("삭제 실패: " + e.message, false);
        }
      })
    );
  } catch (e) {
    list.innerHTML = `<p class="err">불러오기 실패: ${escapeHtml(e.message)}</p>`;
  }
}

// identity를 인자로 받는다 — currentView는 "피드백" 화면 자체로 이미
// 바뀐 뒤일 수 있어서(별도 뷰로 이동하는 topbar 진입 경로), 제출 시점에
// currentIdentity()를 다시 부르면 로그인 여부를 잘못 판단하게 된다.
async function submitFeedback(btnSel, textareaSel, hintSel, listSel, identity, nameInputSel) {
  const textEl = $(textareaSel);
  const text = textEl.value;
  if (!text.trim()) return setHint(hintSel, "내용을 입력해주세요.");
  const btn = $(btnSel);
  const name = identity ? identity.name : ($(nameInputSel)?.value || "").trim() || "익명";
  const roleTag = identity ? identity.roleTag : "";
  busy(btn, true, "등록 중…");
  try {
    await data.postFeedback(name, roleTag, text);
    textEl.value = "";
    setHint(hintSel, "");
    toast("피드백을 남겼어요. 감사합니다!");
    await refreshFeedbackBoard(listSel);
  } catch (e) {
    setHint(hintSel, e.message);
  } finally {
    busy(btn, false);
  }
}

// topbar에서 진입할 때의 로그인 상태를 스냅샷으로 저장(진입 시점 기준)
let feedbackBoardIdentity = null;
$("#feedback-nav-btn").addEventListener("click", async () => {
  viewBeforeFeedback = currentView;
  feedbackBoardIdentity = currentIdentity();
  $("#feedback-name-field").classList.toggle("hidden", !!feedbackBoardIdentity);
  showView("feedback-board");
  await refreshFeedbackBoard("#feedback-list");
});
$("#feedback-refresh").addEventListener("click", () => refreshFeedbackBoard("#feedback-list"));
$("#feedback-submit").addEventListener("click", () =>
  submitFeedback("#feedback-submit", "#feedback-text", "#feedback-hint", "#feedback-list", feedbackBoardIdentity, "#feedback-name")
);
$("#student-feedback-refresh").addEventListener("click", () => refreshFeedbackBoard("#student-feedback-list"));
$("#student-feedback-submit").addEventListener("click", () =>
  // 학생 홈은 사이드바 항목을 눌러도 currentView가 계속 "student-home"이라
  // 제출 시점에 바로 currentIdentity()를 불러도 항상 정확하다.
  submitFeedback("#student-feedback-submit", "#student-feedback-text", "#student-feedback-hint", "#student-feedback-list", currentIdentity())
);

// =============================================================
//  CSS 효과 글루 코드 (ripple / reveal / number ticker)
//  Magic UI(MIT)의 아이디어를 순수 JS로 다시 구현한 것들.
// =============================================================
const reduceMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// 버튼을 누른 자리에서 물결이 퍼진다
document.addEventListener("pointerdown", (e) => {
  const btn = e.target.closest(".btn, .role-btn, .side-nav-item, .student-page-nav");
  if (!btn || reduceMotion()) return;
  const r = btn.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2;
  const ink = document.createElement("span");
  ink.className = "ripple-ink";
  ink.style.width = ink.style.height = size + "px";
  ink.style.left = e.clientX - r.left + "px";
  ink.style.top = e.clientY - r.top + "px";
  // 버튼이 overflow:hidden 이 아니면 물결이 밖으로 새므로 확인 후 넣는다
  const cs = getComputedStyle(btn);
  if (cs.position === "static") btn.style.position = "relative";
  if (cs.overflow !== "hidden") btn.style.overflow = "hidden";
  btn.appendChild(ink);
  // 클릭으로 화면이 바뀌면 그 요소가 display:none 이 되어 애니메이션이 멈추고
  // animationend 가 오지 않는다. 그러면 물결이 DOM에 계속 남으므로 타이머로도 정리.
  const kill = () => ink.remove();
  ink.addEventListener("animationend", kill);
  setTimeout(kill, 800);
});

// 목록이 그려진 뒤 항목을 순서대로 흐릿→또렷하게 등장시킨다
function revealChildren(container, step = 45) {
  if (!container) return;
  const kids = [...container.children];
  if (reduceMotion()) {
    kids.forEach((k) => k.classList.remove("reveal"));
    return;
  }
  kids.forEach((k, i) => {
    k.classList.add("reveal");
    k.style.setProperty("--reveal-delay", i * step + "ms");
  });
  requestAnimationFrame(() => kids.forEach((k) => k.classList.add("in")));
}

// 0에서 목표 숫자까지 부드럽게 올라가는 카운터
function tickNumber(el, to, ms = 700) {
  if (!el) return;
  el.classList.add("ticker");
  if (reduceMotion() || to <= 0) { el.textContent = String(to); return; }
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = String(Math.round(to * eased));
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// =============================================================
//  React Bits 포팅: 굴절 유리 렌즈 (FluidGlass) + 3D 기울어지는 카드 (TiltedCard)
//  https://github.com/DavidHDev/react-bits — 앱의 일부로 쓰는 것은 라이선스가 허용.
//  원본은 React + Three.js/motion 이라, 같은 시각 효과를 순수 JS로 구현.
// =============================================================

// 볼록 렌즈의 굴절을 흉내내는 변위 맵(R=x, G=y 이동량)을 캔버스로 생성
function makeLensDisplacementMap(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  const R = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - R, dy = y - R;
      const d = Math.hypot(dx, dy) / R;
      let ox = 0, oy = 0;
      if (d < 1) {
        // 중앙은 그대로, 가장자리로 갈수록 안쪽 내용을 끌어와 확대되어 보임
        // (지수를 높이고 세기를 낮춰 글자가 깨지지 않는 부드러운 볼록 렌즈로)
        const k = Math.pow(d, 3.2) * 0.55;
        ox = (-dx / R) * k;
        oy = (-dy / R) * k;
      }
      const i = (y * size + x) * 4;
      img.data[i] = Math.round(127 + ox * 127);
      img.data[i + 1] = Math.round(127 + oy * 127);
      img.data[i + 2] = 127;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

function setupGlassLens() {
  const lens = $("#glass-lens");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (!lens || !finePointer || reduceMotion()) return;
  document.body.classList.add("lens-on");

  // 변위 backdrop-filter(url)는 크로미움 계열에서만 실제로 굴절함.
  // 그 외 브라우저는 CSS의 블러 유리로 자연스럽게 대체된다.
  if (window.chrome) {
    const SIZE = 150;
    const holder = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    holder.setAttribute("width", "0");
    holder.setAttribute("height", "0");
    holder.style.position = "absolute";
    holder.innerHTML =
      `<filter id="lens-disp" x="0" y="0" width="100%" height="100%" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
      `<feImage href="${makeLensDisplacementMap(SIZE)}" x="0" y="0" width="${SIZE}" height="${SIZE}" preserveAspectRatio="none" result="m"/>` +
      `<feDisplacementMap in="SourceGraphic" in2="m" scale="52" xChannelSelector="R" yChannelSelector="G"/>` +
      `</filter>`;
    document.body.appendChild(holder);
    document.body.classList.add("lens-refract");
  }

  // 스프링 느낌의 지연 추적 (원본의 motion spring 대응)
  let tx = -300, ty = -300, cx = -300, cy = -300, raf = null;
  function tick() {
    cx += (tx - cx) * 0.16;
    cy += (ty - cy) * 0.16;
    lens.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
    if (Math.abs(tx - cx) + Math.abs(ty - cy) > 0.3) raf = requestAnimationFrame(tick);
    else raf = null;
  }
  document.addEventListener("mousemove", (e) => {
    tx = e.clientX; ty = e.clientY;
    lens.classList.add("active");
    if (!raf) raf = requestAnimationFrame(tick);
  });
  document.addEventListener("mouseleave", () => lens.classList.remove("active"));
}
setupGlassLens();

// TiltedCard: 카드 위 마우스 위치에 따라 기울어짐 (원본 스펙: ±14도, 1.05배)
function attachTilt(selector, amplitude = 14, hoverScale = 1.05) {
  $$(selector).forEach((el) => {
    el.classList.add("tilt3d");
    el.addEventListener("pointermove", (e) => {
      if (reduceMotion() || e.pointerType === "touch") return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform =
        `perspective(900px) rotateX(${(-py * amplitude).toFixed(2)}deg)` +
        ` rotateY(${(px * amplitude).toFixed(2)}deg) scale(${hoverScale})`;
    });
    el.addEventListener("pointerleave", () => { el.style.transform = ""; });
  });
}
attachTilt(".role-btn");

// =============================================================
//  9) 이스터에그 + 도감
//  15개를 숨겨두고, 하나라도 찾으면 그 순간 상단에 "도감" 탭이 생긴다.
//  (잠긴 탭을 미리 보여주는 게 아니라 아예 없다가 생김)
//  내가 찾은 목록은 이 기기(localStorage)에만, 전체 발견자 수만 서버에 센다.
// =============================================================
const EGGS_KEY = "manito.eggs";

const EGGS = [
  // ---- 쉬움 ----
  { id: "pororo",   d: "쉬움",   name: "짝퉁의 시작",     hint: "상단에서 뭔가 수상한 모드를 켜보세요." },
  { id: "logo",     d: "쉬움",   name: "로고를 괴롭힘",   hint: "왼쪽 위 이름을 계속 두드리면?" },
  { id: "footad",   d: "쉬움",   name: "진짜 광고문의",   hint: "맨 아래 광고문의는 진짜 눌러집니다." },
  { id: "mascot",   d: "쉬움",   name: "펭귄 찌르기",     hint: "짝퉁 펭귄도 만지면 반응합니다." },
  { id: "f12",      d: "쉬움",   name: "개발자 지망생",   hint: "열지 못하게 막아둔 그 키를 눌러보세요." },
  // ---- 중간 ----
  { id: "vote",     d: "중간",   name: "소중한 한 표",    hint: "다음에 추가할 모드를 직접 정해보세요." },
  { id: "test1889", d: "중간",   name: "비밀 교실",       hint: "명단에 없는 네 자리 학급코드가 하나 더 있어요." },
  { id: "wish1974", d: "중간",   name: "1974페이지",      hint: "소원 입력칸의 예시 문구를 자세히 읽어보세요." },
  { id: "allpages", d: "중간",   name: "완주",            hint: "학생 사이드바의 다섯 칸을 전부 열어보세요." },
  { id: "flicker",  d: "중간",   name: "깜빡이",          hint: "그 수상한 모드를 열 번 껐다 켜보세요." },
  // ---- 어려움 ----
  { id: "konami",   d: "어려움", name: "옛날 사람",       hint: "위위 아래아래 좌우좌우 … 그 다음은?" },
  { id: "snowflake",d: "어려움", name: "눈송이 잡기",     hint: "떨어지는 눈송이를 정확히 클릭할 수 있나요?" },
  { id: "longpress",d: "어려움", name: "꾹",              hint: "왼쪽 위 이름을 3초 동안 놓지 마세요." },
  { id: "code0000", d: "어려움", name: "0000",            hint: "존재하지 않는 학급코드를 넣으면 어떻게 될까요?" },
  { id: "patience", d: "어려움", name: "인내심",          hint: "90초 동안 아무것도 누르지 않고 기다려보세요." },
];
const EGG_TOTAL = EGGS.length;

function loadFoundEggs() {
  try {
    const raw = localStorage.getItem(EGGS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((id) => EGGS.some((e) => e.id === id)) : [];
  } catch {
    return [];
  }
}
function hasEgg(id) {
  return loadFoundEggs().includes(id);
}

function updateCodexBtn() {
  // 하나라도 찾은 순간부터 탭이 "생긴다"
  $("#codex-nav-btn").classList.toggle("hidden", loadFoundEggs().length === 0);
  // 버튼이 생기면 상단바 높이가 달라지므로 사이드바 여백도 다시 맞춘다
  syncTopbarHeight();
}

async function findEgg(id) {
  const egg = EGGS.find((e) => e.id === id);
  if (!egg || hasEgg(id)) return;
  const found = loadFoundEggs();
  found.push(id);
  try { localStorage.setItem(EGGS_KEY, JSON.stringify(found)); } catch {}
  updateCodexBtn();
  toast(`이스터에그 발견 — ${egg.name} (${found.length}/${EGG_TOTAL})`);
  try { await data.recordEggFound(id); } catch {}
}

// ---- 도감 화면 ----
let viewBeforeCodex = null;
$("#codex-nav-btn").addEventListener("click", async () => {
  viewBeforeCodex = currentView;
  showView("codex");
  await refreshCodex();
});
$("#codex-refresh").addEventListener("click", refreshCodex);

async function refreshCodex() {
  const found = loadFoundEggs();
  $("#codex-summary").innerHTML =
    `전체 ${EGG_TOTAL}개 중 <b class="ticker" id="codex-found-n">0</b>개 발견 · 쉬움 5 · 중간 5 · 어려움 5`;
  tickNumber($("#codex-found-n"), found.length);
  const list = $("#codex-list");
  list.innerHTML = `<li class="muted small">발견자 수 불러오는 중…</li>`;
  let stats = {};
  let statsFailed = false;
  try { stats = await data.getEggStats(); } catch { statsFailed = true; }
  const diffClass = { "쉬움": "easy", "중간": "mid", "어려움": "hard" };
  list.innerHTML = EGGS.map((e) => {
    const got = found.includes(e.id);
    const n = stats[e.id] || 0;
    return `<li class="codex-item ${got ? "found" : "locked"}">
      <div class="row-between">
        <span class="codex-name">${escapeHtml(e.name)}</span>
        <span class="codex-diff ${diffClass[e.d]}">${e.d}</span>
      </div>
      <p class="codex-hint${got ? "" : " codex-hint-locked"}" aria-hidden="${got ? "false" : "true"}">${escapeHtml(e.hint)}</p>
      <span class="codex-count">${statsFailed ? "발견자 수를 불러오지 못했어요" : `지금까지 ${n}명이 발견`}</span>
    </li>`;
  }).join("");
  revealChildren(list);
}

// ---- 트리거 1~5 (쉬움) ----
// 1. pororo: setPororo(true) 안에서 호출
// 2. logo: 로고 5번 클릭  /  13. longpress: 로고 3초 꾹
let logoClicks = 0;
let longPressTimer = null;
const brandEl = $("#brand-name");
brandEl.addEventListener("click", () => {
  if (++logoClicks >= 5) findEgg("logo");
});
brandEl.addEventListener("pointerdown", () => {
  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => findEgg("longpress"), 3000);
});
["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
  brandEl.addEventListener(ev, () => clearTimeout(longPressTimer))
);
// 3. footad
$("#foot-ad").addEventListener("click", () => findEgg("footad"));
// 5. f12 는 기존 개발자도구 차단 핸들러에서 호출

// ---- 트리거 11 (어려움): 콘하미 커맨드 ----
const KONAMI = ["ArrowUp","ArrowUp","ArrowDown","ArrowDown","ArrowLeft","ArrowRight","ArrowLeft","ArrowRight","b","a"];
let konamiIdx = 0;
document.addEventListener("keydown", (e) => {
  const want = KONAMI[konamiIdx];
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === want) {
    konamiIdx++;
    if (konamiIdx === KONAMI.length) { konamiIdx = 0; findEgg("konami"); }
  } else {
    konamiIdx = key === KONAMI[0] ? 1 : 0;
  }
});

// ---- 트리거 4 & 12: 마스코트 / 눈송이 클릭 ----
// 눈·마스코트 레이어는 pointer-events:none 이라 클릭을 가로채지 않는다.
// 그래서 좌표로만 맞았는지 판정한다 (밑에 있는 버튼은 그대로 정상 클릭됨).
document.addEventListener("click", (e) => {
  if (!document.body.classList.contains("pororo")) return;
  const m = document.querySelector(".pororo-mascot");
  if (m) {
    const r = m.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      findEgg("mascot");
    }
  }
  for (const s of document.querySelectorAll(".pororo-snow")) {
    const r = s.getBoundingClientRect();
    if (!r.width) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (Math.hypot(e.clientX - cx, e.clientY - cy) <= Math.max(r.width, 10)) {
      findEgg("snowflake");
      break;
    }
  }
});

// ---- 트리거 15 (어려움): 90초 무입력 ----
let patienceTimer = null;
function resetPatience() {
  clearTimeout(patienceTimer);
  if (hasEgg("patience")) return;
  patienceTimer = setTimeout(() => findEgg("patience"), 90000);
}
["click", "keydown", "pointerdown", "wheel", "touchstart"].forEach((ev) =>
  document.addEventListener(ev, resetPatience, { passive: true })
);
resetPatience();

updateCodexBtn();

// =============================================================
//  시작: 저장된 세션이 있으면 로그인 상태로 바로 복원
// =============================================================
try {
  setPororo(localStorage.getItem(PORORO_KEY) === "1");
  localStorage.removeItem("manito.flashy"); // 예전 "쓸때없이 화려한 모드" 설정 정리
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
