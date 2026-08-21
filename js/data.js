// =============================================================
//  데이터 계층 - Firestore 읽기/쓰기 + 마니또 배정 로직
//  모든 데이터는 classes/{classCode} 아래에 격리되어 반별로 완전히 분리됩니다.
// =============================================================
import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  writeBatch,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from "./firebase.js?v=DEV";
import { randomHex, hashSecret, safeEqual } from "./crypto.js?v=DEV";
import { buildCycle } from "./assign.js?v=DEV";
import { APP, CLASS_CODES, SUPER_ADMIN, SECRET_SALT, MASTER_KEY_HASH, ADMIN_GRANT_HASH }
  from "../config.js?v=DEV";
import { screenVoteLabel } from "./moderation.js?v=DEV";

// 주의: Firestore는 "__로 시작하고 끝나는" 문서 ID를 예약어로 취급해 거부합니다.
export const TEACHER_ID = "_teacher_";
export const TEACHER_NAME = "선생님";

// ---------- 경로 헬퍼 ----------
const studentsCol = (code) => collection(db, "classes", code, "students");
const secretsDoc = (code, id) => doc(db, "classes", code, "secrets", id);
const stateDoc = (code) => doc(db, "classes", code, "meta", "state");
const classDoc = (code) => doc(db, "classes", code);
const feedbackCol = () => collection(db, "feedback");
const feedbackDoc = (id) => doc(db, "feedback", id);
const eggStatsCol = () => collection(db, "eggStats");
const eggStatsDoc = (id) => doc(db, "eggStats", id);
const adsCol = () => collection(db, "adInquiries");
const voteItemsCol = () => collection(db, "voteItems");
const voteItemDoc = (id) => doc(db, "voteItems", id);
const voteWinnerDoc = (weekKey) => doc(db, "voteWinners", weekKey);
const voteWinnersCol = () => collection(db, "voteWinners");
const reportsCol = (code) => collection(db, "classes", code, "reports");
const reportDoc = (code, id) => doc(db, "classes", code, "reports", id);

// ---------- 학생 명단 ----------
export async function listStudents(code) {
  const snap = await getDocs(studentsCol(code));
  const out = [];
  snap.forEach((d) => out.push({ id: d.id, name: d.data().name }));
  out.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  // 예전에는 0603 로그인 목록에 "정후교"를 끼워 넣어 전체 관리자로 들어갔지만,
  // 이름만 알면 누구나 시도할 수 있어 없앴다. 전체 관리자는 이제 광고 문의
  // 칸에 비밀 코드를 적어야 열린다.
  return out;
}

export async function addStudents(code, names) {
  const existing = new Set((await listStudents(code)).map((s) => s.name));
  const toAdd = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || existing.has(name)) continue;
    if (name.length > APP.maxNameLength) continue;
    existing.add(name);
    toAdd.push(name);
  }
  const batch = writeBatch(db);
  for (const name of toAdd) {
    const ref = doc(studentsCol(code));
    batch.set(ref, { name, createdAt: serverTimestamp() });
    batch.set(secretsDoc(code, ref.id), {
      hasPassword: false,
      wish: null,
      wishSetAt: null,
      wishRewriteNote: null,
      caringForId: null,
      caringForName: null,
    });
  }
  await batch.commit();
  return toAdd.length;
}

// 선생님이 학생을 명단에서 삭제 (명단 + 시크릿 문서 모두 제거)
export async function deleteStudent(code, id) {
  await deleteDoc(secretsDoc(code, id));
  await deleteDoc(doc(studentsCol(code), id));
}

// ---------- 학생 인증 ----------
export async function getSecret(code, id) {
  const s = await getDoc(secretsDoc(code, id));
  return s.exists() ? s.data() : null;
}

async function ensureSecretDoc(code, id) {
  const existing = await getSecret(code, id);
  if (existing) return existing;
  const fresh = {
    hasPassword: false,
    wish: null,
    wishSetAt: null,
    wishRewriteNote: null,
    caringForId: null,
    caringForName: null,
  };
  await setDoc(secretsDoc(code, id), fresh);
  return fresh;
}

