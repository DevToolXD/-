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

function showView(name) {
  currentView = name;
  $$("[data-view]").forEach((v) => v.classList.add("hidden"));
  $(`[data-view="${name}"]`).classList.remove("hidden");
  const backBtn = $("#btn-back");
  backBtn.classList.toggle("hidden", name === "class-gate");
  backBtn.textContent = LOGGED_IN_VIEWS.includes(name) ? "로그아웃" : "뒤로";
  window.scrollTo({ top: 0, behavior: "smooth" });
  updateSpecialMode();
}

$("#btn-back").addEventListener("click", async () => {
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

// 로그아웃: 이중 확인 후 세션만 지우고 학급코드는 유지 (같은 기기에서 다음 학생이 이어서 로그인)
async function logout() {
  if (!(await confirmModal("정말 로그아웃 하시겠어요?"))) return;
  if (!(await confirmModal("한 번 더 확인할게요. 정말 나가시겠어요? 다시 로그인해야 해요."))) return;
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
}

// =============================================================
//  화려함 모드 (쓸데없이 화려한 옵트인 이펙트, 버튼으로 온/오프)
// =============================================================
const FLASHY_KEY = "manito.flashy";

function setFlashy(on) {
  document.body.classList.toggle("flashy", on);
  const btn = $("#flashy-toggle");
  btn.setAttribute("aria-pressed", String(on));
  btn.textContent = on ? "화려함 모드 ON" : "화려함 모드";
  try { localStorage.setItem(FLASHY_KEY, on ? "1" : "0"); } catch {}
}

$("#flashy-toggle").addEventListener("click", () => {
  setFlashy(!document.body.classList.contains("flashy"));
});

const BURST_COLORS = ["#2e9e5b", "#ffd166", "#ef476f", "#06d6a0", "#4dabf7", "#cc5de8"];
function spawnBurst(x, y) {
  for (let i = 0; i < 10; i++) {
    const s = document.createElement("span");
    s.className = "burst-particle";
    s.style.left = x + "px";
    s.style.top = y + "px";
    s.style.background = BURST_COLORS[i % BURST_COLORS.length];
    document.body.appendChild(s);
    const angle = (Math.PI * 2 * i) / 10 + Math.random() * 0.4;
    const dist = 40 + Math.random() * 60;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const anim = s.animate(
      [
        { transform: "translate(0,0) scale(1)", opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(0)`, opacity: 0 },
      ],
      { duration: 500 + Math.random() * 300, easing: "cubic-bezier(.2,.8,.2,1)" }
    );
    anim.onfinish = () => s.remove();
  }
}
document.addEventListener("click", (e) => {
  if (!document.body.classList.contains("flashy")) return;
  spawnBurst(e.clientX, e.clientY);
});

// =============================================================
//  1) 학급코드 입력
// =============================================================
const codeInput = $("#class-code-input");
codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") $("#class-gate-btn").click(); });

$("#class-gate-btn").addEventListener("click", () => {
  const code = codeInput.value.trim();
  if (!isValidClassCode(code)) {
    setHint("#class-gate-hint", "올바른 학급코드가 아니에요. (예: 0603)");
    return;
  }
  classCode = code;
  setClassChip(code);
  setHint("#class-gate-hint", "");
  codeInput.value = "";
  if (code === TEST_CODE) toast("테스트 모드로 진행합니다.");
  showView("home");
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
  await Promise.all([refreshMyWish(), refreshCareTarget()]);
}

async function refreshMyWish() {
  const form = $("#my-wish-form");
  const display = $("#my-wish-display");
  try {
    const sec = await data.getSecret(classCode, student.id);
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
  } catch (e) {
    empty.classList.remove("hidden");
    content.classList.add("hidden");
    empty.textContent = "불러오기 실패: " + e.message;
  }
}
$("#care-refresh").addEventListener("click", refreshCareTarget);

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
  await refreshRoster();
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
    ul.innerHTML = students.map((s) => `<li class="chip">${escapeHtml(s.name)}</li>`).join("");
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
    await refreshRoster();
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

// =============================================================
//  5) 슈퍼 관리자 (전체 학급)
// =============================================================
async function enterSuperAdmin() {
  showView("super-admin");
  $("#sa-detail").classList.add("hidden");
  saCurrentCode = null;
  await refreshOverview();
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
    const rows = await data.superAdminClassDetail(code);
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted small">등록된 학생이 없어요.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map(
        (r) => `<tr data-id="${r.id}">
          <td>${escapeHtml(r.name)}</td>
          <td>${r.caringForName ? escapeHtml(r.caringForName) : "-"}</td>
          <td><textarea rows="2" class="sa-wish-input">${escapeHtml(r.wish || "")}</textarea></td>
          <td><button class="btn btn-ghost btn-sm sa-save-btn">저장</button></td>
        </tr>`
      )
      .join("");
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
