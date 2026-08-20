// =============================================================
//  브라우저 WebCrypto 기반 유틸
//  - 관리자 코드 / 학생 비밀번호를 PBKDF2 로 해시하여 저장 (원문 미저장)
// =============================================================

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

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

// ---------------------------------------------------------------
//  HMAC-SHA256 (빠름) — 세션 토큰 서명용.
//  비밀번호 해시에는 일부러 느린 PBKDF2를 쓰지만, 토큰은 화면을 누를 때마다
//  검증·재발급하므로 빠른 HMAC이어야 한다.
// ---------------------------------------------------------------
export async function hmacHex(keyHex, message) {
  const key = await subtle.importKey(
    "raw",
    hexToBuf(keyHex),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await subtle.sign("HMAC", key, enc.encode(message));
  return bufToHex(sig);
}

// 타이밍 공격을 줄이기 위해 길이·내용을 상수 시간으로 비교
export function safeEqual(a, b) {
  const x = String(a ?? ""), y = String(b ?? "");
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

// 짧은 파생 ID: 값을 알아야만 문서 경로를 계산할 수 있게 할 때 쓴다.
export async function deriveId(secret, saltHex, len = 24) {
  return (await hashSecret(secret, saltHex)).slice(0, len);
}