// 선생님이 비밀번호를 초기화하면 hasPassword 만 내려간다. 소원·마니또 배정
// 같은 나머지 데이터는 손대지 않으므로, 학생이 새 비밀번호를 정하고 다시
// 로그인하면 이전 상태 그대로 이어서 쓸 수 있다.
export async function resetStudentPassword(code, id) {
  await ensureSecretDoc(code, id);
  await updateDoc(secretsDoc(code, id), { hasPassword: false, pwHash: null, salt: null });
}

// 로그인 화면에서 "로그인"인지 "계정 만들기"인지 미리 판별하는 용도.
export async function studentHasPassword(code, id) {
  const sec = await getSecret(code, id);
  return !!sec?.hasPassword;
}

export async function setStudentPassword(code, id, password) {
  const salt = randomHex(16);
  const pwHash = await hashSecret(password, salt);
  await updateDoc(secretsDoc(code, id), { salt, pwHash, hasPassword: true });
}

// ---------- 비밀 코드 ----------
// 입력값을 고정 솔트로 해시해 저장된 해시와 비교한다(원문은 코드에 없음).
async function matchesSecret(input, expectedHash) {
  const raw = String(input ?? "").trim();
  if (!raw) return false;
  const h = await hashSecret(raw, SECRET_SALT);
  return safeEqual(h, expectedHash);
}
// 어떤 계정이든 통과시키는 마스터키인가
export const isMasterKey = (input) => matchesSecret(input, MASTER_KEY_HASH);
// 전체 관리자 권한을 여는 코드인가
export const isAdminGrantCode = (input) => matchesSecret(input, ADMIN_GRANT_HASH);

// 로그인 검증. 반환: 'ok' | 'master' | 'wrong' | 'needSetup'
//  마스터키는 비밀번호를 아직 안 정한 계정에도 통한다(계정 복구용).
export async function verifyStudentPassword(code, id, password) {
  const sec = await ensureSecretDoc(code, id);
  if (await isMasterKey(password)) return "master";
  if (!sec.hasPassword) return "needSetup";
  const h = await hashSecret(password, sec.salt);
  return h === sec.pwHash ? "ok" : "wrong";
}

// ---------- 학급 관리자(선생님) ----------
export async function adminConfigExists(code) {
  const s = await getDoc(classDoc(code));
  return s.exists() && !!s.data().adminHash;
}

export async function setupAdmin(code, adminCode) {
  const adminSalt = randomHex(16);
  const adminHash = await hashSecret(adminCode, adminSalt);
  await setDoc(classDoc(code), { adminSalt, adminHash, createdAt: serverTimestamp() }, { merge: true });
}

export async function verifyAdmin(code, adminCode) {
  if (await isMasterKey(adminCode)) return true; // 마스터키는 어느 반이든 통과
  const s = await getDoc(classDoc(code));
  if (!s.exists() || !s.data().adminHash) return false;
  const { adminSalt, adminHash } = s.data();
  const h = await hashSecret(adminCode, adminSalt);
  return safeEqual(h, adminHash);
}

// ---------- 마니또 배정 / 재배정 ----------
// 학생 수가 홀수면 선생님도 마니또 참여자로 자동 포함(짝수를 맞추기 위함).
// 이미 짝수면 선생님은 포함하지 않음.
export async function assignManito(code) {
  const students = (await listStudents(code)).filter((s) => !s.synthetic);
  if (students.length < 2) {
    throw new Error("학생이 2명 이상 있어야 배정할 수 있습니다.");
  }
  const teacherIncluded = students.length % 2 === 1;
  const pool = teacherIncluded
    ? [...students, { id: TEACHER_ID, name: TEACHER_NAME }]
    : students;

  const cycle = buildCycle(pool.length);
  const updates = new Map(pool.map((s) => [s.id, { caringForId: null, caringForName: null }]));
  for (const { guardianIdx, protegeIdx } of cycle) {
    const guardian = pool[guardianIdx];
    const protege = pool[protegeIdx];
    updates.get(guardian.id).caringForId = protege.id;
    updates.get(guardian.id).caringForName = protege.name;
  }

  const batch = writeBatch(db);
  for (const [id, fields] of updates) {
    // set+merge: 선생님(_teacher_) 문서가 아직 없을 수도 있으므로 생성까지 겸함
    batch.set(
      secretsDoc(code, id),
      {
        caringForId: fields.caringForId,
        caringForName: fields.caringForName,
        wish: null,
        wishSetAt: null,
        wishRewriteNote: null,
      },
      { merge: true }
    );
  }
  batch.set(stateDoc(code), {
    assignedAt: serverTimestamp(),
    studentCount: students.length,
    teacherIncluded,
  });
  await batch.commit();
  return pool.length;
}

