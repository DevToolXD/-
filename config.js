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

// 앱 동작 관련 설정
export const APP = {
  // 메시지 최대 길이 (Firestore 보안 규칙과 반드시 동일하게 유지)
  maxMessageLength: 500,
  // 이름/비밀번호 최대 길이
  maxNameLength: 40,
  maxPasswordLength: 64,
  // Firebase SDK 버전 (CDN)
  firebaseVersion: "10.12.0",
};
