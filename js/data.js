// =============================================================
//  데이터 계층 - Firestore 읽기/쓰기 + 마니또 배정 로직
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
  writeBatch,
  query,
  orderBy,
  serverTimestamp,
} from "./firebase.js";
import {
  randomHex,
  hashSecret,
  encryptJSON,
  decryptJSON,
} from "./crypto.js";
import { buildCycle } from "./assign.js";
import { APP } from "../config.js";

// ---------- 학생 명단 ----------
export async function listStudents() {
  const snap = await getDocs(collection(db, "students"));
  const out = [];
  snap.forEach((d) => out.push({ id: d.id, name: d.data().name }));
  out.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return out;
}

// 이름 배열을 받아 학생 + 빈 secret 문서를 생성. 이미 있는 이름은 건너뜀.
export async function addStudents(names) {
  const existing = new Set((await listStudents()).map((s) => s.name));
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
    const ref = doc(collection(db, "students"));
    batch.set(ref, { name, createdAt: serverTimestamp() });
    batch.set(doc(db, "secrets", ref.id), {
      hasPassword: false,
      sendChannel: null,
      readChannel: null,
    });
  }
  await batch.commit();
  return toAdd.length;
}

// ---------- 학생 인증 ----------
export async function getSecret(id) {
  const s = await getDoc(doc(db, "secrets", id));
  return s.exists() ? s.data() : null;
}

// 첫 로그인 시 비밀번호 설정
export async function setStudentPassword(id, password) {
  const salt = randomHex(16);
  const pwHash = await hashSecret(password, salt);
  await updateDoc(doc(db, "secrets", id), {
    salt,
    pwHash,
    hasPassword: true,
  });
}

// 로그인 검증. 반환: 'ok' | 'wrong' | 'needSetup'
export async function verifyStudentPassword(id, password) {
  const sec = await getSecret(id);
  if (!sec) return "wrong";
  if (!sec.hasPassword) return "needSetup";
  const h = await hashSecret(password, sec.salt);
  return h === sec.pwHash ? "ok" : "wrong";
}

// ---------- 관리자 ----------
export async function adminConfigExists() {
  const s = await getDoc(doc(db, "meta", "config"));
  return s.exists();
}

// 최초 1회: 관리자 코드 등록
export async function setupAdmin(code) {
  const adminSalt = randomHex(16);
  const adminHash = await hashSecret(code, adminSalt);
  await setDoc(doc(db, "meta", "config"), { adminSalt, adminHash });
}

// 관리자 코드 검증
export async function verifyAdmin(code) {
  const s = await getDoc(doc(db, "meta", "config"));
  if (!s.exists()) return false;
  const { adminSalt, adminHash } = s.data();
  const h = await hashSecret(code, adminSalt);
  return h === adminHash;
}

// ---------- 마니또 배정 / 재배정 ----------
// code: 관리자 코드 (매핑 암호화 키로 사용)
export async function assignManito(code) {
  const students = await listStudents();
  if (students.length < 2) {
    throw new Error("학생이 2명 이상 있어야 배정할 수 있습니다.");
  }
  const cycle = buildCycle(students.length);

  // 학생별로 설정할 채널을 모은다 (한 학생당 update 1회 → 배치 제약 회피)
  const updates = new Map(students.map((s) => [s.id, {}]));
  const pairs = [];
  for (const { guardianIdx, protegeIdx } of cycle) {
    const guardian = students[guardianIdx];
    const protege = students[protegeIdx];
    const channel = randomHex(16); // 이 수호자-대상 사이의 비밀 채널
    updates.get(guardian.id).readChannel = channel; // 수호자는 여기서 읽는다
    updates.get(protege.id).sendChannel = channel; // 대상은 여기로 보낸다
    pairs.push({
      guardianId: guardian.id,
      guardianName: guardian.name,
      protegeId: protege.id,
      protegeName: protege.name,
    });
  }

  // 배정 결과는 관리자 코드로 암호화하여 저장 (학생은 복호화 불가)
  const encrypted = await encryptJSON(
    { assignedAt: new Date().toISOString(), pairs },
    code
  );

  const batch = writeBatch(db);
  for (const [id, fields] of updates) {
    batch.update(doc(db, "secrets", id), fields);
  }
  batch.set(doc(db, "meta", "mapping"), {
    ...encrypted,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return pairs.length;
}

// 전체 마니또 관계 조회 (관리자 코드로 복호화). 코드 틀리면 예외.
export async function revealMapping(code) {
  const s = await getDoc(doc(db, "meta", "mapping"));
  if (!s.exists()) return null;
  const data = s.data();
  const obj = await decryptJSON(
    { salt: data.salt, iv: data.iv, ct: data.ct },
    code
  );
  return obj; // { assignedAt, pairs: [...] }
}

export async function isAssigned() {
  const s = await getDoc(doc(db, "meta", "mapping"));
  return s.exists();
}

// ---------- 메시지 ----------
// 학생이 자기 마니또(수호자)에게 익명 소원 메시지 전송
export async function sendWish(sendChannel, text) {
  if (!sendChannel) throw new Error("아직 마니또가 배정되지 않았습니다.");
  const clean = text.trim();
  if (!clean) throw new Error("메시지를 입력해주세요.");
  if (clean.length > APP.maxMessageLength) {
    throw new Error(`메시지는 ${APP.maxMessageLength}자 이내로 작성해주세요.`);
  }
  await addDoc(collection(db, "channels", sendChannel, "messages"), {
    text: clean,
    createdAt: serverTimestamp(),
  });
}

// 내가 돌보는 대상이 보낸 소원 메시지함 (익명)
export async function getInbox(readChannel) {
  if (!readChannel) return [];
  const q = query(
    collection(db, "channels", readChannel, "messages"),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  const out = [];
  snap.forEach((d) => {
    const m = d.data();
    out.push({
      id: d.id,
      text: m.text,
      createdAt: m.createdAt ? m.createdAt.toDate() : null,
    });
  });
  return out;
}

// 내가 보낸 소원 메시지 (본인 확인용)
export async function getSent(sendChannel) {
  return getInbox(sendChannel);
}