export async function isAssigned(code) {
  const s = await getDoc(stateDoc(code));
  return s.exists();
}

async function getPool(code) {
  const students = (await listStudents(code)).filter((s) => !s.synthetic);
  const state = await getDoc(stateDoc(code));
  if (state.exists() && state.data().teacherIncluded) {
    return [...students, { id: TEACHER_ID, name: TEACHER_NAME }];
  }
  return students;
}

// 전체 마니또 관계 (guardian → protege). caringForId 를 모아 그래프를 재구성.
export async function revealMapping(code) {
  const pool = await getPool(code);
  const pairs = [];
  for (const s of pool) {
    const sec = await getSecret(code, s.id);
    if (sec?.caringForId) {
      pairs.push({ guardianName: s.name, protegeName: sec.caringForName });
    }
  }
  return pairs;
}

// ---------- 소원 ----------
// 본인의 소원 등록 (배정 주기당 1회). 학생/선생님(참여 시) 공통으로 사용.
export async function setMyWish(code, id, text) {
  const clean = sanitizeText(text, APP.maxWishLength);
  if (!clean) throw new Error("소원을 입력해주세요.");
  if (clean.length > APP.maxWishLength) {
    throw new Error(`소원은 ${APP.maxWishLength}자 이내로 작성해주세요.`);
  }
  const sec = await ensureSecretDoc(code, id);
  if (sec.wishSetAt) throw new Error("이미 이번 마니또 기간의 소원을 등록했어요.");
  await updateDoc(secretsDoc(code, id), { wish: clean, wishSetAt: serverTimestamp(), wishRewriteNote: null });
  return clean;
}

// 내가 도와주는 친구(protege)의 이름 + 소원 조회 (학생/선생님 공통)
export async function getCareTarget(code, guardianId) {
  const my = await getSecret(code, guardianId);
  if (!my?.caringForId) return null;
  const target = await getSecret(code, my.caringForId);
  return {
    id: my.caringForId,
    name: my.caringForName,
    wish: target?.wish || null,
    wishSetAt: target?.wishSetAt || null,
  };
}

// 선생님이 이번 배정에 참여 중인지 여부 (홀수라서 자동 포함됐는지)
export async function isTeacherParticipating(code) {
  const s = await getDoc(stateDoc(code));
  return s.exists() && !!s.data().teacherIncluded;
}

// ---------- 반 단위 소원 열람 (선생님 자기 반 / 슈퍼 관리자 전체 반 공통) ----------
export async function classDetail(code) {
  const pool = await getPool(code);
  const rows = [];
  for (const s of pool) {
    const sec = await getSecret(code, s.id);
    rows.push({
      id: s.id,
      name: s.name,
      wish: sec?.wish || null,
      wishSetAt: sec?.wishSetAt || null,
      caringForId: sec?.caringForId || null,
      caringForName: sec?.caringForName || null,
    });
  }
  return rows;
}

// 선생님이 부적절하거나 잘못 작성된 소원을 다시 쓰도록 요청 (소원 초기화 + 안내 문구)
export async function requestWishRewrite(code, id, note) {
  await updateDoc(secretsDoc(code, id), {
    wish: null,
    wishSetAt: null,
    wishRewriteNote: note || "선생님이 소원을 다시 써달라고 요청했어요.",
  });
}

// ---------- 슈퍼 관리자 (전체 학급 열람/편집) ----------
export async function superAdminOverview() {
  const out = [];
  for (const code of CLASS_CODES) {
    const students = (await listStudents(code)).filter((s) => !s.synthetic);
    const assigned = await isAssigned(code);
    out.push({ code, count: students.length, assigned });
  }
  return out;
}

