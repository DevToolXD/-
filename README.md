# 🎁 우리반 마니또 (GitHub Pages + Firebase)

프레임워크 없이 순수 HTML/CSS/JS로 만든 마니또(Secret Santa) 웹앱입니다.
데이터는 Firebase Firestore에 저장하고, 이름+비밀번호로 간단히 로그인합니다.

**라이브 주소:** https://devtoolxd.github.io/-/

---

## 기능

### 👩‍🏫 선생님(관리자)
- 관리자 코드로 로그인 (최초 입력한 코드가 자동 등록됨)
- 학생 명단 입력 → **마니또 랜덤 배정** (자기 자신 제외, 1:1, 순환 구조로 중복 없음)
- **전체 마니또 관계 공개** (누가 누구의 마니또인지 표로 확인)
- **재배정(reshuffle)**

### 🙋 학생
- 이름 선택 + 간단한 비밀번호로 로그인 (첫 로그인 시 비밀번호 자동 설정)
- **본인이 누구의 마니또인지는 화면에 안 뜸** (선생님만 열람 가능)
- "이런 거 도와주면 좋겠다" 소원 메시지 작성 → 나를 돌봐주는 마니또에게 **익명** 전달
- 내가 돌보는 친구의 **소원함** 확인

---

## 프로젝트 구조

```
index.html            # 화면(역할선택/학생/관리자)
styles.css            # 스타일 (다크모드 대응)
config.js             # Firebase 설정값 + 앱 설정 (여기만 수정)
js/
  firebase.js         # Firebase 초기화 (CDN import)
  crypto.js           # WebCrypto (AES-GCM 암호화 / PBKDF2 해시)
  assign.js           # 순환 배정 알고리즘 (의존성 없음)
  data.js             # Firestore 읽기/쓰기 + 비즈니스 로직
  app.js              # UI / 라우팅
firestore.rules       # ⭐ 보안 규칙 (아래 안내대로 콘솔에 붙여넣기)
tests/                # Node 검증 스크립트
.github/workflows/    # GitHub Pages 자동 배포
```

## Firestore 데이터 구조

| 컬렉션 | 문서 | 필드 | 설명 |
|--------|------|------|------|
| `students` | 자동ID | `name`, `createdAt` | 로그인 드롭다운용. **이름만** 저장 |
| `secrets` | 학생ID | `salt`, `pwHash`, `hasPassword`, `sendChannel`, `readChannel` | 비밀번호 해시 + 배정된 채널 토큰. **열거(list) 금지** |
| `channels/{cid}/messages` | 자동ID | `text`, `createdAt` | 소원 메시지. `cid`(비밀 토큰)를 알아야만 접근 |
| `meta/config` | — | `adminSalt`, `adminHash` | 관리자 코드 해시 |
| `meta/mapping` | — | `salt`, `iv`, `ct` | 전체 배정표를 **관리자 코드로 AES-GCM 암호화**한 값 |

`sendChannel`/`readChannel`은 수호자(guardian)-대상(protégé) 사이의 128비트 랜덤
채널입니다. 대상은 `sendChannel`로 소원을 보내고, 수호자는 같은 값인 자신의
`readChannel`에서 그 소원을 익명으로 읽습니다. 이름이 아니라 토큰으로 연결되므로
UI에 마니또 관계가 드러나지 않습니다.

---

## 🔐 보안 규칙 적용 (중요 — 직접 하셔야 합니다)

현재 Firestore가 **테스트 모드(누구나 읽기/쓰기)** 상태입니다. 아래처럼
`firestore.rules` 내용을 콘솔에 붙여넣어 프로덕션 규칙으로 바꿔주세요.

1. [Firebase 콘솔](https://console.firebase.google.com/project/manito-e14c1/firestore/rules) 접속
2. **Firestore Database → 규칙(Rules)** 탭 이동
3. 편집창 내용을 **모두 지우고**, 이 저장소의 [`firestore.rules`](./firestore.rules) 내용을 그대로 붙여넣기
4. **게시(Publish)** 클릭

### 이 규칙이 막아주는 것
- `channels`/`secrets` 컬렉션 **열거(list) 차단** → 토큰을 모르면 메시지/시크릿에 도달 불가
- `meta/mapping`에는 **암호문만** 저장 → 관리자 코드 없이는 배정표 복호화 불가
- 문서 형태(길이/타입) 검증, 이미 등록된 학생 이름 수정/삭제 차단

### ⚠️ 이 스택의 보안 한계 (반드시 이해하세요)
이 앱은 **Firebase Authentication을 쓰지 않는** 정적 사이트라서, 보안 규칙이
"누가 요청했는지"(`request.auth`)를 알 수 없습니다. 따라서:

- **핵심 기밀(전체 배정표)은 규칙이 아니라 "암호화"로 보호합니다.** 관리자 코드로
  AES-GCM 암호화하므로, 학생이 DB를 직접 열어 `meta/mapping`을 봐도 복호화할 수
  없습니다. → "학생은 마니또 정보 직접 조회 불가", "관리자 코드 없이 전체공개 불가"
  요구사항은 **암호학적으로** 충족됩니다.
- **남는 한계:** 개발자도구를 쓸 줄 아는 학생이 여러 학생의 `secrets` 문서를 하나씩
  `get`으로 받아 채널 토큰을 대조하면, 이론적으로 일부 관계를 역추적할 수 있습니다
  (list는 막았지만 개별 get은 토큰 사용에 필요). 또한 자체 인증이라 "본인만 자기
  비밀번호 변경" 같은 규칙 강제는 불가능합니다.
- **더 강한 보장이 필요하면** Firebase Authentication(익명/이메일) + Cloud Functions로
  확장해 서버에서 관리자 코드 검증과 메시지 라우팅을 처리하세요. 교실용 신뢰 수준에서는
  현재 구성으로 충분합니다.

> 참고: `config.js`의 Firebase `apiKey`는 공개되어도 되는 값입니다(웹 식별자).
> 관리자 코드와 학생 비밀번호는 **추측하기 어려운 값**으로 정하세요.

---

## 사용 방법

1. 규칙 적용(위) 후 사이트 접속 → **선생님이에요** 선택
2. 관리자 코드 입력(최초 입력값이 등록됨) → 학생 명단 추가 → **마니또 배정하기**
3. 학생은 **학생이에요** → 이름 선택 → 비밀번호 입력(첫 로그인 시 설정) → 소원 작성
4. 선생님은 언제든 **전체 공개 보기**로 배정표 확인, 필요하면 **재배정**

> 재배정하면 기존 채널과 주고받은 소원이 초기화됩니다.

---

## 배포 (GitHub Pages)

`claude/manito-github-firebase-jwjdyq` 브랜치에 푸시하면
`.github/workflows/pages.yml`이 자동으로 배포합니다.

Pages가 자동 활성화되지 않으면 한 번만 수동 설정:
**Settings → Pages → Build and deployment → Source: GitHub Actions** 선택 후
Actions 탭에서 워크플로우를 다시 실행하세요.
주소: **https://devtoolxd.github.io/-/**

---

## 로컬 테스트

```bash
# 순수 로직 (배정 알고리즘 / 암호화 / 해시) — 네트워크 불필요
node tests/logic.test.mjs

# 라이브 E2E — 실제 Firebase에 배정→메시지→공개 후 자동 정리
node tests/e2e_live.mjs
```
