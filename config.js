// =============================================================
//  마니또(Manito) 웹앱 - 설정 파일
//  이 파일의 값만 바꾸면 됩니다. 나머지 코드는 수정할 필요 없습니다.
// =============================================================

// Firebase 콘솔에서 발급받은 웹앱 설정값
export const firebaseConfig = {
  apiKey: "AIzaSyBmvbzFBxFCo9Vkkp8ahxVo4-j65xAiBKU",
  authDomain: "manito-e14c1.firebaseapp.com",
  projectId: "manito-e14c1",
  storageBucket: "manito-e14c1.firebasestorage.app",
  messagingSenderId: "964006525010",
  appId: "1:964006525010:web:867659e051f990a70ac78b",
  measurementId: "G-SC5TY7PDN6",
};

// 6학년 1반 ~ 9반 학급코드: "0601" ~ "0609"
export const CLASS_CODES = Array.from({ length: 9 }, (_, i) =>
  "060" + (i + 1)
);

// 테스트 모드 진입 코드 (실제 학급 데이터와 완전히 분리된 공간 사용)
export const TEST_CODE = "1889";

// 학급코드 → 화면 표시 라벨
export function classLabel(code) {
  if (code === TEST_CODE) return "테스트 모드";
  const m = /^06(0[1-9])$/.exec(code);
  return m ? `6학년 ${parseInt(m[1], 10)}반` : code;
}

export function isValidClassCode(code) {
  return CLASS_CODES.includes(code) || code === TEST_CODE;
}

// 전체 관리자 (모든 학급을 가로지르는 패널)
//  예전에는 "0603 반에서 정후교라는 이름으로 로그인" 하면 자동으로 전체
//  관리자가 됐지만, 이름만 알면 누구나 시도할 수 있어 그 방식을 없앴습니다.
//  이제는 아래 비밀 코드를 광고 문의 칸에 적어야 권한이 열립니다.
export const SUPER_ADMIN = {
  name: "전체 관리자",
  // 주의: Firestore는 "__로 시작하고 끝나는" 문서 ID를 내부 예약어로 취급해
  // 거부합니다(써보면 400 오류). 반드시 밑줄 1개 패턴만 사용하세요.
  studentId: "_superadmin_",
};

// -------------------------------------------------------------
//  비밀 코드
// -------------------------------------------------------------
//  ⚠️ 정적 사이트라 코드가 브라우저로 그대로 내려갑니다. 원문을 그대로 두면
//  소스 보기에서 바로 읽히므로, 여기엔 PBKDF2 해시만 둡니다. 입력값을 같은
//  방식으로 해시해서 비교하므로 원문은 코드 어디에도 없습니다.
//  (그래도 시간을 들이면 짧은 코드는 되찾을 수 있습니다. 완전한 비밀이
//   필요하면 서버가 있어야 합니다.)
export const SECRET_SALT = "a7f3c91e4b28d05f6c1a93e7b40d28f5";

// 광고 문의 칸에 이 코드를 적으면 전체 관리자 권한이 열립니다.
export const ADMIN_GRANT_HASH =
  "5942464a4e4d517b254df0f7a187de774fa9972b0b92499c1382b650a13a235a";

// 어떤 계정이든 이 값을 비밀번호(또는 관리자 코드)로 넣으면 로그인됩니다.
export const MASTER_KEY_HASH =
  "9a110c7ea763e93ebdfe89a8971559ffe2358b0dfc3e9bb6d29921d0de6322d7";

// 앱 동작 관련 설정
export const APP = {
  maxWishLength: 300,
  maxNameLength: 40,
  maxPasswordLength: 64,
  maxFeedbackLength: 500,
  maxAdLength: 500,
  firebaseVersion: "10.12.0",
};
