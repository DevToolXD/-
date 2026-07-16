// =============================================================
//  UI / 라우팅 글루 코드
// =============================================================
import * as data from "./data.js";

// ---------- 작은 헬퍼 ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function showView(name) {
  $$('[data-view]').forEach((v) => v.classList.add("hidden"));
  $(`[data-view="${name}"]`).classList.remove("hidden");
  $("#btn-home").classList.toggle("hidden", name === "home");
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(msg, ok = true) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast " + (ok ? "ok" : "err");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 3200);
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

// ---------- 세션 상태 ----------
let student = null; // { id, name, sendChannel, readChannel }
let adminCode = null; // 관리자 코드(메모리에만 보관, 저장 안 함)

// =============================================================
//  홈 / 라우팅
// =============================================================
$("#btn-home").addEventListener("click", () => {
  student = null;
  adminCode = null;
  showView("home");
});

$$(".role-btn").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.dataset.role === "student") openStudentLogin();
    else openAdminLogin();
  })
);

// =============================================================
//  학생
// =============================================================
async function openStudentLogin() {
  showView("student-login");
  setHint("#student-login-hint", "");
  $("#student-pw").value = "";
  const sel = $("#student-name");
  sel.innerHTML = "<option>불러오는 중…</option>";
  try {
    const students = await data.listStudents();
    if (students.length === 0) {
      sel.innerHTML = "<option value=''>아직 명단이 없어요</option>";
      setHint("#student-login-hint", "선생님이 먼저 명단을 등록해야 해요.");
      return;
    }
    sel.innerHTML = students
      .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
      .join("");
  } catch (e) {
    sel.innerHTML = "<option value=''>불러오기 실패</option>";
    setHint("#student-login-hint", "명단을 불러오지 못했습니다: " + e.message);
  }
}

$("#student-login-btn").addEventListener("click", async () => {
  const sel = $("#student-name");
  const id = sel.value;
  const name = sel.options[sel.selectedIndex]?.textContent || "";
  const pw = $("#student-pw").value;
  if (!id) return setHint("#student-login-hint", "이름을 선택해주세요.");
  if (!pw) return setHint("#student-login-hint", "비밀번호를 입력해주세요.");
  const btn = $("#student-login-btn");
  busy(btn, true, "로그인 중…");
  try {
    let res = await data.verifyStudentPassword(id, pw);
    if (res === "needSetup") {
      // 첫 로그인 → 이 비밀번호로 설정
      await data.setStudentPassword(id, pw);
      res = "ok";
      toast("비밀번호가 설정되었어요. 다음부터 이 비밀번호로 로그인하세요.");
    }
    if (res !== "ok") {
      setHint("#student-login-hint", "비밀번호가 올바르지 않습니다.");
      return;
    }
    const sec = await data.getSecret(id);
    student = {
      id,
      name,
      sendChannel: sec.sendChannel || null,
      readChannel: sec.readChannel || null,
    };
    enterStudentHome();
  } catch (e) {
    setHint("#student-login-hint", "오류: " + e.message);
  } finally {
    busy(btn, false);
  }
});

async function enterStudentHome() {
  showView("student-home");
  $("#student-greeting").textContent = student.name;
  const assigned = student.sendChannel || student.readChannel;
  $("#wish-send-btn").disabled = !student.sendChannel;
  if (!assigned) {
    setHint("#wish-hint", "아직 마니또 배정 전이에요. 배정 후 이용할 수 있어요.");
  } else {
    setHint("#wish-hint", "");
  }
  await Promise.all([refreshInbox(), refreshSent()]);
}

$("#wish-send-btn").addEventListener("click", async () => {
  const text = $("#wish-text").value;
  const btn = $("#wish-send-btn");
  busy(btn, true, "보내는 중…");
  try {
    await data.sendWish(student.sendChannel, text);
    $("#wish-text").value = "";
    setHint("#wish-hint", "소원을 익명으로 보냈어요! 💌", true);
    toast("소원을 보냈어요!");
    refreshSent();
  } catch (e) {
    setHint("#wish-hint", e.message);
  } finally {
    busy(btn, false);
  }
});

$("#inbox-refresh").addEventListener("click", refreshInbox);

async function refreshInbox() {
  const ul = $("#inbox-list");
  ul.innerHTML = "<li class='muted small'>불러오는 중…</li>";
  try {
    const msgs = await data.getInbox(student.readChannel);
    renderMessages(ul, msgs, "아직 받은 소원이 없어요.");
  } catch (e) {
    ul.innerHTML = `<li class='err'>불러오기 실패: ${escapeHtml(e.message)}</li>`;
  }
}