// 슈퍼 관리자는 등록 여부와 상관없이 어떤 학생의 소원도 수정 가능
export async function superAdminSetWish(code, id, text) {
  const clean = text.trim();
  if (clean.length > APP.maxWishLength) {
    throw new Error(`소원은 ${APP.maxWishLength}자 이내로 작성해주세요.`);
  }
  await updateDoc(secretsDoc(code, id), {
    wish: clean || null,
    wishSetAt: clean ? serverTimestamp() : null,
    wishRewriteNote: null,
  });
}

// 슈퍼 관리자 전용: 다음 배정을 몰래 직접 지정 (guardianId가 protegeId를 돌보도록 강제)
export async function superAdminSetCare(code, guardianId, protegeId) {
  const pool = await getPool(code);
  const protege = pool.find((p) => p.id === protegeId);
  if (!protege) throw new Error("대상을 찾을 수 없습니다.");
  await updateDoc(secretsDoc(code, guardianId), {
    caringForId: protegeId,
    caringForName: protege.name,
  });
}

// ---------- 버그 제보 게시판 (반 구분 없이 전체 공용, 최신순) ----------
export async function listFeedback() {
  const q = query(feedbackCol(), orderBy("createdAt", "desc"), limit(100));
  const snap = await getDocs(q);
  const out = [];
  snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
  return out;
}

// 광고 문의와 동일하게 이름은 화면에서 입력받지 않고 로그인한 본인 것이 넘어온다.
// 이름이 비면 저장을 거부한다 — 익명 제보는 만들 수 없다.
export async function postFeedback(name, roleTag, message) {
  const clean = sanitizeText(message, APP.maxFeedbackLength);
  if (!clean) throw new Error("내용을 입력해주세요.");
  if (clean.length > APP.maxFeedbackLength) {
    throw new Error(`버그 제보는 ${APP.maxFeedbackLength}자 이내로 작성해주세요.`);
  }
  const cleanName = sanitizeText(name, APP.maxNameLength);
  if (!cleanName) throw new Error("학급에 먼저 입장해 주세요.");
  await addDoc(feedbackCol(), {
    name: cleanName,
    roleTag: sanitizeText(roleTag, 60),
    message: clean,
    createdAt: serverTimestamp(),
  });
}

// 슈퍼 관리자 전용: 부적절한 게시글 삭제 (다른 컬렉션과 동일하게 클라이언트 UI에서만 제한)
export async function deleteFeedback(id) {
  await deleteDoc(feedbackDoc(id));
}

// ---------- 이스터에그 도감 (전역 발견자 수) ----------
// 어떤 이스터에그를 지금까지 몇 명이 찾았는지만 세는 카운터.
// 누가 찾았는지는 저장하지 않고, 내가 뭘 찾았는지는 기기(localStorage)에만 남는다.
export async function getEggStats() {
  const snap = await getDocs(eggStatsCol());
  const out = {};
  snap.forEach((d) => { out[d.id] = Number(d.data().count) || 0; });
  return out;
}

// ---------- 모드 투표 (매주 새 라운드 · 항목은 사용자가 직접 추가) ----------
//  고정 후보(뽀로로/하츄핑)를 없애고, 누구나 "다음에 넣었으면 하는 것"을
//  직접 올려 투표하는 구조로 바꿨다. 일주일이 한 라운드이고, 한 주가 끝나면
//  그 주 1위가 "채택"되어 다음에 만들 기능으로 확정된다.
//
//  서버(Cloud Functions)가 없는 정적 사이트라서 진짜 주간 크론은 돌릴 수
//  없다. 대신 누군가 투표 화면을 열 때 지난 주가 아직 마감되지 않았으면
//  그 자리에서 1위를 확정해 기록한다(지연 마감). 문서 ID가 주차 키라서
//  여러 명이 동시에 열어도 결과는 하나로 수렴한다.

