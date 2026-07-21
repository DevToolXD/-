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

// 슈퍼 관리자: 이 학급코드에서 이 이름으로 로그인하면 전체 학급을
// 가로지르는 관리자 패널로 진입합니다. (실제 명단에 등록될 필요 없음)
export const SUPER_ADMIN = {
  name: "정후교",
  classCode: "0603",
  // 주의: Firestore는 "__로 시작하고 끝나는" 문서 ID를 내부 예약어로 취급해
  // 거부합니다(써보면 400 오류). 반드시 밑줄 1개 패턴만 사용하세요.
  studentId: "_superadmin_",
};

// 앱 동작 관련 설정
export const APP = {
  maxWishLength: 300,
  maxNameLength: 40,
  maxPasswordLength: 64,
  firebaseVersion: "10.12.0",
};