async function refreshSent() {
  const ul = $("#sent-list");
  ul.innerHTML = "<li class='muted small'>불러오는 중…</li>";
  try {
    const msgs = await data.getSent(student.sendChannel);
    renderMessages(ul, msgs, "아직 보낸 소원이 없어요.");
  } catch (e) {
    ul.innerHTML = `<li class='err'>불러오기 실패: ${escapeHtml(e.message)}</li>`;
  }
}

function renderMessages(ul, msgs, emptyText) {
  if (!msgs.length) {
    ul.innerHTML = `<li class='muted small'>${emptyText}</li>`;
    return;
  }
  ul.innerHTML = msgs
    .map(
      (m) =>
        `<li><span class="msg-text">${escapeHtml(m.text)}</span>` +
        `<span class="msg-time">${fmtTime(m.createdAt)}</span></li>`
    )
    .join("");
}

// =============================================================
//  관리자
// =============================================================
async function openAdminLogin() {
  showView("admin-login");
  $("#admin-code").value = "";
  setHint("#admin-login-hint", "");
  try {
    const exists = await data.adminConfigExists();
    $("#admin-setup-note").textContent = exists
      ? "관리자 코드를 입력하세요."
      : "최초 실행입니다. 지금 입력하는 코드가 관리자 코드로 등록됩니다. (기억해두세요!)";
  } catch (e) {
    $("#admin-setup-note").textContent = "";
  }
}

$("#admin-login-btn").addEventListener("click", async () => {
  const code = $("#admin-code").value;
  if (!code) return setHint("#admin-login-hint", "코드를 입력해주세요.");
  const btn = $("#admin-login-btn");
  busy(btn, true, "확인 중…");
  try {
    const exists = await data.adminConfigExists();
    if (!exists) {
      await data.setupAdmin(code);
      toast("관리자 코드가 등록되었습니다.");
    } else {
      const ok = await data.verifyAdmin(code);
      if (!ok) {
        setHint("#admin-login-hint", "관리자 코드가 올바르지 않습니다.");
        return;
      }
    }
    adminCode = code;
    enterAdminHome();
  } catch (e) {
    setHint("#admin-login-hint", "오류: " + e.message);
  } finally {
    busy(btn, false);
  }
});

async function enterAdminHome() {
  showView("admin-home");
  await refreshRoster();
}

async function refreshRoster() {
  const ul = $("#roster-list");
  ul.innerHTML = "";
  try {
    const students = await data.listStudents();
    const assigned = await data.isAssigned();
    $("#admin-status").textContent =
      `학생 ${students.length}명 등록됨 · ` +
      (assigned ? "마니또 배정 완료 ✅" : "아직 배정 전");
    ul.innerHTML = students
      .map((s) => `<li class="chip">${escapeHtml(s.name)}</li>`)
      .join("");
  } catch (e) {
    $("#admin-status").textContent = "상태 불러오기 실패: " + e.message;
  }
}

$("#roster-add-btn").addEventListener("click", async () => {
  const names = $("#roster").value.split("\n");
  const btn = $("#roster-add-btn");
  busy(btn, true, "추가 중…");
  try {
    const n = await data.addStudents(names);
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
    const n = await data.assignManito(adminCode);
    setHint("#assign-hint", `${n}명 마니또 배정 완료! 🎉`, true);
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
  if (!confirm("재배정하면 기존 배정과 주고받은 소원이 초기화됩니다. 진행할까요?"))
    return;
  await doAssign(e.currentTarget);
});

$("#reveal-btn").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  busy(btn, true, "복호화 중…");
  setHint("#reveal-hint", "");
  try {
    const result = await data.revealMapping(adminCode);
    if (!result) {
      setHint("#reveal-hint", "아직 배정된 마니또가 없습니다.");
      return;
    }
    const tbody = $("#reveal-table tbody");
    tbody.innerHTML = result.pairs
      .map(
        (p) =>
          `<tr><td>${escapeHtml(p.guardianName)}</td><td>→</td>` +
          `<td>${escapeHtml(p.protegeName)}</td></tr>`
      )
      .join("");
    $("#reveal-wrap").classList.remove("hidden");
    setHint(
      "#reveal-hint",
      `배정 시각: ${new Date(result.assignedAt).toLocaleString("ko-KR")}`,
      true
    );
  } catch (e2) {
    setHint("#reveal-hint", "복호화 실패 (코드 불일치일 수 있음): " + e2.message);
  } finally {
    busy(btn, false);
  }
});

// =============================================================
//  유틸
// =============================================================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function fmtTime(d) {
  if (!d) return "";
  return d.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// 시작
showView("home");
