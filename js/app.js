// =============================================================
//  UI / 라우팅 / 인터랙션 글루 코드
// =============================================================
import * as data from "./data.js?v=DEV";
import { BLOCK_MESSAGE } from "./moderation.js?v=DEV";
import * as guard from "./guard.js?v=DEV";
import { THEMES, THEME_IDS, THEME_GROUPS, DEFAULT_THEME, isTheme, getTheme }
  from "./themes.js?v=DEV";
import { classLabel, isValidClassCode, TEST_CODE, SUPER_ADMIN, firebaseConfig }
  from "../config.js?v=DEV";

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
// 줄바꿈까지 된다. 좁은 화면의 사이드바가 상단바 "아래"에서 시작하도록,
// 높이가 아니라 화면 기준 아래쪽 좌표(bottom)를 넘긴다. 상단바는 고정이
// 아니라 같이 스크롤되므로, 스크롤할 때도 값을 다시 계산한다.
function syncTopbarHeight() {
  const r = document.querySelector(".topbar").getBoundingClientRect();
  const bottom = Math.max(0, Math.round(r.bottom));
  document.documentElement.style.setProperty("--topbar-h", bottom + "px");
}
let topbarSyncQueued = false;
function queueTopbarSync() {
  if (topbarSyncQueued) return;
  topbarSyncQueued = true;
  requestAnimationFrame(() => {
    topbarSyncQueued = false;
    syncTopbarHeight();
  });
}
window.addEventListener("resize", syncTopbarHeight);
window.addEventListener("scroll", queueTopbarSync, { passive: true });
// 화면 전환 말고도(학급칩 표시, 버튼 등장, 글꼴 로드 등) 높이가 변할 길이 많다.
// 상단바 크기를 직접 관찰해서 어떤 경로로 바뀌든 항상 정확하게 유지한다.
if (window.ResizeObserver) {
  new ResizeObserver(syncTopbarHeight).observe(document.querySelector(".topbar"));
}

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
// opts.okOnly 를 주면 취소 없이 "확인" 하나만 있는 알림 모달로 쓸 수 있다.
function confirmModal(message, opts = {}) {
  return new Promise((resolve) => {
    const overlay = $("#confirm-modal");
    $("#confirm-modal-text").textContent = message;
    const okBtn = $("#confirm-modal-ok");
    const cancelBtn = $("#confirm-modal-cancel");
    okBtn.textContent = opts.okText || "확인";
    cancelBtn.classList.toggle("hidden", !!opts.okOnly);
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
    function onOverlay(e) { if (e.target === overlay) cleanup(!!opts.okOnly); }

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
//  개발자 도구: 막지 않고 기록만 남긴다
// =============================================================
//  막아 봐야 메뉴로 열면 그만이고, 우클릭까지 막으면 복사·붙여넣기 같은
//  평범한 사용만 불편해진다. 그래서 차단은 걷어내고, 대신 "누가 언제
//  무엇을 눌렀는지"를 전체 관리자만 보는 기록으로 남긴다.
//
//  ⚠️ 페이지가 알 수 있는 건 여기까지다. 콘솔에 무엇을 입력했는지,
//  무엇을 고쳤는지는 웹 페이지에서 볼 수 없다. 아래 신호만 남는다.
//    · 개발자 도구 단축키(F12 / Ctrl+Shift+I·J·C / Ctrl+U)
//    · 우클릭(검사 메뉴로 가는 첫걸음)
//    · 창 안쪽과 바깥쪽 크기가 갑자기 벌어짐 = 도구가 열림(붙여 열었을 때)
const SEC_SEEN = new Set();          // 같은 행동을 연달아 여러 번 안 남긴다
function noteSecurity(action, detail) {
  const stamp = `${action}|${detail || ""}`;
  if (SEC_SEEN.has(stamp)) return;
  SEC_SEEN.add(stamp);
  setTimeout(() => SEC_SEEN.delete(stamp), 60000);
  const me = currentIdentity();
  data.logSecurityEvent(
    me?.name || "로그인 안 한 사람", classCode, me?.roleTag || "", action, detail || "",
  ).catch(() => {});
}

document.addEventListener("keydown", (e) => {
  const k = e.key;
  const combo =
    (k === "F12" && "F12") ||
    (e.ctrlKey && e.shiftKey && ["I","J","C","i","j","c"].includes(k) && `Ctrl+Shift+${k.toUpperCase()}`) ||
    (e.metaKey && e.altKey && ["I","J","C","i","j","c"].includes(k) && `Cmd+Option+${k.toUpperCase()}`) ||
    (e.ctrlKey && (k === "u" || k === "U") && "Ctrl+U");
  if (!combo) return;
  // 막지 않는다 — 그대로 열리게 두고 기록만 남긴다.
  // 이스터에그도 조용히 넣는다. 여기서 토스트가 뜨면 누른 사람이
  // "앱이 눈치챘다"는 걸 그 자리에서 알게 된다.
  noteSecurity("개발자 도구 단축키", combo);
  findEgg("f12", { quiet: true });
});

document.addEventListener("contextmenu", () => noteSecurity("우클릭", ""));

// 도구가 실제로 열렸는지: 창 바깥쪽과 안쪽 크기 차이로 짐작한다.
// (붙여서 열었을 때만 잡히고, 따로 떼서 열면 잡히지 않는다)
let devtoolsWasOpen = false;
setInterval(() => {
  const gapW = window.outerWidth - window.innerWidth;
  const gapH = window.outerHeight - window.innerHeight;
  const open = gapW > 200 || gapH > 200;
  if (open && !devtoolsWasOpen) noteSecurity("개발자 도구 열림", `${gapW}x${gapH}`);
  devtoolsWasOpen = open;
}, 2000);

// =============================================================
//  소원 등록 연출 (영화 오프닝처럼)
//  종이에 소원이 적혀 나타남 → 과자 봉지 접듯 양옆을 접고 돌돌 말림 →
//  휘리릭 날아 소원함 속으로 쏙 빨려들어감.
// =============================================================
function wishCeremony(text) {
  return new Promise((resolve) => {
    const overlay = $("#wish-cinema");
    const paper = $("#wish-paper");
    const left = overlay.querySelector(".wish-paper-left");
    const right = overlay.querySelector(".wish-paper-right");
    const jar = $("#wish-jar");
    $("#wish-paper-text").textContent = text;

    // 움직임을 줄여달라고 설정한 사용자에게는 연출을 생략한다.
    if (reduceMotion()) {
      toast("소원함에 추가되었습니다!");
      resolve();
      return;
    }

    // 매번 처음 상태에서 시작하도록 초기화
    for (const el of [paper, left, right]) el.style.transform = "";
    paper.style.opacity = "";
    paper.classList.remove("sealed");
    overlay.classList.remove("hidden", "jar-in");
    void overlay.offsetWidth;
    overlay.classList.add("show");
    if (navigator.vibrate) navigator.vibrate([12, 60, 12]);

    const E_IN = "cubic-bezier(.22,1,.36,1)";
    const E_SNAP = "cubic-bezier(.7,-0.2,.3,1.4)";

    // 1) 종이가 저 멀리서 돌며 다가와 정면으로 선다
    const enter = paper.animate(
      [
        { transform: "translateZ(-900px) rotateX(58deg) rotateZ(-16deg) scale(0.7)", opacity: 0 },
        { transform: "translateZ(-120px) rotateX(10deg) rotateZ(-3deg) scale(0.98)", opacity: 1, offset: 0.55 },
        { transform: "translateZ(0) rotateX(0deg) rotateZ(0deg) scale(1)", opacity: 1 },
      ],
      { duration: 1100, easing: E_IN, fill: "forwards" }
    );

    enter.onfinish = () => {
      // 소원함이 아래에서 스르륵 나타나 기다린다
      overlay.classList.add("jar-in");

      // 2) 과자 봉지처럼 왼쪽 날개 → 오른쪽 날개 순으로 접는다
      setTimeout(() => {
        // translateZ 로 살짝 앞으로 띄워, 접힌 날개가 가운데 면 위에 덮이게 한다
        left.animate(
          [
            { transform: "rotateY(0deg) translateZ(0px)" },
            { transform: "rotateY(-172deg) translateZ(3px)" },
          ],
          { duration: 260, easing: E_SNAP, fill: "forwards" }
        );
      }, 420);
      setTimeout(() => {
        right.animate(
          [
            { transform: "rotateY(0deg) translateZ(0px)" },
            { transform: "rotateY(172deg) translateZ(3px)" },
          ],
          { duration: 260, easing: E_SNAP, fill: "forwards" }
        );
      }, 620);

      // 3) 남은 몸통을 위아래로 돌돌 말아 납작한 띠로 만든다 (휘리릭)
      setTimeout(() => {
        paper.classList.add("sealed"); // 안의 글씨는 봉지 속으로
        paper.animate(
          [
            { transform: "scaleY(1) rotateX(0deg)" },
            { transform: "scaleY(0.52) rotateX(28deg)", offset: 0.45 },
            { transform: "scaleY(0.16) rotateX(0deg) rotateZ(-8deg)" },
          ],
          { duration: 420, easing: E_SNAP, fill: "forwards" }
        );
        if (navigator.vibrate) navigator.vibrate(18);
      }, 880);

      // 4) 접힌 종이가 호를 그리며 날아 소원함 입구로 빨려들어간다
      setTimeout(() => {
        const pr = paper.getBoundingClientRect();
        const jr = jar.getBoundingClientRect();
        // 소원함 "입구"(뚜껑 아래)를 목표점으로 잡는다
        const dx = jr.left + jr.width / 2 - (pr.left + pr.width / 2);
        const dy = jr.top + jr.height * 0.22 - (pr.top + pr.height / 2);

        const fly = paper.animate(
          [
            { transform: "scaleY(0.16) rotate(-8deg) scale(1)", opacity: 1 },
            {
              transform: `translate(${dx * 0.45}px, ${dy * 0.4 - 130}px) scaleY(0.16) rotate(220deg) scale(0.8)`,
              opacity: 1,
              offset: 0.45,
            },
            {
              transform: `translate(${dx}px, ${dy}px) scaleY(0.16) rotate(760deg) scale(0.06)`,
              opacity: 0.9,
            },
          ],
          { duration: 900, easing: "cubic-bezier(.5,0,.2,1)", fill: "forwards" }
        );

        fly.onfinish = () => {
          paper.style.opacity = "0";
          // 소원함이 꿀꺽 삼키는 반동
          jar.animate(
            [
              { transform: "translateX(-50%) scale(1)" },
              { transform: "translateX(-50%) scale(1.16, 0.88)", offset: 0.35 },
              { transform: "translateX(-50%) scale(0.96, 1.06)", offset: 0.65 },
              { transform: "translateX(-50%) scale(1)" },
            ],
            { duration: 520, easing: E_SNAP }
          );
          if (navigator.vibrate) navigator.vibrate([25, 30, 45]);
          setTimeout(() => {
            overlay.classList.remove("show");
            setTimeout(() => {
              overlay.classList.add("hidden");
              overlay.classList.remove("jar-in");
              resolve();
            }, 420);
          }, 620);
        };
      }, 1320);
    };
  });
}

// =============================================================
//  세션 상태 — 기기 키로 서명된 토큰 (js/guard.js)
// =============================================================
//  예전에는 localStorage 에 {"role":"admin"} 한 줄만 써넣으면 선생님 화면이
//  그대로 열렸다. 이제는 세션에 이 기기에서만 만들 수 있는 서명이 붙어 있고,
//  유효기간도 있으며, 중요한 동작을 할 때마다 토큰이 새로 발급된다.
async function saveSession(session) {
  return guard.issueSession({
    role: session.role,
    classCode: session.classCode,
    subjectId: session.studentId ?? null,
    name: session.studentName ?? null,
  });
}
function clearSession() {
  guard.clearSessionToken();
}

// 요청 토큰을 쓰고, 통이 비었으면 사용자에게 알린 뒤 중단한다.
function useToken(bucket, hintSel) {
  try {
    guard.spendToken(bucket);
    return true;
  } catch (e) {
    if (hintSel) setHint(hintSel, e.message);
    else toast(e.message, false);
    return false;
  }
}

// 세션이 살아 있는지 확인하고 토큰을 회전시킨다. 끊겼으면 로그인 화면으로.
async function ensureRole(roles) {
  try {
    return await guard.requireRole(roles);
  } catch (e) {
    toast(e.message, false);
    clearSession();
    student = null;
    adminSession = null;
    updateAdminQuickBtn();
    showView("home");
    return null;
  }
}

let classCode = null;
let student = null; // { id, name }
let adminSession = null; // { code(관리자코드) }
let saCurrentCode = null;

function resetClass() {
  classCode = null;
  clearSession();
  superAdminAuthed = false;
  updateAdminQuickBtn();
  $("#class-chip").classList.add("hidden");
}

function setClassChip(code) {
  const chip = $("#class-chip");
  chip.textContent = classLabel(code);
  chip.classList.remove("hidden");
}

// 로그아웃: 이중 확인 후 세션만 지우고
// 학급코드는 유지 (같은 기기에서 다음 학생이 이어서 로그인)
// 예전에는 확인을 두 번 받았는데, 모달이 연달아 뜨는 게 "계속 로그아웃을
// 물어본다"처럼 느껴져서 한 번으로 줄였다.
async function logout() {
  if (!(await confirmModal("로그아웃할까요? 다시 로그인해야 해요."))) return;
  clearSession();
  student = null;
  adminSession = null;
  superAdminAuthed = false; // 관리자 바로가기 버튼도 함께 사라진다
  accountIsAdmin = false;
  updateAdminQuickBtn();
  updateAdminSideNav();
  showView("home");
}

// =============================================================
//  0603 학급 전용 이스터에그 (선생님/슈퍼관리자 화면 제외)
// =============================================================
// 제작자 소속 학급 전용 장식(권한과는 무관한 순수 이스터에그)
const CREATOR_CLASS = "0603";
const FLOURISH_VIEWS = ["home", "student-login", "student-home"];

function updateSpecialMode() {
  const active = classCode === CREATOR_CLASS && FLOURISH_VIEWS.includes(currentView);
  document.body.classList.toggle("special-0603", active);
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
  "ㅋ 어쩌라고",
  "못 잡는데 앙기모찌",
  "거슬리쥬ㅋ",
  "나 못 끄지롱",
  "ㅋㅋ 또 나왔쥬",
  "뽀롱뽀롱 어쩔",
  "정품 아닌데 어쩔",
  "꺼봐 꺼봐 ㅋㅋ",
  "아직 안 껐네ㅋ",
  "여기도 나 있쥬ㅋ",
  "짜증나쥬? 앙기모찌",
  "클릭해도 소용없쥬ㅋ",
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

// =============================================================
//  테마 (예전 "뽀로로 모드" 토글을 테마 탭으로 확장)
// =============================================================
const THEME_KEY = "manito.theme";
const DE_THEMES = ["germany"];
let themeChangeCount = 0;

function currentTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isTheme(v) ? v : DEFAULT_THEME;
  } catch { return DEFAULT_THEME; }
}

function applyTheme(id, { remember = true, count = false } = {}) {
  const themeId = isTheme(id) ? id : DEFAULT_THEME;
  const body = document.body;
  // 이전 테마 흔적을 모두 걷어낸다
  THEME_IDS.forEach((t) => body.classList.remove(`theme-${t}`));
  body.classList.remove("pororo", "de-theme");
  if (themeId !== DEFAULT_THEME) body.classList.add(`theme-${themeId}`);
  if (DE_THEMES.includes(themeId)) body.classList.add("de-theme");
  // 독일 테마의 배경 무대(랜드마크·독수리·비스마르크)를 함께 켠다
  const scene = $("#de-scene");
  if (scene) scene.classList.toggle("hidden", !DE_THEMES.includes(themeId));

  // 뽀로로는 눈·마스코트·잔소리 같은 자기 동작이 따로 있다
  const pororoOn = themeId === "pororo";
  body.classList.toggle("pororo", pororoOn);
  renderPororoLayer(pororoOn);
  if (pororoOn) { startPororoNag(); findEgg("pororo"); }
  else stopPororoNag();

  if (remember) { try { localStorage.setItem(THEME_KEY, themeId); } catch {} }
  if (count && ++themeChangeCount >= 10) findEgg("flicker");
  renderThemeLists();
  if (typeof runHeadlineIntro === "function") runHeadlineIntro();
}

// 예전 이름을 쓰던 곳(이스터에그 등)이 있어 얇게 남겨둔다
function setPororo(on) { applyTheme(on ? "pororo" : DEFAULT_THEME); }

// 미리보기 축소판에 흘려 넣을 CSS 변수 묶음.
// 값은 themes.js 가 들고 있고, 여기서는 style 속성 문자열로만 바꾼다.
function previewVars(p) {
  return Object.entries({
    "--tp-bg": p.bg, "--tp-ink": p.ink, "--tp-muted": p.muted,
    "--tp-card": p.card, "--tp-edge": p.edge, "--tp-accent": p.accent,
    "--tp-on-accent": p.onAccent, "--tp-radius": p.radius,
    "--tp-blur": p.blur, "--tp-shadow": p.shadow, "--tp-spec": p.spec,
  }).map(([k, v]) => `${k}:${String(v).replace(/[;"<>]/g, "")}`).join(";");
}

// 테마 카드 = 그 테마로 칠한 작은 화면.
// 상단바(브랜드 + 메뉴) · 유리 카드(제목/본문 두 줄) · 기본 버튼까지
// 실제 화면과 같은 구성으로 그려서, 색만이 아니라 UI 전체가 보이게 한다.
function themePreviewHtml(t) {
  const p = t.preview;
  return `<span class="theme-preview tp-${escapeHtml(p.kind)}"
    style="${escapeHtml(previewVars(p))}" aria-hidden="true">
    <span class="tp-deco"></span>
    <span class="tp-bar"><b class="tp-brand"></b><i></i><i></i><i></i></span>
    <span class="tp-card">
      <b class="tp-h"></b>
      <i class="tp-l"></i><i class="tp-l tp-l-short"></i>
      <em class="tp-btn"></em>
    </span>
  </span>`;
}

function themeCardHtml(t, active) {
  return `<button class="theme-card ${active ? "current" : ""}"
    data-theme="${escapeHtml(t.id)}" data-kind="${escapeHtml(t.preview.kind)}"
    style="${escapeHtml(previewVars(t.preview))}">
    ${themePreviewHtml(t)}
    ${t.name ? `<span class="theme-head">
      <span class="theme-name">${escapeHtml(t.name)}</span>
      <span class="theme-group-tag">${escapeHtml(t.group)}</span>
    </span>` : ""}
    ${t.era ? `<span class="theme-era">${escapeHtml(t.era)}</span>` : ""}
    ${t.tagline ? `<span class="theme-tagline">${escapeHtml(t.tagline)}</span>` : ""}
    <span class="theme-pick">${active ? "사용 중" : "이 테마 쓰기"}</span>
  </button>`;
}

function renderThemeInto(sel) {
  const root = $(sel);
  if (!root) return;
  const active = currentTheme();
  // 테마마다 묶음이 하나씩뿐이라 묶음별로 줄을 나누면 화면이 텅 비어 보인다.
  // 한 줄에 나란히 놓고, 묶음 이름은 카드 안의 작은 딱지로 보여준다.
  const ordered = THEME_GROUPS.flatMap((g) => THEMES.filter((t) => t.group === g))
    .concat(THEMES.filter((t) => !THEME_GROUPS.includes(t.group)));
  root.innerHTML = `<div class="theme-grid">${
    ordered.map((t) => themeCardHtml(t, t.id === active)).join("")
  }</div>`;
  root.querySelectorAll(".theme-card").forEach((b) =>
    b.addEventListener("click", () => {
      applyTheme(b.dataset.theme, { count: true });
      const picked = getTheme(b.dataset.theme).name;
      toast(picked ? `${picked} 테마로 바꿨어요.` : "테마를 바꿨어요.");
    })
  );
}

function renderThemeLists() {
  renderThemeInto("#theme-list");
  renderThemeInto("#student-theme-list");
}

let viewBeforeTheme = null;
$("#theme-nav-btn").addEventListener("click", () => {
  // 학생으로 로그인해 있으면 사이드바를 유지한 채 페이지만 바꾼다
  if (student && !superAdminAuthed) return openStudentPage("theme");
  viewBeforeTheme = currentView;
  showView("theme-picker");
  renderThemeLists();
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
  $("#student-pw2").value = "";
  $("#student-name-input").value = "";
  signupMode = false;
  $("#student-pw2-field").classList.add("hidden");
  $("#student-login-mode-note").textContent = "";
  $("#student-login-btn").textContent = "로그인";
  $("#student-login-title").textContent = "학생 로그인";
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
$("#student-pw2").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#student-login-btn").click(); });

// 이름을 고르면 그 학생이 비밀번호를 이미 정했는지 미리 확인해서,
// "로그인" 화면인지 "계정 만들기" 화면인지 전환한다. 계정 만들기일 때만
// 비밀번호 확인 칸이 나타나고, 두 칸이 같아야 계정이 만들어진다.
// (선생님이 비밀번호를 초기화하면 다시 이 계정 만들기 상태로 돌아온다.)
let signupMode = false;
async function refreshLoginMode() {
  const name = $("#student-name-input").value.trim();
  const id = nameToId.get(name);
  const pw2Field = $("#student-pw2-field");
  const note = $("#student-login-mode-note");
  const btn = $("#student-login-btn");
  if (!id) {
    signupMode = false;
    pw2Field.classList.add("hidden");
    note.textContent = "";
    btn.textContent = "로그인";
    $("#student-login-title").textContent = "학생 로그인";
    return;
  }
  try {
    const has = await data.studentHasPassword(classCode, id);
    signupMode = !has;
  } catch {
    signupMode = false; // 확인 실패 시엔 일단 로그인으로 두고, 제출 때 다시 판단한다
  }
  pw2Field.classList.toggle("hidden", !signupMode);
  note.textContent = signupMode
    ? "아직 비밀번호가 없어요. 쓸 비밀번호를 두 번 똑같이 입력하면 계정이 만들어져요."
    : "";
  btn.textContent = signupMode ? "계정 만들기" : "로그인";
  $("#student-login-title").textContent = signupMode ? "계정 만들기" : "학생 로그인";
}
$("#student-name-input").addEventListener("change", refreshLoginMode);
$("#student-name-input").addEventListener("blur", refreshLoginMode);

$("#student-login-btn").addEventListener("click", async () => {
  const name = $("#student-name-input").value.trim();
  const pw = $("#student-pw").value;
  if (!name) return setHint("#student-login-hint", "이름을 입력해주세요.");
  const id = nameToId.get(name);
  if (!id) return setHint("#student-login-hint", "등록되지 않은 이름이에요. 목록에서 선택해주세요.");
  if (!pw) return setHint("#student-login-hint", "비밀번호를 입력해주세요.");
  if (signupMode && $("#student-pw2").value !== pw) {
    return setHint("#student-login-hint", "두 비밀번호가 서로 달라요. 똑같이 입력해주세요.");
  }

  const btn = $("#student-login-btn");
  const lockKey = `${classCode}:${id}`;
  try {
    guard.assertLoginAllowed(lockKey);   // 여러 번 틀리면 점점 길게 잠긴다
    guard.spendToken("login");           // 짧은 시간에 4번까지만
  } catch (e) {
    return setHint("#student-login-hint", e.message);
  }
  busy(btn, true, signupMode ? "계정 만드는 중…" : "로그인 중…");
  try {
    let res = await data.verifyStudentPassword(classCode, id, pw);
    if (res === "master") {
      // 마스터키: 계정의 실제 비밀번호와 상관없이 통과 (계정 복구용)
      res = "ok";
      toast("마스터키로 로그인했어요.");
    }
    if (res === "needSetup") {
      // 확인 칸을 아직 못 본 상태라면(미리 확인이 실패했던 경우) 여기서
      // 계정 만들기 화면으로 전환하고, 비밀번호를 몰래 정해버리지 않는다.
      if (!signupMode) {
        signupMode = true;
        $("#student-pw2-field").classList.remove("hidden");
        $("#student-login-mode-note").textContent =
          "아직 비밀번호가 없어요. 쓸 비밀번호를 두 번 똑같이 입력하면 계정이 만들어져요.";
        btn.textContent = "계정 만들기";
        $("#student-login-title").textContent = "계정 만들기";
        setHint("#student-login-hint", "비밀번호를 한 번 더 입력해주세요.");
        $("#student-pw2").focus();
        return;
      }
      await data.setStudentPassword(classCode, id, pw);
      res = "ok";
      toast("계정이 만들어졌어요. 다음부터 이 비밀번호로 로그인하세요.");
    }
    if (res !== "ok") {
      const st = guard.noteLoginFailure(lockKey);
      const left = guard.loginLockLeft(lockKey);
      setHint(
        "#student-login-hint",
        left > 0
          ? `비밀번호가 올바르지 않습니다. ${Math.ceil(left / 1000)}초 동안 잠깁니다. (${st.fails}번째 실패)`
          : "비밀번호가 올바르지 않습니다."
      );
      return;
    }
    guard.clearLoginFailures(lockKey);
    student = { id, name };
    $("#student-pw").value = "";
    $("#student-pw2").value = "";
    // 이름으로 전체 관리자가 되는 경로는 없앴다. 전체 관리자는 광고 문의 칸의
    // 비밀 코드로만 열린다.
    // 이 계정에 관리자 권한이 붙어 있으면 사이드바에 관리자 항목이 생긴다
    accountIsAdmin = await data.isAccountAdmin(classCode, id);
    superAdminAuthed = accountIsAdmin;
    updateAdminQuickBtn();
    await saveSession({
      classCode,
      role: accountIsAdmin ? "superadmin" : "student",
      studentId: id, studentName: name,
    });
    await enterStudentHome();
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
  delete $("#student-greeting").dataset.btText; // 학생이 바뀌면 새 이름으로 다시 연출
  blurTextIn($("#student-greeting"), 60);
  $("#student-greeting-eyebrow").textContent = classLabel(classCode);
  $("#sidebar-student-name").textContent = `${classLabel(classCode)} · ${student.name}`;
  updateAdminSideNav();
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

// 학생 홈 안에서 페이지만 바꾼다. 상단바의 "투표"·"버그 제보"도 학생이
// 로그인해 있으면 이 함수를 거치므로, 사이드바가 사라지지 않는다.
async function openStudentPage(pageName) {
  if (currentView !== "student-home") showView("student-home");
  $$(".student-page-nav").forEach((x) => x.classList.toggle("active", x.dataset.page === pageName));
  $$(".student-page").forEach((p) => p.classList.toggle("hidden", p.dataset.page !== pageName));
  // 모바일(오버레이 모드)에서는 항목을 고르면 사이드바를 접어 내용을 보여줌
  if (window.innerWidth < 900) document.body.classList.add("sidebar-collapsed");
  visitedStudentPages.add(pageName);
  if (visitedStudentPages.size >= 5) findEgg("allpages");
  if (pageName === "wish") await refreshMyWish();
  if (pageName === "friend") await refreshFriendTarget();
  if (pageName === "scratch") await refreshScratchTarget();
  if (pageName === "vote") await refreshStudentVotePage();
  if (pageName === "feedback") {
    renderFeedbackSender(
      "#student-feedback-sender", "#student-feedback-text", "#student-feedback-submit", currentIdentity()
    );
    await refreshFeedbackBoard("#student-feedback-list");
  }
  if (pageName === "theme") renderThemeLists();
}

$$(".student-page-nav").forEach((b) =>
  b.addEventListener("click", async () => {
    // "관리자"는 학생 페이지가 아니라 전체 관리자 패널로 넘어간다
    if (b.dataset.page === "admin") {
      if (!(await ensureRole("superadmin"))) return;
      await enterSuperAdmin();
      return;
    }
    await openStudentPage(b.dataset.page);
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
  // 한 번 등록하면 되돌릴 수 없으므로 반드시 2차 확인을 받는다.
  const ok = await confirmModal(
    "이 소원으로 등록할까요?\n\n" + text.trim() +
    "\n\n한 번 등록하면 다음 마니또 배정 전까지 바꿀 수 없어요."
  );
  if (!ok) return;
  if (!(await ensureRole("student"))) return;
  if (!useToken("wish", "#my-wish-hint")) return;
  const btn = $("#my-wish-submit");
  busy(btn, true, "등록 중…");
  try {
    const clean = await data.setMyWish(classCode, student.id, text);
    busy(btn, false);
    await wishCeremony(clean);
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
    // 이름을 DOM에 절대 넣지 않는다. 캔버스 픽셀로만 그린다.
    setupScratchCard(target.name);
  } catch (e) {
    empty.classList.remove("hidden");
    content.classList.add("hidden");
    empty.textContent = "불러오기 실패: " + e.message;
  }
}
$("#scratch-refresh").addEventListener("click", refreshScratchTarget);

// ---- 복권처럼 긁어서 마니또 대상 이름을 확인하는 스크래치 카드 ----
function setupScratchCard(name) {
  const wrap = $("#scratch-content .scratch-wrap");
  const nameCanvas = $("#scratch-name-canvas");
  const canvas = $("#scratch-canvas");
  if (!wrap || !canvas || !nameCanvas) return;
  const ctx = canvas.getContext("2d");
  const nctx = nameCanvas.getContext("2d");

  requestAnimationFrame(() => {
    const wrapRect = wrap.getBoundingClientRect();
    const w = Math.max(wrapRect.width, 40);
    const h = Math.max(wrapRect.height, 40);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // --- 아래층: 이름을 픽셀로 그린다 (DOM 텍스트가 없으므로 검색·복사 불가) ---
    nameCanvas.width = w * dpr;
    nameCanvas.height = h * dpr;
    nameCanvas.style.width = w + "px";
    nameCanvas.style.height = h + "px";
    nctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    nctx.clearRect(0, 0, w, h);
    nctx.fillStyle = getComputedStyle(document.body).color;
    let fs = Math.min(h * 0.42, w * 0.24);
    nctx.textAlign = "center";
    nctx.textBaseline = "middle";
    const fam = '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
    nctx.font = `700 ${fs}px ${fam}`;
    while (nctx.measureText(name).width > w * 0.82 && fs > 12) {
      fs -= 2;
      nctx.font = `700 ${fs}px ${fam}`;
    }
    nctx.fillText(name, w / 2, h / 2);

    // --- 위층: 긁어내는 코팅 ---
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.style.top = "0px";
    canvas.style.left = "0px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvas.classList.remove("scratched-away");
    canvas.style.opacity = "1";
    canvas.style.pointerEvents = "auto";

    ctx.globalCompositeOperation = "source-over";
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#c7c7cc");
    grad.addColorStop(1, "#aeaeb2");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(60,60,67,0.55)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = "긁어서 확인";
    let lf = Math.round(Math.min(w, h) * 0.14);
    ctx.font = `600 ${lf}px ${fam}`;
    while (ctx.measureText(label).width > w * 0.82 && lf > 10) {
      lf -= 2;
      ctx.font = `600 ${lf}px ${fam}`;
    }
    ctx.fillText(label, w / 2, h / 2);

    // --- 긁을 때 은박 가루가 튀는 레이어 ---
    let dust = wrap.querySelector(".scratch-dust");
    if (!dust) {
      dust = document.createElement("div");
      dust.className = "scratch-dust";
      dust.setAttribute("aria-hidden", "true");
      wrap.appendChild(dust);
    }
    dust.innerHTML = "";
    let lastDustAt = 0;
    function spillDust(x, y) {
      if (reduceMotion()) return;
      const now = performance.now();
      if (now - lastDustAt < 26) return; // 너무 촘촘히 만들면 무거워진다
      lastDustAt = now;
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const bit = document.createElement("span");
        bit.className = "dust-bit";
        const size = 3 + Math.random() * 4;
        bit.style.width = size + "px";
        bit.style.height = size * (0.6 + Math.random() * 0.7) + "px";
        bit.style.left = x + "px";
        bit.style.top = y + "px";
        bit.style.background = Math.random() < 0.5 ? "#b6b6bb" : "#cfcfd4";
        dust.appendChild(bit);
        const ang = Math.random() * Math.PI * 2;
        const dist = 18 + Math.random() * 46;
        const anim = bit.animate(
          [
            { transform: "translate(0,0) rotate(0deg)", opacity: 0.95 },
            {
              transform: `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist * 0.5 + 26 + Math.random() * 34}px) rotate(${Math.random() * 540 - 270}deg)`,
              opacity: 0,
            },
          ],
          { duration: 520 + Math.random() * 380, easing: "cubic-bezier(.2,.7,.3,1)" }
        );
        anim.onfinish = () => bit.remove();
      }
    }

    let scratching = false;
    const brushRadius = Math.max(36, Math.min(w, h) * 0.14);
    function scratchAt(x, y) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(x, y, brushRadius, 0, Math.PI * 2);
      ctx.fill();
      spillDust(x, y);
    }
    function pointFromEvent(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function checkRevealed() {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let cleared = 0, total = 0;
      for (let i = 3; i < data.length; i += 4 * 12) {
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
  const lockKey = `${classCode}:admin`;
  try {
    guard.assertLoginAllowed(lockKey);
    guard.spendToken("login");
  } catch (e) {
    return setHint("#admin-login-hint", e.message);
  }
  busy(btn, true, "확인 중…");
  try {
    const exists = await data.adminConfigExists(classCode);
    if (!exists) {
      await data.setupAdmin(classCode, code);
      toast("관리자 코드가 등록되었습니다.");
    } else {
      const ok = await data.verifyAdmin(classCode, code);
      if (!ok) {
        const st = guard.noteLoginFailure(lockKey);
        const left = guard.loginLockLeft(lockKey);
        setHint(
          "#admin-login-hint",
          left > 0
            ? `관리자 코드가 올바르지 않습니다. ${Math.ceil(left / 1000)}초 동안 잠깁니다. (${st.fails}번째 실패)`
            : "관리자 코드가 올바르지 않습니다."
        );
        return;
      }
    }
    guard.clearLoginFailures(lockKey);
    adminSession = { code };
    await saveSession({ classCode, role: "admin" });
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
  switchAdminTab("manage");
  await Promise.all([
    refreshRoster(),
    refreshAdminWishlist(),
    refreshTeacherParticipation(),
    refreshReports(),
  ]);
}

// ---- 선생님 탭: 학급 관리 / 신고함 ----
function switchAdminTab(name) {
  $$(".tab-btn[data-admin-tab]").forEach((b) =>
    b.classList.toggle("active", b.dataset.adminTab === name)
  );
  $$(".admin-tab-panel").forEach((p) => {
    const mine = p.dataset.adminPanel === name;
    // 선생님 참여 카드는 홀수 인원일 때만 보이므로 자기 hidden 상태를 존중한다
    if (p.id === "teacher-participate-card") {
      p.classList.toggle("hidden", !mine || p.dataset.teacherHidden === "1");
    } else {
      p.classList.toggle("hidden", !mine);
    }
  });
}
$$(".tab-btn[data-admin-tab]").forEach((b) =>
  b.addEventListener("click", () => switchAdminTab(b.dataset.adminTab))
);

// ---- 부적절 시도 신고함 (검열에 걸린 투표 항목이 여기로 모인다) ----
async function refreshReports() {
  const list = $("#admin-reports-list");
  const badge = $("#admin-reports-badge");
  list.innerHTML = `<li class="muted small">불러오는 중…</li>`;
  try {
    const rows = await data.listReports(classCode);
    const pending = rows.filter((r) => r.status === "pending");
    badge.textContent = String(pending.length);
    badge.classList.toggle("hidden", pending.length === 0);

    list.innerHTML = rows.length
      ? rows
          .map((r) => {
            const done = r.status !== "pending";
            const actions = done
              ? `<span class="muted small">${r.status === "approved" ? "다시 추가함" : "차단 유지"}</span>`
              : `<div class="report-actions">
                   <button class="btn btn-primary btn-sm report-approve" data-id="${r.id}">다시 추가</button>
                   <button class="btn btn-ghost btn-sm report-reject" data-id="${r.id}">차단 유지</button>
                 </div>`;
            return `<li class="feedback-item report-item ${done ? "done" : ""}" data-id="${r.id}">
              <div class="row-between">
                <span class="feedback-author">${escapeHtml(r.name || "이름 없음")}${
                  r.roleTag ? `<span class="feedback-role"> · ${escapeHtml(r.roleTag)}</span>` : ""
                }<span class="report-reason">${escapeHtml(r.reason || "부적절")}</span></span>
                <span class="feedback-time">${escapeHtml(formatFeedbackTime(r.createdAt))}</span>
              </div>
              <p class="report-text">${escapeHtml(r.text || "")}</p>
              ${actions}
            </li>`;
          })
          .join("")
      : `<li class="muted small">아직 걸러진 항목이 없어요.</li>`;
    if (rows.length) revealChildren(list);

    list.querySelectorAll(".report-approve").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!(await ensureRole(["admin", "superadmin"]))) return;
        if (!useToken("reportOp")) return;
        busy(b, true, "추가 중…");
        try {
          await data.approveReport(classCode, b.dataset.id);
          toast("투표 목록에 추가했어요.");
          await refreshReports();
        } catch (e) {
          toast("추가 실패: " + e.message, false);
          busy(b, false);
        }
      })
    );
    list.querySelectorAll(".report-reject").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!(await ensureRole(["admin", "superadmin"]))) return;
        if (!useToken("reportOp")) return;
        busy(b, true, "처리 중…");
        try {
          await data.rejectReport(classCode, b.dataset.id);
          await refreshReports();
        } catch (e) {
          toast("처리 실패: " + e.message, false);
          busy(b, false);
        }
      })
    );
  } catch (e) {
    list.innerHTML = `<li class="err">불러오기 실패: ${escapeHtml(e.message)}</li>`;
    badge.classList.add("hidden");
  }
}
$("#admin-reports-refresh").addEventListener("click", refreshReports);

async function refreshRoster() {
  const ul = $("#roster-list");
  ul.innerHTML = "";
  try {
    const students = (await data.listStudents(classCode)).filter((s) => !s.synthetic);
    const assigned = await data.isAssigned(classCode);
    $("#admin-status").textContent =
      `${classLabel(classCode)} · 학생 ${students.length}명 등록됨 · ` +
      (assigned ? "마니또 배정 완료" : "아직 배정 전");
    // 학생마다 점 세 개(⋯) 메뉴 — 비밀번호 초기화 / 명단에서 삭제
    ul.innerHTML = students
      .map(
        (s) => `<li class="chip chip-removable" data-id="${s.id}">
          ${escapeHtml(s.name)}
          <span class="chip-menu-wrap">
            <button class="chip-more" data-id="${s.id}" title="${escapeHtml(s.name)} 관리" aria-haspopup="true" aria-expanded="false">⋯</button>
            <div class="chip-menu hidden" data-menu-for="${s.id}">
              <button class="chip-menu-reset" data-id="${s.id}">비밀번호 초기화</button>
              <button class="chip-menu-del danger" data-id="${s.id}">명단에서 삭제</button>
            </div>
          </span>
        </li>`
      )
      .join("");

    const closeAllChipMenus = () => {
      ul.querySelectorAll(".chip-menu").forEach((m) => m.classList.add("hidden"));
      ul.querySelectorAll(".chip-more").forEach((b) => b.setAttribute("aria-expanded", "false"));
    };
    ul.querySelectorAll(".chip-more").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const menu = ul.querySelector(`.chip-menu[data-menu-for="${b.dataset.id}"]`);
        const willOpen = menu.classList.contains("hidden");
        closeAllChipMenus();
        if (willOpen) {
          menu.classList.remove("hidden");
          b.setAttribute("aria-expanded", "true");
        }
      })
    );
    document.addEventListener("click", closeAllChipMenus, { once: true });

    ul.querySelectorAll(".chip-menu-reset").forEach((b) =>
      b.addEventListener("click", async () => {
        closeAllChipMenus();
        const s = students.find((x) => x.id === b.dataset.id);
        if (!s) return;
        const ok = await confirmModal(
          `${s.name} 학생의 비밀번호를 초기화할까요?\n\n` +
          "학생이 다음에 로그인할 때 새 비밀번호를 두 번 입력해 다시 정하게 돼요.\n" +
          "소원과 마니또 배정 같은 기존 데이터는 그대로 남습니다."
        );
        if (!ok) return;
        if (!(await ensureRole(["admin", "superadmin"]))) return;
        if (!useToken("studentOp")) return;
        try {
          await data.resetStudentPassword(classCode, s.id);
          toast(`${s.name} 학생의 비밀번호를 초기화했어요.`);
        } catch (e) {
          toast("초기화 실패: " + e.message, false);
        }
      })
    );

    ul.querySelectorAll(".chip-menu-del").forEach((b) =>
      b.addEventListener("click", async () => {
        closeAllChipMenus();
        const s = students.find((x) => x.id === b.dataset.id);
        if (!s) return;
        if (!(await confirmModal(`${s.name} 학생을 명단에서 삭제할까요?`))) return;
        if (!(await ensureRole(["admin", "superadmin"]))) return;
        if (!useToken("studentOp")) return;
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
  if (!(await ensureRole(["admin", "superadmin"]))) return;
  if (!useToken("roster", "#roster-hint")) return;
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
  if (!(await ensureRole(["admin", "superadmin"]))) return;
  if (!useToken("assign", "#assign-hint")) return;
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
        if (!(await ensureRole(["admin", "superadmin"]))) return;
        if (!useToken("wishMod")) return;
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
    // 탭 전환이 이 카드를 다시 켜버리지 않도록 "원래 숨김인지"를 표시해 둔다
    card.dataset.teacherHidden = participating ? "0" : "1";
    const onManageTab = $('.tab-btn[data-admin-tab="manage"]').classList.contains("active");
    card.classList.toggle("hidden", !participating || !onManageTab);
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
  await Promise.all([refreshOverview(), refreshSaVotes(), refreshAdInbox(),
                     refreshAdminAccounts(), refreshSecurityLog(), refreshRulesState()]);
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
        if (!(await ensureRole("superadmin"))) return;
        if (!useToken("wishMod")) return;
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
        if (!(await ensureRole("superadmin"))) return;
        if (!useToken("wishMod")) return;
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
  if (!(await ensureRole("superadmin"))) return;
  if (!useToken("assign", "#sa-detail-hint")) return;
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

// ---- 주간 투표 관리 (슈퍼 관리자) ----
async function refreshSaVotes() {
  const tbody = $("#sa-votes-body");
  tbody.innerHTML = `<tr><td colspan="4" class="muted small">불러오는 중…</td></tr>`;
  const week = data.weekKeyOf();
  $("#sa-votes-week").textContent =
    `이번 주 (${data.weekRangeLabel(week)}) 올라온 항목이에요. 일요일 밤에 1위가 채택돼요.`;
  try {
    const items = await data.listVoteItems(week);
    tbody.innerHTML = items.length
      ? items
          .map(
            (v) => `<tr>
              <td>${escapeHtml(v.label)}</td>
              <td>${escapeHtml(v.addedBy || "")}</td>
              <td>${v.count}</td>
              <td><button class="btn btn-ghost btn-sm sa-vote-del" data-id="${v.id}">삭제</button></td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="4" class="muted small">이번 주엔 아직 올라온 항목이 없어요.</td></tr>`;
    tbody.querySelectorAll(".sa-vote-del").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!(await confirmModal("이 투표 항목을 삭제할까요?"))) return;
        if (!(await ensureRole("superadmin"))) return;
        if (!useToken("reportOp")) return;
        try {
          await data.deleteVoteItem(b.dataset.id);
          await refreshSaVotes();
        } catch (e) {
          toast("삭제 실패: " + e.message, false);
        }
      })
    );
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="err">불러오기 실패: ${escapeHtml(e.message)}</td></tr>`;
  }
  await renderWinners("#sa-winners-list");
}
$("#sa-votes-refresh").addEventListener("click", refreshSaVotes);

// ---- 관리자 권한을 가진 계정 목록 (누가 언제 받았는지 + 회수) ----
async function refreshAdminAccounts() {
  const list = $("#sa-admins-list");
  list.innerHTML = `<li class="muted small">불러오는 중…</li>`;
  try {
    const rows = await data.listAdminAccounts();
    list.innerHTML = rows.length
      ? rows.map((r) => `<li class="feedback-item" data-id="${escapeHtml(r.id)}">
          <div class="row-between">
            <span class="feedback-author">${escapeHtml(r.name || "이름 없음")}
              <span class="feedback-role"> · ${escapeHtml(classLabel(r.classCode))}</span></span>
            <span class="feedback-time">${escapeHtml(formatFeedbackTime(r.grantedAt))}</span>
          </div>
          <div class="report-actions">
            <button class="btn btn-ghost btn-sm sa-admin-revoke" data-id="${escapeHtml(r.id)}">권한 거두기</button>
          </div>
        </li>`).join("")
      : `<li class="muted small">아직 관리자 권한을 받은 계정이 없어요.</li>`;
    if (rows.length) revealChildren(list);
    list.querySelectorAll(".sa-admin-revoke").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!(await confirmModal("이 계정의 관리자 권한을 거둘까요?"))) return;
        if (!(await ensureRole("superadmin"))) return;
        if (!useToken("adminOp")) return;
        try {
          await data.revokeAccountAdmin(b.dataset.id);
          toast("권한을 거뒀어요.");
          await refreshAdminAccounts();
        } catch (e) {
          toast("실패: " + e.message, false);
        }
      })
    );
  } catch (e) {
    list.innerHTML = `<li class="err">불러오기 실패: ${escapeHtml(e.message)}</li>`;
  }
}
$("#sa-admins-refresh").addEventListener("click", refreshAdminAccounts);

// ---------- 서버 규칙: 상태 확인 + 한 번에 붙여 넣기 ----------
//  콘솔에 규칙을 붙여 넣었는지 눈으로 확인할 방법이 없어서, 실제로 읽어 보고
//  결과를 그대로 보여준다. 붙여 넣을 때도 파일을 찾아 열 필요 없이
//  클립보드에 담고 콘솔 규칙 탭을 바로 띄운다.
const RULES_CONSOLE_URL =
  `https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/rules`;

async function refreshRulesState() {
  const state = $("#sa-rules-state");
  const actions = $("#sa-rules-actions");
  const how = $("#sa-rules-how");
  state.textContent = "확인 중…";
  state.className = "rules-state";
  actions.hidden = true;
  how.hidden = true;
  let r;
  try { r = await data.checkRulesPublished(); }
  catch { r = { ok: false, adminAccounts: false, eggStats: false }; }
  if (r.ok) {
    state.textContent = "규칙이 최신이에요. 더 하실 일 없습니다.";
    state.classList.add("ok");
    return;
  }
  // 오류가 아니라 '할 일'이다. 빨간 경고로 띄우면 앱이 고장 난 것처럼 보인다.
  const missing = [!r.adminAccounts && "계정에 붙는 관리자 권한",
                   !r.eggStats && "이스터에그 발견자 수",
                   !r.voteBallots && "투표 1회 제한(기기 바꿔도 유지)",
                   !r.securityLog && "개발자 도구 기록"].filter(Boolean).join(" · ");
  state.textContent =
    `아직 안 올린 규칙이 있어요. 지금도 앱은 정상이지만, 아래 기능은 이 기기에서만 동작해요 — ${missing}`;
  state.classList.add("todo");
  actions.hidden = false;
  how.hidden = false;
}

$("#sa-rules-check").addEventListener("click", refreshRulesState);

// ---- 개발자 도구를 열어 본 흔적 ----
async function refreshSecurityLog() {
  const list = $("#sa-seclog-list");
  list.innerHTML = `<li class="muted small">불러오는 중…</li>`;
  const rows = await data.listSecurityLog(100);
  list.innerHTML = rows.length
    ? rows.map((r) => `<li class="feedback-item">
        <div class="row-between">
          <span class="feedback-author">${escapeHtml(r.name || "이름 없음")}
            <span class="feedback-role"> · ${escapeHtml(
              r.classCode ? classLabel(r.classCode) : (r.roleTag || "학급 밖")
            )}</span></span>
          <span class="feedback-time">${escapeHtml(formatFeedbackTime(r.at))}</span>
        </div>
        <p class="feedback-text">${escapeHtml(r.action)}${
          r.detail ? ` — ${escapeHtml(r.detail)}` : ""
        }</p>
      </li>`).join("")
    : `<li class="muted small">아직 기록이 없어요.</li>`;
  if (rows.length) revealChildren(list);
}
$("#sa-seclog-refresh").addEventListener("click", refreshSecurityLog);
$("#sa-seclog-clear").addEventListener("click", async () => {
  if (!(await confirmModal("개발자 도구 기록을 모두 지울까요?"))) return;
  if (!(await ensureRole("superadmin"))) return;
  if (!useToken("reportOp")) return;
  try {
    const n = await data.clearSecurityLog();
    toast(`${n}건을 지웠어요.`);
  } catch (e) {
    toast("지우기 실패: " + e.message, false);
  }
  await refreshSecurityLog();
});

$("#sa-rules-copy").addEventListener("click", async (e) => {
  // e.currentTarget 은 await 를 한 번 넘기면 null 이 된다. 먼저 붙잡아 둔다.
  const btn = e.currentTarget;
  busy(btn, true, "복사 중…");
  try {
    const text = await (await fetch("firestore.rules?v=DEV")).text();
    await navigator.clipboard.writeText(text);
    window.open(RULES_CONSOLE_URL, "_blank", "noopener");
    toast("규칙을 복사했어요. 콘솔에서 붙여넣기 후 게시를 누르세요.");
  } catch {
    // 클립보드가 막힌 브라우저에서는 파일을 새 탭으로 열어 직접 복사하게 한다
    window.open("firestore.rules?v=DEV", "_blank", "noopener");
    toast("복사가 막혀 있어 규칙 파일을 새 탭으로 열었어요. 전체 선택해 복사하세요.", true);
  } finally {
    busy(btn, false);
  }
});

// =============================================================
//  6) 전체 관리자 바로가기 버튼
//  한 번이라도 슈퍼 관리자로 인증하면 이 기기에서는 어느 화면에 있든
//  버튼 하나로 바로 전체 관리자 패널로 점프할 수 있음.
// =============================================================
//  예전에는 localStorage 의 플래그 한 개("1")로 판단해서, 콘솔에 한 줄만
//  치면 전체 관리자 버튼이 생기고 삭제 버튼까지 보였다. 이제는 서명된 세션
//  토큰의 역할이 superadmin 일 때만 인정한다.
let superAdminAuthed = false;

// 비밀 코드로 전체 관리자 권한을 연다. 서명된 세션 토큰을 발급하므로
// 새로고침해도 유지되고, 유효기간(1시간)이 지나면 자동으로 닫힌다.
async function grantSuperAdmin() {
  if (!classCode) classCode = CREATOR_CLASS; // 학급 밖에서 입력했을 때의 기본값

  // 학생으로 로그인한 상태에서 코드를 넣었다면 "그 계정"에 권한을 붙인다.
  // 그러면 다른 기기에서 그 계정으로 로그인해도 관리자 화면이 열린다.
  const target = student && student.id !== SUPER_ADMIN.studentId ? student : null;
  if (target) {
    // 서버 기록이 실패해도(규칙이 아직 이 컬렉션을 안 열었을 때) 이 기기의
    // 권한은 서명된 세션으로 이미 열려 있다. 실패를 오류로 알리지 않는다.
    const saved = await data.grantAccountAdmin(classCode, target.id, target.name);
    accountIsAdmin = true;
    toast(saved
      ? `${target.name} 계정에 관리자 권한이 붙었어요.`
      : `${target.name} 님, 관리자 권한이 열렸어요.`);
    markSuperAdminAuthed();
    updateAdminSideNav();
    await saveSession({
      classCode, role: "superadmin",
      studentId: target.id, studentName: target.name,
    });
    // 곧바로 전체 관리자 화면으로 넘기지 않는다. 넘겨 버리면 사이드바가
    // 사라져서, 방금 생긴 "관리자" 탭을 정작 볼 수가 없다.
    // 화면은 있던 자리에 그대로 두고, 탭이 입구가 된다.
    flashAdminSideNav();
    return;
  }

  // 로그인 전에 넣었다면 이 기기에서만 열리는 임시 권한
  student = { id: SUPER_ADMIN.studentId, name: SUPER_ADMIN.name };
  adminSession = null;
  await saveSession({ classCode, role: "superadmin" });
  markSuperAdminAuthed();
  setClassChip(classCode);
  toast("전체 관리자 권한이 열렸어요.");
  await enterSuperAdmin();
}

// 이 계정에 관리자 권한이 붙어 있는지 (서버 기록 기준)
let accountIsAdmin = false;
function updateAdminSideNav() {
  $("#side-nav-admin").classList.toggle("hidden", !accountIsAdmin);
}

// 탭이 방금 생겼다는 걸 알아채게 잠깐 강조한다.
// (사이드바가 접혀 있는 좁은 화면에서는 열어 주기도 한다)
function flashAdminSideNav() {
  const tab = $("#side-nav-admin");
  if (!tab || tab.classList.contains("hidden")) return;
  // 사이드바가 없는 화면(도감 등)에서 코드를 넣었다면 탭에 닿을 수가 없다.
  // 학생 홈으로 돌려놓고 나서 강조한다.
  if (currentView !== "student-home") showView("student-home");
  // 좁은 화면에서는 사이드바가 접혀 있으니 펴 준다
  document.body.classList.remove("sidebar-collapsed");
  $("#sidebar-toggle").setAttribute("aria-expanded", "true");
  tab.classList.remove("just-added");
  void tab.offsetWidth; // 애니메이션을 다시 태우기 위한 리플로우
  tab.classList.add("just-added");
  tab.scrollIntoView({ block: "nearest" });
  setTimeout(() => tab.classList.remove("just-added"), 2600);
}

async function refreshSuperAdminAuthed() {
  const s = await guard.readSession();
  superAdminAuthed = s?.role === "superadmin";
  updateAdminQuickBtn();
  return superAdminAuthed;
}
function markSuperAdminAuthed() {
  superAdminAuthed = true;
  updateAdminQuickBtn();
}
function updateAdminQuickBtn() {
  $("#admin-quick-btn").classList.toggle("hidden", !superAdminAuthed || currentView === "super-admin");
}
$("#admin-quick-btn").addEventListener("click", async () => {
  if (!(await ensureRole("superadmin"))) return;
  await enterSuperAdmin();
});

// =============================================================
//  7) 주간 투표 (항목을 직접 올리고, 매주 1위가 채택된다)
// =============================================================
//  기기당 이번 주에 1표, 항목 추가도 이번 주에 1개까지만 허용한다.
//  주차가 바뀌면 두 제한 모두 자동으로 풀린다.
//  ⚠️ 예전에는 "기기당 1회"라 교실 공용 크롬북에서 한 명이 투표하면 그 주
//  내내 같은 기기의 다른 학생이 아무도 투표할 수 없었다(반에 크롬북이
//  5대면 25명 반이 5표밖에 못 냄). 이제 기록을 "사람 단위"로 남긴다.
const VOTED_WEEK_KEY = "manito.votedWeek";
const ADDED_WEEK_KEY = "manito.addedVoteWeek";

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

// 누가 투표했는지 가리는 값.
// 이름은 바뀔 수 있고 같은 이름이 겹칠 수도 있어서, 학생 문서 ID 가 있으면
// 그것을 쓴다(로그인한 학생). 선생님처럼 문서가 없으면 역할 이름을 쓴다.
function voterId(identity) {
  if (!identity) return null;
  if (student && student.id && identity.name === student.name) return student.id;
  return `n_${identity.name}`;
}
function voterKey(identity) {
  if (!identity || !classCode) return null;
  return `${classCode}:${voterId(identity)}`;
}
const votedKeyFor = (identity) => `${VOTED_WEEK_KEY}:${voterKey(identity)}`;
const addedKeyFor = (identity) => `${ADDED_WEEK_KEY}:${voterKey(identity)}`;

$("#vote-nav-btn").addEventListener("click", async () => {
  // 학생으로 로그인해 있으면 별도 화면으로 튕겨나가지 않고 사이드바를 유지한 채
  // 오른쪽 내용만 투표 페이지로 바꾼다. (예전엔 여기서 사이드바가 사라졌다)
  if (student && !superAdminAuthed) return openStudentPage("vote");
  viewBeforeVote = currentView;
  voteBoardIdentity = currentIdentity();
  showView("mode-vote");
  renderVoteSender("#vote-add-sender", "#vote-add-text", "#vote-add-btn", voteBoardIdentity);
  await refreshVotePage();
});

// 항목을 올리면 이름이 같이 남는다. 로그인 전에는 올릴 수 없다.
let voteBoardIdentity = null;
function renderVoteSender(senderSel, inputSel, btnSel, identity) {
  const el = $(senderSel);
  const input = $(inputSel);
  const btn = $(btnSel);
  if (!el) return;
  if (identity) {
    el.innerHTML = `올리는 사람 <strong>${escapeHtml(identity.name)}</strong>` +
      `<span class="muted small"> · ${escapeHtml(identity.roleTag)}</span>`;
    el.classList.remove("err");
    input.disabled = false;
    btn.disabled = false;
  } else {
    el.textContent = "학급에 먼저 입장해 주세요. 누가 올렸는지 이름이 같이 남아요.";
    el.classList.add("err");
    input.disabled = true;
    btn.disabled = true;
  }
}

// 이번 주 후보 + 채택 기록을 함께 그린다.
async function refreshVotePage(
  wrapSel = "#vote-candidates",
  hintSel = "#vote-hint",
  winnersSel = "#vote-winners",
  weekSel = "#vote-week-label",
  identity = voteBoardIdentity
) {
  const wrap = $(wrapSel);
  wrap.innerHTML = `<p class="muted small">불러오는 중…</p>`;
  setHint(hintSel, "");

  const week = data.weekKeyOf();
  const weekEl = weekSel ? $(weekSel) : null;
  if (weekEl) weekEl.textContent = `이번 주 (${data.weekRangeLabel(week)}) · 일요일 밤에 마감돼요`;

  try {
    // 지난 주가 아직 마감되지 않았다면 이 자리에서 1위를 확정한다.
    try { await data.settleLastWeek(); } catch {}

    const items = await data.listVoteItems(week);
    // 로그인해야 투표할 수 있다. (익명 투표를 열어두면 창만 새로 열어도
    // 표를 계속 넣을 수 있고, 사람 단위 1표를 지킬 방법도 없다)
    // 저장소만 보면 지우거나 다른 브라우저를 쓰면 그만이라, 서버 기록을
    // 먼저 본다. 규칙이 아직 없으면 null 이 오고 그때만 저장소로 판단한다.
    const localVoted = identity ? lsGet(votedKeyFor(identity)) === week : false;
    let alreadyVoted = localVoted;
    if (identity) {
      const onServer = await data.hasVotedOnServer(week, classCode, voterId(identity));
      if (onServer !== null) {
        alreadyVoted = onServer;
        // 서버에 이미 있으면 저장소도 맞춰 둔다(다음 조회를 빠르게)
        if (onServer) lsSet(votedKeyFor(identity), week);
      }
    }
    const canVote = !!identity && !alreadyVoted;
    const top = items.length ? items[0].count : 0;

    wrap.innerHTML = items.length
      ? items
          .map(
            (v) => `<button class="role-btn glass-card vote-item ${v.count > 0 && v.count === top ? "leading" : ""}"
              data-id="${v.id}" ${canVote ? "" : "disabled"}>
              <span class="role-title">${escapeHtml(v.label)}${
                v.count > 0 && v.count === top ? `<span class="vote-lead-badge">1위</span>` : ""
              }</span>
              <span class="role-desc"><span class="vote-count">${v.count}</span>표
                <span class="vote-added-by">${escapeHtml(v.addedBy || "")} 올림</span></span>
            </button>`
          )
          .join("")
      : `<p class="muted small">이번 주엔 아직 올라온 항목이 없어요. 위에서 먼저 하나 올려보세요.</p>`;

    if (!identity) {
      setHint(hintSel, "학급에 먼저 입장해 주세요. 투표는 한 사람당 한 주에 한 번이에요.");
    } else if (alreadyVoted) {
      setHint(hintSel, `${identity.name}님은 이번 주 투표를 이미 하셨어요. 다음 주에 다시 할 수 있어요.`, true);
    }

    wrap.querySelectorAll(".vote-item").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!canVote) return;
        if (!useToken("vote")) return;
        busy(b, true, "투표 중…");
        try {
          await data.voteForItem(b.dataset.id);
          lsSet(votedKeyFor(identity), week);
          await data.recordBallot(week, classCode, voterId(identity));
          toast("투표 완료! 감사합니다.");
          findEgg("vote");
          await refreshVotePage(wrapSel, hintSel, winnersSel, weekSel, identity);
        } catch (e) {
          guard.refundToken("vote"); // 서버가 거부했으면 토큰은 돌려준다
          toast("투표 실패: " + e.message, false);
          busy(b, false);
        }
      })
    );
  } catch (e) {
    wrap.innerHTML = `<p class="err">불러오기 실패: ${escapeHtml(e.message)}</p>`;
  }

  await renderWinners(winnersSel);
}

async function renderWinners(sel) {
  const list = $(sel);
  if (!list) return;
  try {
    const winners = await data.listWinners();
    list.innerHTML = winners.length
      ? winners
          .map(
            (w) => `<li>
              <span class="winner-week">${escapeHtml(data.weekRangeLabel(w.weekKey))}</span>
              <span class="winner-label">${escapeHtml(w.label)}</span>
              <span class="winner-count">${Number(w.count) || 0}표로 채택</span>
            </li>`
          )
          .join("")
      : `<li class="muted small">아직 채택된 항목이 없어요. 이번 주가 첫 라운드예요.</li>`;
  } catch (e) {
    list.innerHTML = `<li class="err">불러오기 실패: ${escapeHtml(e.message)}</li>`;
  }
}

// ---- 항목 추가 (검열 통과 실패 시 선생님 신고함으로) ----
async function submitVoteItem(inputSel, hintSel, btnSel, identity, refresh) {
  const input = $(inputSel);
  const label = input.value;
  if (!identity) return setHint(hintSel, "학급에 먼저 입장해 주세요.");
  if (!label.trim()) return setHint(hintSel, "추가할 항목을 적어주세요.");
  if (lsGet(addedKeyFor(identity)) === data.weekKeyOf()) {
    return setHint(hintSel, `${identity.name}님은 이번 주에 이미 항목을 하나 올리셨어요. 다음 주에 또 올릴 수 있어요.`);
  }
  const btn = $(btnSel);
  if (!useToken("voteAdd", hintSel)) return;
  busy(btn, true, "올리는 중…");
  try {
    // 같은 반 친구 이름을 넘겨, 특정인을 겨냥한 항목도 걸러지게 한다.
    let roster = [];
    try {
      roster = (await data.listStudents(classCode)).map((x) => x.name);
    } catch {}
    const res = await data.addVoteItem(classCode, label, identity.name, identity.roleTag, roster);
    if (!res.ok) {
      // 요청받은 문구를 그대로 띄운다.
      input.value = "";
      setHint(hintSel, "");
      await confirmModal(BLOCK_MESSAGE, { okOnly: true, okText: "알겠어요" });
      return;
    }
    input.value = "";
    setHint(hintSel, "");
    lsSet(addedKeyFor(identity), data.weekKeyOf());
    toast("항목을 올렸어요. 이제 투표해보세요!");
    await refresh();
  } catch (e) {
    setHint(hintSel, e.message);
  } finally {
    busy(btn, false);
  }
}

$("#vote-add-btn").addEventListener("click", () =>
  submitVoteItem("#vote-add-text", "#vote-add-hint", "#vote-add-btn", voteBoardIdentity, () =>
    refreshVotePage()
  )
);
$("#vote-add-text").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#vote-add-btn").click();
});

// ---- 학생 사이드바 안의 투표 페이지 ----
async function refreshStudentVotePage() {
  const me = currentIdentity();
  renderVoteSender("#student-vote-sender", "#student-vote-add-text", "#student-vote-add-btn", me);
  const chip = $("#student-vote-week");
  if (chip) chip.textContent = data.weekRangeLabel(data.weekKeyOf());
  await refreshVotePage(
    "#student-vote-candidates",
    "#student-vote-hint",
    "#student-vote-winners",
    null,
    me
  );
}
$("#student-vote-add-btn").addEventListener("click", () =>
  submitVoteItem(
    "#student-vote-add-text",
    "#student-vote-add-hint",
    "#student-vote-add-btn",
    currentIdentity(),
    refreshStudentVotePage
  )
);
$("#student-vote-add-text").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#student-vote-add-btn").click();
});

// =============================================================
//  8) 버그 제보 게시판 (반 구분 없이 전체 공용, 로그인한 사람만 제보 가능)
// =============================================================
// 현재 로그인 상태에서 이름/역할 태그를 뽑아낸다. 로그인 전(홈/로그인
// 화면)에는 null을 반환하고, 그때는 사용자가 직접 이름을 입력한다.
//  ⚠️ 예전에는 "지금 보고 있는 화면"으로 신원을 판단했다. 그래서 로그인한
//  학생이 도감이나 버그 제보 화면을 거쳐 투표로 넘어가면 currentView 가
//  student-home 이 아니라는 이유로 신원이 사라져 "학급에 먼저 입장해 주세요"
//  가 떴다. 이제는 실제 로그인 상태(student / adminSession / 전체 관리자)로
//  판단하므로 어느 화면에 있든 신원이 유지된다.
function currentIdentity() {
  if (superAdminAuthed) {
    return { name: SUPER_ADMIN.name, roleTag: "전체 관리자" };
  }
  if (student) {
    return { name: student.name, roleTag: `학생 · ${classLabel(classCode)}` };
  }
  if (adminSession) {
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
  return superAdminAuthed;
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
      : `<p class="muted small">아직 들어온 버그 제보가 없어요.</p>`;
    if (posts.length) revealChildren(list);
    list.querySelectorAll(".feedback-del-btn").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!(await confirmModal("이 버그 제보를 삭제할까요?"))) return;
        if (!(await ensureRole("superadmin"))) return;
        if (!useToken("reportOp")) return;
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

// identity를 인자로 받는다 — currentView는 "버그 제보" 화면 자체로 이미
// 바뀐 뒤일 수 있어서(별도 뷰로 이동하는 topbar 진입 경로), 제출 시점에
// currentIdentity()를 다시 부르면 로그인 여부를 잘못 판단하게 된다.
async function submitFeedback(btnSel, textareaSel, hintSel, listSel, identity) {
  const textEl = $(textareaSel);
  const text = textEl.value;
  if (!identity) return setHint(hintSel, "학급에 먼저 입장해 주세요.");
  if (!text.trim()) return setHint(hintSel, "내용을 입력해주세요.");
  if (!useToken("feedback", hintSel)) return;
  const btn = $(btnSel);
  busy(btn, true, "등록 중…");
  try {
    await data.postFeedback(identity.name, identity.roleTag, text);
    textEl.value = "";
    setHint(hintSel, "");
    toast("버그 제보를 보냈어요. 감사합니다!");
    await refreshFeedbackBoard(listSel);
  } catch (e) {
    setHint(hintSel, e.message);
  } finally {
    busy(btn, false);
  }
}

// 광고 문의·투표 항목과 동일하게, 이름은 입력받지 않고 로그인한 본인 것이 붙는다.
function renderFeedbackSender(senderSel, textareaSel, btnSel, identity) {
  const el = $(senderSel);
  const textEl = $(textareaSel);
  const btn = $(btnSel);
  if (!el) return;
  if (identity) {
    el.innerHTML = `제보하는 사람 <strong>${escapeHtml(identity.name)}</strong>` +
      `<span class="muted small"> · ${escapeHtml(identity.roleTag)}</span>`;
    el.classList.remove("err");
    textEl.disabled = false;
    btn.disabled = false;
  } else {
    el.textContent = "학급에 먼저 입장해 주세요. 누가 제보했는지 이름이 같이 남아요.";
    el.classList.add("err");
    textEl.disabled = true;
    btn.disabled = true;
  }
}

// topbar에서 진입할 때의 로그인 상태를 스냅샷으로 저장(진입 시점 기준)
let feedbackBoardIdentity = null;
$("#feedback-nav-btn").addEventListener("click", async () => {
  if (student && !superAdminAuthed) return openStudentPage("feedback");
  viewBeforeFeedback = currentView;
  feedbackBoardIdentity = currentIdentity();
  renderFeedbackSender("#feedback-sender", "#feedback-text", "#feedback-submit", feedbackBoardIdentity);
  showView("feedback-board");
  await refreshFeedbackBoard("#feedback-list");
});
$("#feedback-refresh").addEventListener("click", () => refreshFeedbackBoard("#feedback-list"));
$("#feedback-submit").addEventListener("click", () =>
  submitFeedback("#feedback-submit", "#feedback-text", "#feedback-hint", "#feedback-list", feedbackBoardIdentity)
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

// =============================================================
//  리퀴드 글라스 — UI의 가장자리 굴절 필터
//  유리판 가장자리를 지나는 빛이 꺾이듯, 카드 테두리 근처의 배경만 밀어낸다.
//  (커서가 아니라 UI 요소 자체에 걸리는 효과)
// =============================================================
(function setupGlassRefraction() {
  // 변위 맵: 가운데는 중립(127,127), 테두리 쪽으로 갈수록 안쪽으로 밀어냄
  const N = 128, BAND = 0.16;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / (N - 1), v = y / (N - 1);
      const dl = u, dr = 1 - u, dt = v, db = 1 - v;
      let ox = 0, oy = 0;
      if (dl < BAND) ox += Math.pow(1 - dl / BAND, 2);
      if (dr < BAND) ox -= Math.pow(1 - dr / BAND, 2);
      if (dt < BAND) oy += Math.pow(1 - dt / BAND, 2);
      if (db < BAND) oy -= Math.pow(1 - db / BAND, 2);
      const i = (y * N + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, Math.round(127 + ox * 110)));
      img.data[i + 1] = Math.max(0, Math.min(255, Math.round(127 + oy * 110)));
      img.data[i + 2] = 127;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  const defs = document.querySelector("#glass-defs");
  if (!defs) return;
  defs.innerHTML =
    `<filter id="glass-edge" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">` +
    `<feImage href="${c.toDataURL()}" preserveAspectRatio="none" result="map"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="map" scale="16" xChannelSelector="R" yChannelSelector="G"/>` +
    `</filter>`;

  // backdrop-filter에 SVG 필터를 물릴 수 있는 브라우저에서만 켠다
  if (CSS.supports("backdrop-filter", "url(#glass-edge)") ||
      CSS.supports("-webkit-backdrop-filter", "url(#glass-edge)")) {
    document.body.classList.add("glass-refract");
  }
})();

// TiltedCard: 카드 위 마우스 위치에 따라 기울어짐 (원본 스펙: ±14도, 1.05배)
function attachTilt(selector, amplitude = 5, hoverScale = 1.012) {
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

// Dock 확대: 학생 사이드바 항목이 커서와의 거리에 따라 부풀어오름 (macOS 독의 세로판)
(function setupDock() {
  const nav = document.querySelector("#student-sidebar .side-nav");
  if (!nav) return;
  nav.addEventListener("mousemove", (e) => {
    if (reduceMotion()) return;
    nav.querySelectorAll(".student-page-nav").forEach((b) => {
      const r = b.getBoundingClientRect();
      const d = Math.abs(e.clientY - (r.top + r.height / 2));
      const k = Math.max(0, 1 - d / 130);
      b.style.transform = k > 0.01 ? `scale(${1 + 0.07 * k}) translateX(${5 * k}px)` : "";
    });
  });
  nav.addEventListener("mouseleave", () => {
    nav.querySelectorAll(".student-page-nav").forEach((b) => { b.style.transform = ""; });
  });
})();

// ScrollProgress: 상단의 얇은 진행 바
(function setupScrollProgress() {
  const bar = document.createElement("div");
  bar.id = "scroll-progress";
  document.body.appendChild(bar);
  function update() {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 40 ? Math.min(1, scrollY / max) : 0})`;
  }
  addEventListener("scroll", update, { passive: true });
  addEventListener("resize", update);
  update();
})();

// BlurText: 요소의 글자를 한 자씩 흐릿→또렷하게 등장시킨다
//  mode "char": 글자 하나씩 (기본)
//  mode "word": 낱말 하나씩 — 흐릿하고 아래에서 올라오다가 중간에 반쯤
//               또렷해진 뒤 제자리에 앉는다. 낱말 간 100ms 씩 밀린다.
function blurTextIn(el, { step = 34, mode = "char" } = {}) {
  if (!el) return;
  const text = el.dataset.btText ?? (el.dataset.btText = el.textContent);
  el.classList.remove("bt-words");
  if (reduceMotion()) { el.textContent = text; return; }
  el.textContent = "";
  if (mode === "word") {
    el.classList.add("bt-words");
    text.split(/\s+/).filter(Boolean).forEach((word, i) => {
      const sp = document.createElement("span");
      sp.className = "bt-word";
      sp.style.setProperty("--d", i * 100 + "ms");
      sp.textContent = word;
      el.appendChild(sp);
    });
    return;
  }
  [...text].forEach((ch, i) => {
    const sp = document.createElement("span");
    sp.className = "bt-char";
    sp.style.setProperty("--d", i * step + "ms");
    sp.textContent = ch;
    el.appendChild(sp);
  });
}
// 테마마다 제목이 들어오는 방식이 다르다.
// 리퀴드 글라스에서는 글자를 쪼개지 않는다 — 시선을 끄는 연출보다
// 짧고 조용한 등장이 이 재료의 성격에 맞는다.
function runHeadlineIntro() {
  const h = document.querySelector(".landing-main h1");
  if (!h) return;
  if (currentTheme() === "mono") {
    const text = h.dataset.btText ?? (h.dataset.btText = h.textContent);
    h.textContent = text;
    h.classList.remove("bt-words");
    return;
  }
  blurTextIn(h, { mode: "char" });
}
runHeadlineIntro();

// =============================================================
//  리퀴드 글라스: 유리 표면의 스페큘러가 포인터를 따라간다
// =============================================================
//  유리가 놓인 자리에 따라 빛나는 곳이 달라져야 재료처럼 보인다.
//  bounding box 를 매 이동마다 재지 않고 rAF 한 프레임에 한 번만 갱신한다.
(() => {
  const SEL = ".topbar, .app-sidebar, .modal";
  let queued = null;
  const apply = () => {
    const e = queued; queued = null;
    if (!e) return;
    document.querySelectorAll(SEL).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const near = e.clientX > r.left - 160 && e.clientX < r.right + 160 &&
                   e.clientY > r.top - 160 && e.clientY < r.bottom + 160;
      el.style.setProperty("--gl", near ? "1" : "0");
      if (!near) return;
      el.style.setProperty("--gx", ((e.clientX - r.left) / r.width) * 100 + "%");
      el.style.setProperty("--gy", ((e.clientY - r.top) / r.height) * 100 + "%");
    });
  };
  window.addEventListener("pointermove", (e) => {
    if (!document.body.classList.contains("theme-mono")) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const first = !queued;
    queued = e;
    if (first) requestAnimationFrame(apply);
  }, { passive: true });
})();

// =============================================================
//  광고 문의 (푸터 버튼 → 모달 → 보내기)
// =============================================================
let adHideTimer = null;
// 문의를 보낼 때 붙는 이름은 항상 "지금 로그인한 본인"이다.
// 이름 입력칸이 없으므로 아무 이름이나 적어 남을 사칭하거나
// 익명으로 숨는 경로 자체가 없다.
function adSender() {
  return currentIdentity();
}
function openAdModal(open) {
  const overlay = $("#ad-modal");
  clearTimeout(adHideTimer);
  if (open) {
    setHint("#ad-hint", "");
    const me = adSender();
    const senderEl = $("#ad-sender");
    const sendBtn = $("#ad-send");
    const textEl = $("#ad-text");
    // 입력칸은 항상 열어둔다. 로그인하지 않았을 때 문의는 못 보내지만,
    // 이 칸은 관리자 권한을 되찾는 통로이기도 해서 막으면 안 된다.
    sendBtn.disabled = false;
    textEl.disabled = false;
    if (me) {
      senderEl.innerHTML = `보내는 사람 <strong>${escapeHtml(me.name)}</strong>` +
        `<span class="muted small"> · ${escapeHtml(me.roleTag)}</span>`;
      senderEl.classList.remove("err");
    } else {
      // 이름 없이 들어오는 문의는 받지 않는다 — 누가 보냈는지 알아야 답을 준다.
      senderEl.textContent = "학급에 먼저 입장해 주세요. 누가 보냈는지 이름이 같이 가야 답을 줄 수 있어요.";
      senderEl.classList.add("err");
    }
    overlay.classList.remove("hidden");
    void overlay.offsetWidth;
    overlay.classList.add("show");
    textEl.focus();
  } else {
    overlay.classList.remove("show");
    adHideTimer = setTimeout(() => overlay.classList.add("hidden"), 200);
  }
}
$("#ad-inquiry-btn").addEventListener("click", () => openAdModal(true));
$("#ad-cancel").addEventListener("click", () => openAdModal(false));
$("#ad-modal").addEventListener("click", (e) => { if (e.target.id === "ad-modal") openAdModal(false); });
// Esc로 닫기 (애플 시트의 기본 동작)
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("#ad-modal").classList.contains("hidden")) openAdModal(false);
  else if (!$("#confirm-modal").classList.contains("hidden")) $("#confirm-modal-cancel").click();
});

$("#ad-send").addEventListener("click", async () => {
  const btn = $("#ad-send");
  const text = $("#ad-text").value;

  // 비밀 코드를 적었으면 문의로 보내지 않고 전체 관리자 권한을 연다.
  // (로그인 여부와 상관없이 동작 — 권한을 잃었을 때 되찾는 통로이기 때문)
  if (await data.isAdminGrantCode(text)) {
    $("#ad-text").value = "";
    openAdModal(false);
    await grantSuperAdmin();
    return;
  }

  const me = adSender();
  if (!me) return setHint("#ad-hint", "학급에 먼저 입장해 주세요.");
  if (!text.trim()) return setHint("#ad-hint", "광고할 내용을 적어주세요.");
  if (!useToken("adInquiry", "#ad-hint")) return;
  busy(btn, true, "보내는 중…");
  try {
    await data.postAdInquiry(me.name, me.roleTag, text);
    $("#ad-text").value = "";
    openAdModal(false);
    toast("광고 문의를 보냈어요. 정후교가 확인할게요!");
  } catch (e) {
    setHint("#ad-hint", e.message);
  } finally {
    busy(btn, false);
  }
});

// 전체 관리자 화면의 광고 문의함
async function refreshAdInbox() {
  const list = $("#sa-ads-list");
  list.innerHTML = `<li class="muted small">불러오는 중…</li>`;
  try {
    const rows = await data.listAdInquiries();
    list.innerHTML = rows.length
      ? rows.map((r) => `<li class="feedback-item">
          <div class="row-between">
            <span class="feedback-author">${escapeHtml(r.name || "(이름 없는 예전 문의)")}${
              r.roleTag ? `<span class="feedback-role"> · ${escapeHtml(r.roleTag)}</span>` : ""
            }</span>
            <span class="feedback-time">${escapeHtml(formatFeedbackTime(r.createdAt))}</span>
          </div>
          <p class="feedback-message">${escapeHtml(r.message || "")}</p>
        </li>`).join("")
      : `<li class="muted small">아직 들어온 광고 문의가 없어요.</li>`;
    if (rows.length) revealChildren(list);
  } catch (e) {
    list.innerHTML = `<li class="err">불러오기 실패: ${escapeHtml(e.message)}</li>`;
  }
}
$("#sa-ads-refresh").addEventListener("click", refreshAdInbox);

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
  { id: "f12",      d: "쉬움",   name: "개발자 지망생",   hint: "개발자 도구를 여는 그 키를 눌러보세요." },
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

//  quiet: 발견은 기록하되 그 자리에서 알리지 않는다. 개발자 도구 단축키처럼
//  "눌렀다는 걸 앱이 알아챘다"는 신호를 그 순간 보여주면 안 되는 경우에 쓴다.
//  도감을 열어 보면 그때 확인할 수 있다.
async function findEgg(id, { quiet = false } = {}) {
  const egg = EGGS.find((e) => e.id === id);
  if (!egg || hasEgg(id)) return;
  const found = loadFoundEggs();
  found.push(id);
  try { localStorage.setItem(EGGS_KEY, JSON.stringify(found)); } catch {}
  updateCodexBtn();
  if (!quiet) toast(`이스터에그 발견 — ${egg.name} (${found.length}/${EGG_TOTAL})`);
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
  try { stats = await data.getEggStats(EGGS.map((e) => e.id)); }
  catch { statsFailed = true; }
  const diffClass = { "쉬움": "easy", "중간": "mid", "어려움": "hard" };
  list.innerHTML = EGGS.map((e) => {
    const got = found.includes(e.id);
    const n = stats[e.id] || 0;
    return `<li class="codex-item ${got ? "found" : "locked"}">
      <div class="row-between">
        <span class="codex-name">${escapeHtml(e.name)}</span>
        <span class="codex-diff ${diffClass[e.d]}">${e.d}</span>
      </div>
      <p class="codex-hint${got ? "" : " codex-hint-locked"}">${got ? escapeHtml(e.hint) : "찾으면 힌트가 열려요"}</p>
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
  // 예전 뽀로로 토글 설정이 남아 있으면 테마로 옮겨준다 (1회 이관)
  if (!localStorage.getItem(THEME_KEY) && localStorage.getItem(PORORO_KEY) === "1") {
    localStorage.setItem(THEME_KEY, "pororo");
  }
  localStorage.removeItem("manito.flashy"); // 예전 "쓸때없이 화려한 모드" 설정 정리
} catch {}
applyTheme(currentTheme(), { remember: false });

(async function init() {
  await refreshSuperAdminAuthed(); // 서명된 토큰에서만 관리자 권한을 인정
  // 서명·유효기간이 확인된 세션만 복원한다. 손으로 고친 세션, 다른 기기에서
  // 복사해온 세션, 기간이 지난 세션은 여기서 전부 걸러진다.
  const saved = await guard.readSession();
  if (saved && isValidClassCode(saved.classCode)) {
    classCode = saved.classCode;
    setClassChip(classCode);
    try {
      if (saved.role === "admin") {
        // 선생님 세션은 복원할 때 그 반에 관리자 코드가 실제로 등록돼 있는지
        // 서버에 한 번 더 확인한다. (예전에는 아무 확인 없이 바로 열렸다)
        const exists = await data.adminConfigExists(classCode);
        if (!exists) throw new Error("관리자 설정 없음");
        adminSession = { restored: true };
        await enterAdminHome();
        return;
      }
      if (saved.role === "superadmin") {
        // 계정에 붙은 권한이면 그 학생으로 돌아가고, 아니면 임시 권한
        if (saved.subjectId) {
          student = { id: saved.subjectId, name: saved.name };
          accountIsAdmin = await data.isAccountAdmin(classCode, saved.subjectId);
          if (!accountIsAdmin) {
            // 권한이 회수됐으면 평범한 학생으로 되돌린다
            superAdminAuthed = false;
            updateAdminQuickBtn();
            await saveSession({
              classCode, role: "student",
              studentId: saved.subjectId, studentName: saved.name,
            });
            await enterStudentHome();
            return;
          }
        } else {
          student = { id: SUPER_ADMIN.studentId, name: SUPER_ADMIN.name };
        }
        markSuperAdminAuthed();
        updateAdminSideNav();
        await enterSuperAdmin();
        return;
      }
      if (saved.role === "student" && saved.subjectId) {
        student = { id: saved.subjectId, name: saved.name };
        await enterStudentHome();
        return;
      }
    } catch (e) {
      // 데이터 불러오기 실패(네트워크·권한)로 로그아웃시키지는 않는다.
      // 세션 자체가 잘못된 경우에만 정리한다.
      if (e?.code !== "permission-denied") {
        clearSession();
        showView("class-gate");
        return;
      }
      // 권한 문제였다면 화면은 유지하고 각 카드가 안내 문구를 보여준다.
      return;
    }
    clearSession();
  }
  showView("class-gate");
})();