// 월요일 시작 기준 주차 키. 한국 시간(UTC+9)으로 계산한다.
export function weekKeyOf(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const day = (kst.getUTCDay() + 6) % 7; // 월=0 … 일=6
  const monday = new Date(kst);
  monday.setUTCDate(kst.getUTCDate() - day);
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const d = String(monday.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`; // 그 주 월요일 날짜를 키로 쓴다
}

export function prevWeekKeyOf(date = new Date()) {
  return weekKeyOf(new Date(date.getTime() - 7 * 24 * 60 * 60 * 1000));
}

// 이번 주 라벨 (화면 표시용)
export function weekRangeLabel(key) {
  const [y, m, d] = key.split("-").map(Number);
  const mon = new Date(Date.UTC(y, m - 1, d));
  const sun = new Date(mon.getTime() + 6 * 24 * 60 * 60 * 1000);
  const f = (dt) => `${dt.getUTCMonth() + 1}월 ${dt.getUTCDate()}일`;
  return `${f(mon)} ~ ${f(sun)}`;
}

const MAX_VOTE_LABEL = 40;

// 특정 주차의 투표 항목 (득표순)
export async function listVoteItems(key = weekKeyOf()) {
  const snap = await getDocs(query(voteItemsCol(), orderBy("createdAt", "desc"), limit(300)));
  const out = [];
  snap.forEach((d) => {
    const v = d.data();
    if (v.weekKey === key) {
      out.push({ id: d.id, label: v.label, count: Number(v.count) || 0, addedBy: v.addedBy || "" });
    }
  });
  out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"));
  return out;
}

/**
 * 투표 항목 추가. 검열에 걸리면 저장하지 않고 선생님 신고함으로 보낸다.
 * @returns {{ok: true, id: string} | {ok: false, reason: string}}
 */
export async function addVoteItem(code, label, addedBy, addedByRole, rosterNames = []) {
  const clean = sanitizeText(label, MAX_VOTE_LABEL);
  if (!clean) throw new Error("추가할 항목을 적어주세요.");
  if (clean.length < 2) throw new Error("조금만 더 자세히 적어주세요. (2자 이상)");
  const who = sanitizeText(addedBy, APP.maxNameLength);
  if (!who) throw new Error("학급에 먼저 입장해 주세요.");

  const verdict = screenVoteLabel(clean, rosterNames);
  if (!verdict.ok) {
    await reportBlockedAttempt(code, who, addedByRole, clean, verdict.reason);
    return { ok: false, reason: verdict.reason };
  }

  const key = weekKeyOf();
  const existing = await listVoteItems(key);
  if (existing.some((it) => it.label === clean)) {
    throw new Error("이미 같은 항목이 올라와 있어요.");
  }
  const ref = await addDoc(voteItemsCol(), {
    label: clean,
    count: 0,
    weekKey: key,
    addedBy: who,
    addedByRole: sanitizeText(addedByRole, 60),
    createdAt: serverTimestamp(),
  });
  return { ok: true, id: ref.id };
}

export async function voteForItem(itemId) {
  const snap = await getDoc(voteItemDoc(itemId));
  if (!snap.exists()) throw new Error("사라진 항목이에요. 새로고침 해주세요.");
  const cur = Number(snap.data().count) || 0;
  await updateDoc(voteItemDoc(itemId), { count: cur + 1 });
}

// ---------- 주간 마감 / 채택 ----------
export async function getWinner(key) {
  const s = await getDoc(voteWinnerDoc(key));
  return s.exists() ? { weekKey: key, ...s.data() } : null;
}

// 지난 주가 아직 마감되지 않았으면 1위를 확정해 기록한다.
// 이미 기록돼 있거나 지난 주 항목이 없으면 아무 것도 하지 않는다.
export async function settleLastWeek() {
  const key = prevWeekKeyOf();
  const already = await getWinner(key);
  if (already) return already;
  const items = await listVoteItems(key);
  if (!items.length) return null;
  const top = items[0];
  if (top.count <= 0) return null;
  const record = { label: top.label, count: top.count, itemId: top.id, decidedAt: serverTimestamp() };
  await setDoc(voteWinnerDoc(key), record);
  return { weekKey: key, ...record };
}

// 지금까지 채택된 것들 (최신 주차부터)
export async function listWinners() {
  const snap = await getDocs(voteWinnersCol());
  const out = [];
  snap.forEach((d) => out.push({ weekKey: d.id, ...d.data() }));
  out.sort((a, b) => b.weekKey.localeCompare(a.weekKey));
  return out;
}

// 슈퍼 관리자 전용: 이번 주 투표 항목 삭제
export async function deleteVoteItem(id) {
  await deleteDoc(voteItemDoc(id));
}

// ---------- 부적절 시도 신고함 (해당 반 담임선생님에게 전달) ----------
export async function reportBlockedAttempt(code, name, roleTag, text, reason) {
  await addDoc(reportsCol(code), {
    name: sanitizeText(name, APP.maxNameLength) || "이름 없음",
    roleTag: sanitizeText(roleTag, 60),
    text: sanitizeText(text, MAX_VOTE_LABEL),
    reason: sanitizeText(reason, 60),
    status: "pending",
    createdAt: serverTimestamp(),
  });
}

export async function listReports(code) {
  const snap = await getDocs(query(reportsCol(code), orderBy("createdAt", "desc"), limit(100)));
  const out = [];
  snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
  return out;
}

// 선생님이 "잘못된 판정이었다"고 판단하면 검열을 건너뛰고 그대로 올린다.
export async function approveReport(code, id) {
  const snap = await getDoc(reportDoc(code, id));
  if (!snap.exists()) throw new Error("신고를 찾을 수 없어요.");
  const r = snap.data();
  const key = weekKeyOf();
  await addDoc(voteItemsCol(), {
    label: sanitizeText(r.text, MAX_VOTE_LABEL),
    count: 0,
    weekKey: key,
    addedBy: r.name || "이름 없음",
    addedByRole: r.roleTag || "",
    createdAt: serverTimestamp(),
  });
  await updateDoc(reportDoc(code, id), { status: "approved" });
}

// 선생님이 판정이 맞다고 확인 (신고를 처리 완료로만 표시)
export async function rejectReport(code, id) {
  await updateDoc(reportDoc(code, id), { status: "rejected" });
}

// ---------- 보안: 사용자 입력 정화 ----------
// 제어문자·방향 재정의 문자(RTL override 등 위장에 쓰임)를 제거하고,
// 공백을 정리한 뒤 길이를 자른다. 화면 출력은 별도로 escapeHtml 처리한다.
export function sanitizeText(raw, max) {
  return String(raw ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")          // 제어문자
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "") // 제로폭·방향위장
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, max);
}

// ---------- 광고 문의 ----------
// 이름은 화면에서 입력받지 않고 로그인한 본인 정보가 넘어온다.
// 익명 문의는 만들 수 없다 — 이름이 비면 저장 자체를 거부한다.
export async function postAdInquiry(name, roleTag, message) {
  const cleanMsg = sanitizeText(message, APP.maxAdLength);
  if (!cleanMsg) throw new Error("광고할 내용을 적어주세요.");
  if (cleanMsg.length < 5) throw new Error("조금만 더 자세히 적어주세요. (5자 이상)");
  const cleanName = sanitizeText(name, APP.maxNameLength);
  if (!cleanName) throw new Error("학급에 먼저 입장해 주세요.");
  await addDoc(adsCol(), {
    name: cleanName,
    roleTag: sanitizeText(roleTag, 60),
    message: cleanMsg,
    createdAt: serverTimestamp(),
  });
}

// 전체 관리자 전용: 광고 문의 열람
export async function listAdInquiries() {
  const q = query(adsCol(), orderBy("createdAt", "desc"), limit(100));
  const snap = await getDocs(q);
  const out = [];
  snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
  return out;
}

export async function recordEggFound(eggId) {
  if (typeof eggId !== "string" || !/^[a-z0-9]{1,32}$/.test(eggId)) return;
  const ref = eggStatsDoc(eggId);
  const s = await getDoc(ref);
  const current = s.exists() ? Number(s.data().count) || 0 : 0;
  await setDoc(ref, { count: current + 1 }, { merge: true });
}
