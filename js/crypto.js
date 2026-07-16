// =============================================================
//  브라우저 WebCrypto 기반 암호화 유틸
//  - 관리자 코드로 마니또 매핑을 AES-GCM 암호화 (학생은 복호화 불가)
//  - 비밀번호는 PBKDF2 로 해시하여 저장
// =============================================================

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

// ---- 인코딩 헬퍼 ----
function bufToHex(buf) {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function hexToBuf(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return arr;
}

// 암호학적으로 안전한 랜덤 hex 토큰 (기본 16바이트 = 128비트)
export function randomHex(bytes = 16) {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return bufToHex(a.buffer);
}

// ---- 해시 (비밀번호/관리자코드 검증용) ----
// PBKDF2-SHA256, 반복 15만회. saltHex 는 저장해두고 검증 시 재사용.
export async function hashSecret(secret, saltHex) {
  const salt = hexToBuf(saltHex);
  const baseKey = await subtle.importKey(
    "raw",
    enc.encode(secret),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
    baseKey,
    256
  );
  return bufToHex(bits);
}

// ---- AES-GCM 키 유도 (관리자 코드 → 대칭키) ----
async function deriveAesKey(password, saltHex) {
  const salt = hexToBuf(saltHex);
  const baseKey = await subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// 객체를 관리자 코드로 암호화 → { salt, iv, ct } (모두 hex)
export async function encryptJSON(obj, password) {
  const saltHex = randomHex(16);
  const ivHex = randomHex(12);
  const key = await deriveAesKey(password, saltHex);
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv: hexToBuf(ivHex) },
    key,
    enc.encode(JSON.stringify(obj))
  );
  return { salt: saltHex, iv: ivHex, ct: bufToHex(ct) };
}

// { salt, iv, ct } 를 관리자 코드로 복호화 → 객체. 코드가 틀리면 예외 발생.
export async function decryptJSON({ salt, iv, ct }, password) {
  const key = await deriveAesKey(password, salt);
  const plain = await subtle.decrypt(
    { name: "AES-GCM", iv: hexToBuf(iv) },
    key,
    hexToBuf(ct)
  );
  return JSON.parse(dec.decode(plain));
}
