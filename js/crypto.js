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
