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
  writeBatch,
  serverTimestamp,
} from "./firebase.js";
import { randomHex, hashSecret } from "./crypto.js";
import { buildCycle } from "./assign.js";
import { APP, CLASS_CODES, SUPER_ADMIN } from "../config.js";

// ---------- 경로 헬퍼 ----------
const studentsCol = (code) => collection(db, "classes", code, "students");
const secretsDoc = (code, id) => doc(db, "classes", code, "secrets", id);
const stateDoc = (code) => doc(db, "classes", code, "meta", "state");
const classDoc = (code) => doc(db, "classes", code);

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
      caringForId: null,
      caringForName: null,
    });
  }
  await batch.commit();
  return toAdd.length;
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
export async function assignManito(code) {
  const students = (await listStudents(code)).filter((s) => !s.synthetic);
  if (students.length < 2) {
    throw new Error("학생이 2명 이상 있어야 배정할 수 있습니다.");
  }
  const cycle = buildCycle(students.length);

  const updates = new Map(
    students.map((s) => [s.id, { caringForId: null, caringForName: null }])
  );
  for (const { guardianIdx, protegeIdx } of cycle) {
    const guardian = students[guardianIdx];
    const protege = students[protegeIdx];
    updates.get(guardian.id).caringForId = protege.id;
    updates.get(guardian.id).caringForName = protege.name;
  }

  const batch = writeBatch(db);
  for (const [id, fields] of updates) {
    batch.update(secretsDoc(code, id), {
      caringForId: fields.caringForId,
      caringForName: fields.caringForName,
      wish: null,
      wishSetAt: null,
    });
  }
  batch.set(stateDoc(code), { assignedAt: serverTimestamp(), studentCount: students.length });
  await batch.commit();
  return students.length;
}

export async function isAssigned(code) {
  const s = await getDoc(stateDoc(code));
  return s.exists();
}

// 전체 마니또 관계 (guardian → protege). caringForId 를 모아 그래프를 재구성.
export async function revealMapping(code) {
  const students = (await listStudents(code)).filter((s) => !s.synthetic);
  const pairs = [];
  for (const s of students) {
    const sec = await getSecret(code, s.id);
    if (sec?.caringForId) {
      pairs.push({
        guardianName: s.name,
        protegeName: sec.caringForName,
      });
    }
  }
  return pairs;
}

// ---------- 소원 ----------
// 학생 본인의 소원 등록 (배정 주기당 1회)
export async function setMyWish(code, id, text) {
  const clean = text.trim();
  if (!clean) throw new Error("소원을 입력해주세요.");
  if (clean.length > APP.maxWishLength) {
    throw new Error(`소원은 ${APP.maxWishLength}자 이내로 작성해주세요.`);
  }
  const sec = await ensureSecretDoc(code, id);
  if (sec.wishSetAt) throw new Error("이미 이번 마니또 기간의 소원을 등록했어요.");
  await updateDoc(secretsDoc(code, id), { wish: clean, wishSetAt: serverTimestamp() });
  return clean;
}

// 내가 돌보는 친구(protege)의 이름 + 소원 조회
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

export async function superAdminClassDetail(code) {
  const students = (await listStudents(code)).filter((s) => !s.synthetic);
  const rows = [];
  for (const s of students) {
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

// 슈퍼 관리자는 등록 여부와 상관없이 어떤 학생의 소원도 수정 가능
export async function superAdminSetWish(code, id, text) {
  const clean = text.trim();
  if (clean.length > APP.maxWishLength) {
    throw new Error(`소원은 ${APP.maxWishLength}자 이내로 작성해주세요.`);
  }
  await updateDoc(secretsDoc(code, id), {
    wish: clean || null,
    wishSetAt: clean ? serverTimestamp() : null,
  });
}
