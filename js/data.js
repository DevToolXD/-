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
} from "./firebase.js";
import { randomHex, hashSecret } from "./crypto.js";
import { buildCycle } from "./assign.js";
import { APP, CLASS_CODES, SUPER_ADMIN } from "../config.js";

// 주의: Firestore는 "__로 시작하고 끝나는" 문서 ID를 예약어로 취급해 거부합니다.
export const TEACHER_ID = "_teacher_";
export const TEACHER_NAME = "선생님";

// ---------- 경로 헬퍼 ----------
const studentsCol = (code) => collection(db, "classes", code, "students");
const secretsDoc = (code, id) => doc(db, "classes", code, "secrets", id);
const stateDoc = (code) => doc(db, "classes", code, "meta", "state");
const classDoc = (code) => doc(db, "classes", code);
const votesDoc = (id) => doc(db, "modeVotes", id);
const feedbackCol = () => collection(db, "feedback");
const feedbackDoc = (id) => doc(db, "feedback", id);

// ---------- 학생 명단 ----------
export async function listStudents(code) {
  const snap = await getDocs(studentsCol(code));
  const out = [];
  snap.forEach((d) => out.push({ id: d.id, name: d.data().name }));
  out.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  // 0603 반은 슈퍼 관리자(정후교)가 로그인 화면에 항상 보이도록 합성 추가
  if (code === SUPER_ADMIN.classCode && !out.some((s) => s.name === SUPER_ADMIN.name)) {
    out.unshift({ id: SUPER_ADMIN.studentId, name: SUPER_ADMIN.name, synthetic: true });
  }
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

export async function setStudentPassword(code, id, password) {
  const salt = randomHex(16);
  const pwHash = await hashSecret(password, salt);
  await updateDoc(secretsDoc(code, id), { salt, pwHash, hasPassword: true });
}

// 로그인 검증. 반환: 'ok' | 'wrong' | 'needSetup'
export async function verifyStudentPassword(code, id, password) {
  const sec = await ensureSecretDoc(code, id);
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
  const s = await getDoc(classDoc(code));
  if (!s.exists() || !s.data().adminHash) return false;
  const { adminSalt, adminHash } = s.data();
  const h = await hashSecret(adminCode, adminSalt);
  return h === adminHash;
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
  const clean = text.trim();
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

// ---------- 모드 투표 (뽀로로 모드 / 하츄핑 모드) ----------
export const MODE_CANDIDATES = [
  { id: "pororo", label: "뽀로로 모드" },
  { id: "hachuping", label: "하츄핑 모드" },
];
const VOTED_KEY_PREFIX = "vote-"; // Firestore 문서 id 접두사 용도는 아니고 참고용

export async function getModeVotes() {
  const out = [];
  for (const c of MODE_CANDIDATES) {
    const s = await getDoc(votesDoc(c.id));
    out.push({ id: c.id, label: c.label, count: s.exists() ? s.data().count || 0 : 0 });
  }
  return out;
}

export async function voteForMode(candidateId) {
  if (!MODE_CANDIDATES.some((c) => c.id === candidateId)) throw new Error("올바르지 않은 후보예요.");
  const s = await getDoc(votesDoc(candidateId));
  const current = s.exists() ? s.data().count || 0 : 0;
  await setDoc(votesDoc(candidateId), { count: current + 1 }, { merge: true });
}

// 슈퍼 관리자 전용: 투표 초기화
export async function resetModeVotes() {
  for (const c of MODE_CANDIDATES) {
    await setDoc(votesDoc(c.id), { count: 0 }, { merge: true });
  }
}

// ---------- 피드백 게시판 (반 구분 없이 전체 공용, 최신순) ----------
export async function listFeedback() {
  const q = query(feedbackCol(), orderBy("createdAt", "desc"), limit(100));
  const snap = await getDocs(q);
  const out = [];
  snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
  return out;
}

export async function postFeedback(name, roleTag, message) {
  const clean = message.trim();
  if (!clean) throw new Error("내용을 입력해주세요.");
  if (clean.length > APP.maxFeedbackLength) {
    throw new Error(`피드백은 ${APP.maxFeedbackLength}자 이내로 작성해주세요.`);
  }
  await addDoc(feedbackCol(), {
    name: (name || "익명").trim().slice(0, APP.maxNameLength) || "익명",
    roleTag: (roleTag || "").slice(0, 60),
    message: clean,
    createdAt: serverTimestamp(),
  });
}

// 슈퍼 관리자 전용: 부적절한 게시글 삭제 (다른 컬렉션과 동일하게 클라이언트 UI에서만 제한)
export async function deleteFeedback(id) {
  await deleteDoc(feedbackDoc(id));
}
