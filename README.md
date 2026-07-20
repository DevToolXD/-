# 마니또 (GitHub Pages + Firebase)

프레임워크 없이 순수 HTML/CSS/JS로 만든 마니또(Secret Santa) 웹앱입니다.
6학년 1반~9반을 학급코드로 완전히 분리해서 관리하고, Firebase Firestore에
데이터를 저장합니다.

**라이브 주소:** https://devtoolxd.github.io/-/

---

## 사용 흐름

1. **학급코드 입력** — 6학년 1반은 `0601`, 2반은 `0602` … 9반은 `0609`.
   `1889`를 입력하면 실제 반 데이터와 완전히 분리된 **테스트 모드**로 진입.
2. **학생**: 이름 선택 + 간단한 비밀번호로 로그인(첫 로그인 시 비밀번호 자동
   설정) → **나의 소원을 1회 등록**(다음 배정 전까지 수정 불가) → 내가
   돌보는 친구가 배정되면 그 친구 이름(작게)과 소원(크게)이 표시됨.
   **본인의 마니또(자신을 돌보는 사람)는 화면에 절대 노출되지 않음.**
3. **선생님(학급 관리자)**: 관리자 코드로 로그인(최초 입력값이 그 반의
   코드로 등록됨) → 학생 명단 입력 → **마니또 랜덤 배정**(자기 자신 제외,
   1:1, 순환 구조로 중복 없음) → **전체 관계 공개** 표 확인 → 필요하면
   **재배정**(재배정 시 모든 학생의 소원이 초기화되고 다시 쓸 수 있음).
4. **전체 관리자**: `0603` 학급코드에서 이름을 `정후교`로 로그인하면(실제
   명단 등록 여부와 무관) 9개 반 전체를 가로지르는 관리자 패널로 진입 —
   모든 반의 마니또 관계 열람 + 학생 소원 직접 수정 + 반별 재배정 가능.

---

## 프로젝트 구조

```
index.html            # 화면 (학급코드/역할선택/학생/관리자/전체관리자)
styles.css             # 리퀴드 글라스 · 클로버 그린 디자인 시스템
config.js              # 학급코드, 슈퍼 관리자, Firebase 설정 (여기만 수정)
js/
  firebase.js         # Firebase 초기화 (CDN import, 실패해도 앱이 죽지 않게 처리)
  crypto.js            # WebCrypto PBKDF2 해시 (비밀번호/관리자코드)
  assign.js             # 순환 배정 알고리즘 (의존성 없음)
  data.js               # Firestore 읽기/쓰기 + 비즈니스 로직 (학급코드 스코프)
  app.js                 # UI / 라우팅 / 커서 인터랙션 / 소원 애니메이션
firestore.rules        # ⭐ 보안 규칙 (아래 안내대로 콘솔에 붙여넣기)
tests/                  # Node 검증 스크립트
.github/workflows/      # GitHub Pages 자동 배포
```

## Firestore 데이터 구조

모든 데이터는 `classes/{학급코드}` 아래로 완전히 격리됩니다. (`학급코드`는
`0601`~`0609` 또는 `1889`)

| 경로 | 필드 | 설명 |
|------|------|------|
| `classes/{code}` | `adminSalt`, `adminHash` | 그 반의 관리자 코드 해시 |
| `classes/{code}/students/{id}` | `name` | 학생 이름 |
| `classes/{code}/secrets/{id}` | `salt`,`pwHash`,`hasPassword`,`wish`,`wishSetAt`,`caringForId`,`caringForName` | 비밀번호 해시 + **본인의 소원** + **내가 돌보는 대상**(guardian → protege 방향) |
| `classes/{code}/meta/state` | `assignedAt`,`studentCount` | 배정 완료 여부 |

- `caringForId`는 "이 학생이 누구를 돌보는 마니또인지"만 담습니다. 반대
  방향(누가 나를 돌보는지)은 어디에도 저장하지 않으므로 학생이 본인의
  마니또를 알아낼 방법이 없습니다.
- 전체 공개/슈퍼 관리자 열람은 모든 학생의 `caringForId`를 모아 그래프를
  재구성하는 방식으로 동작합니다 (별도 암호화된 매핑을 두지 않음).

---

## 🔐 보안 규칙 적용 (직접 하셔야 합니다)

1. [Firebase 콘솔](https://console.firebase.google.com/project/manito-e14c1/firestore/rules) 접속
2. **Firestore Database → 규칙(Rules)** 탭 이동
3. 편집창을 모두 지우고 이 저장소의 [`firestore.rules`](./firestore.rules) 내용을 그대로 붙여넣기
4. **게시(Publish)** 클릭

### 규칙이 막아주는 것
- 학급코드가 `0601`~`0609`/`1889` 형식이 아니면 어떤 경로도 접근 불가
- `secrets` 컬렉션 **열거(list) 차단** → 무작위 수집 방지
- 문서 필드 형태(허용된 키·길이) 검증

### ⚠️ 이 스택의 보안 한계
Firebase Authentication을 쓰지 않는 정적 사이트라서 규칙이 "누가
요청했는지"를 알 수 없고, "본인만 자기 계정 수정", "선생님만 배정" 같은
사용자별 권한은 앱 로직(비밀번호/관리자코드 확인)에 의존합니다. 개발자
도구를 다룰 줄 아는 사용자가 이론적으로 우회할 수 있는 여지가 있습니다.
교실용 신뢰 수준에서는 충분하지만, 더 강한 보장이 필요하면 Firebase
Authentication + Cloud Functions로 확장하세요.

> `config.js`의 Firebase `apiKey`는 공개되어도 되는 값입니다. 관리자
> 코드와 학생 비밀번호는 추측하기 어려운 값으로 정하세요.

---

## 배포 (GitHub Pages)

`claude/manito-github-firebase-jwjdyq` 브랜치에 푸시하면
`.github/workflows/pages.yml`이 자동으로 배포합니다. Pages가 자동
활성화되지 않으면 한 번만 수동 설정: **Settings → Pages → Build and
deployment → Source: GitHub Actions** 선택 후 Actions 탭에서 워크플로우를
다시 실행하세요. 주소: **https://devtoolxd.github.io/-/**

---

## 로컬 테스트

```bash
# 순수 로직 (배정 알고리즘 / 해시) — 네트워크 불필요
node tests/logic.test.mjs

# 라이브 E2E — 실제 Firebase(테스트 모드 1889)에 배정→소원→공개 후 자동 정리
node tests/e2e_live.mjs
```

Made by 정후교
