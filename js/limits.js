// =============================================================
//  한도 한 곳에 모으기 — firestore.rules 와 앱이 같은 숫자를 보게
// =============================================================
//  이 앱에서 되풀이된 사고가 하나 있다. 규칙(firestore.rules)에는 한도가
//  적혀 있는데 앱은 그 값을 몰라서, 넘는 요청을 그냥 보내고 → 서버가 막고
//  → "권한이 없습니다" 같은 문구가 학생 화면에 뜨는 것이다.
//  (fed <= 9 를 몰라서 열 번째 밥주기가 그랬고, art 길이도 그랬다)
//
//  그래서 두 곳에 같은 숫자를 손으로 적는 짓을 그만둔다.
//   · 앱은 이 파일만 본다.
//   · firestore.rules 가 이 값과 다르면 tests/rules_match.test.mjs 가
//     빌드를 실패시킨다.
//   · 규칙 파일 자체는 배포 때 자동으로 게시된다(.github/workflows).
//
//  값을 바꿀 때는 여기와 firestore.rules 를 함께 고치면 되고, 한쪽만
//  고치면 테스트가 잡아준다.

export const LIMITS = {
  // ---- 어항: 물고기 ----
  fishArtMin: 4,        // art.size() >= 4
  fishArtMax: 6000,     // art.size() <= 6000
  fishFedMax: 9,        // fed <= 9  (밥을 이만큼 먹으면 더 못 먹는다)
  fishNameMax: 20,      // cleanStr(name, 20)
  ownerIdMax: 64,       // cleanStr(ownerId, 64)

  // ---- 어항: 밥 나눠주기 ----
  foodGrantMax: 99999,  // total <= 99999
  foodGrantStep: 9999,  // 한 번에 늘릴 수 있는 폭

  // ---- 공통 ----
  nameMax: 40,          // cleanStr(name, 40) — 학생·주인 이름
  wishMax: 300,         // nullableStr(wish, 300)
  docKeysMax: 10,       // smallDoc(): keys().size() <= 10
};

// =============================================================
//  규칙이 열어줘야 하는 자리 목록
// =============================================================
//  규칙을 새로 게시하지 않으면 여기 적힌 곳이 막힌다. 앱의 "서버 규칙" 칸과
//  tests/check_rules.mjs 가 같은 목록을 보고 확인한다 — 예전에는 두 곳에
//  따로 적어 두어서, 컬렉션을 새로 만들 때 한쪽만 고치곤 했다.
export const RULE_PROBES = [
  { key: "adminAccounts", path: ["adminAccounts"],
    label: "adminAccounts 목록 읽기", why: "전체 관리자 화면의 '관리자 계정' 목록" },
  { key: "eggStats", path: ["eggStats"],
    label: "eggStats 목록 읽기", why: "이스터에그 발견자 수" },
  { key: "voteBallots", path: ["voteBallots"],
    label: "voteBallots 목록 읽기", why: "같은 사람이 두 번 투표하지 못하게 하는 기록" },
  { key: "securityLog", path: ["securityLog"],
    label: "securityLog 목록 읽기", why: "개발자 도구를 열어 본 흔적" },
  { key: "fish", path: ["classes", "0603", "fish"],
    label: "어항(fish) 목록 읽기", why: "6학년 3반 어항" },
  { key: "foodGrants", path: ["classes", "0603", "foodGrants"],
    label: "어항 밥 나눠주기 목록 읽기", why: "전체 관리자 화면의 '어항 밥 주기'" },
];

export default LIMITS;
