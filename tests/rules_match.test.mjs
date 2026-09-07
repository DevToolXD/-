// =============================================================
//  firestore.rules 와 js/limits.js 가 같은 숫자를 쓰는지 확인
// =============================================================
//  실행: node --test tests/rules_match.test.mjs
//
//  규칙에 적힌 한도와 앱이 아는 한도가 어긋나면, 앱은 서버가 막을 요청을
//  그대로 보내고 학생 화면에는 "권한이 없습니다" 가 뜬다. 이 앱에서
//  여러 번 일어난 사고라, 이제 어긋나면 빌드가 실패한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LIMITS, RULE_PROBES } from "../js/limits.js";

const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

/**
 * `match /이름/{...} { ... }` 한 덩어리만 잘라낸다.
 * 규칙 파일 전체에서 찾으면 같은 모양의 다른 컬렉션 규칙이 먼저 걸린다.
 * (name 길이를 찾다가 학생 명단의 40 을 잡는 식으로)
 */
function block(name) {
  const start = rules.search(new RegExp(`match /${name}/\\{`));
  assert.ok(start >= 0, `firestore.rules 에 ${name} 규칙이 없습니다.`);
  // "match /fish/{id} {" 에는 중괄호가 둘이다. 앞의 {id} 는 경로 이름이라
  // 그것부터 세면 한 글자 만에 짝이 맞아 버린다. 줄 끝의 여는 괄호부터 센다.
  const lineEnd = rules.indexOf("\n", start);
  const bodyStart = rules.lastIndexOf("{", lineEnd);
  let depth = 0;
  for (let i = bodyStart; i < rules.length; i++) {
    if (rules[i] === "{") depth++;
    else if (rules[i] === "}" && --depth === 0) return rules.slice(start, i + 1);
  }
  assert.fail(`${name} 규칙의 괄호가 닫히지 않았습니다.`);
}

/** 주어진 본문에서 정규식으로 숫자 하나를 꺼낸다. */
function num(text, re, what) {
  const m = text.match(re);
  assert.ok(m, `firestore.rules 에서 ${what} 를 찾지 못했습니다. ` +
    `규칙을 고쳤다면 tests/rules_match.test.mjs 의 정규식도 같이 봐주세요.`);
  return Number(m[1]);
}

test("어항 물고기: 그림 길이·밥 횟수·이름 길이가 앱과 같다", () => {
  const fish = block("fish");
  assert.equal(num(fish, /art\.size\(\)\s*>=\s*(\d+)/, "art 최소 길이"), LIMITS.fishArtMin);
  assert.equal(num(fish, /art\.size\(\)\s*<=\s*(\d+)/, "art 최대 길이"), LIMITS.fishArtMax);
  assert.equal(num(fish, /data\.fed\s*<=\s*(\d+)/, "fed 상한"), LIMITS.fishFedMax);
  assert.equal(num(fish, /cleanStr\(request\.resource\.data\.name,\s*(\d+)\)/, "물고기 이름 길이"),
    LIMITS.fishNameMax);
  assert.equal(num(fish, /cleanStr\(request\.resource\.data\.ownerId,\s*(\d+)\)/, "ownerId 길이"),
    LIMITS.ownerIdMax);
});

test("어항 밥 나눠주기: 누적 상한과 한 번에 늘릴 폭이 앱과 같다", () => {
  const grants = block("foodGrants");
  // 누적 상한은 파일에서 가장 큰 total 비교값이다(create 쪽의 한 번 폭과 구분)
  const totals = [...grants.matchAll(/data\.total\s*<=\s*(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(totals.length >= 2, "foodGrants 에 total 상한이 보이지 않습니다.");
  assert.equal(Math.max(...totals), LIMITS.foodGrantMax);
  assert.equal(
    num(grants, /data\.total\s*<=\s*resource\.data\.total\s*\+\s*(\d+)/, "한 번에 늘릴 폭"),
    LIMITS.foodGrantStep
  );
});

test("공통: 문서 키 개수와 소원 길이가 앱과 같다", () => {
  assert.equal(num(rules, /keys\(\)\.size\(\)\s*<=\s*(\d+)/, "문서 키 개수"), LIMITS.docKeysMax);
  assert.equal(num(rules, /get\('wish',\s*null\),\s*(\d+)\)/, "소원 길이"), LIMITS.wishMax);
});

test("앱 쪽 상수가 limits.js 를 그대로 쓴다", async () => {
  const src = readFileSync(new URL("../js/data.js", import.meta.url), "utf8");
  // 숫자를 손으로 다시 적어 두면 여기서 걸린다
  for (const [name, re] of [
    ["FISH_ART_MAX", /export const FISH_ART_MAX = ([^;]+);/],
    ["FISH_FED_MAX", /export const FISH_FED_MAX = ([^;]+);/],
    ["FOOD_GRANT_MAX", /export const FOOD_GRANT_MAX = ([^;]+);/],
    ["FOOD_GRANT_STEP", /export const FOOD_GRANT_STEP = ([^;]+);/],
  ]) {
    const m = src.match(re);
    assert.ok(m, `js/data.js 에 ${name} 이 없습니다.`);
    assert.match(m[1].trim(), /^LIMITS\./,
      `${name} 은 숫자를 직접 적지 말고 LIMITS 에서 가져와야 합니다. (지금: ${m[1].trim()})`);
  }
});

// 규칙에 컬렉션을 새로 만들어 놓고 확인 목록에 안 넣으면, 게시를 잊었을 때
// 아무도 모른 채 그 기능만 조용히 죽는다. 실제로 여러 번 그랬다.
// 새 컬렉션은 RULE_PROBES 에 넣거나, 아래 목록에 "확인 안 해도 되는 이유"를
// 적어야 한다. 둘 다 안 하면 여기서 빌드가 멈춘다.
const NO_PROBE_NEEDED = {
  databases: "규칙 파일의 최상위 경로",
  classes: "학급 문서 자체 — 학생 목록 확인으로 대신한다",
  students: "이미 열려 있던 자리(아래 SHOULD_WORK 쪽에서 본다)",
  secrets: "get 만 열려 있어 목록 조회로는 확인할 수 없다",
  meta: "docId 가 'state' 일 때만 열려 목록 조회가 원래 막혀 있다",
  reports: "선생님 화면에서만 쓰고, 목록은 예전부터 열려 있었다",
  voteItems: "이미 열려 있던 자리",
  voteWinners: "이미 열려 있던 자리",
  feedback: "이미 열려 있던 자리",
  adInquiries: "이미 열려 있던 자리",
};

test("규칙의 모든 컬렉션이 확인 목록이나 예외 목록에 있다", () => {
  const inRules = [...new Set(
    [...rules.matchAll(/match \/([A-Za-z]+)\/\{/g)].map((m) => m[1])
  )];
  const probed = new Set(RULE_PROBES.map((r) => r.path[r.path.length - 1]));
  const missing = inRules.filter((c) => !probed.has(c) && !(c in NO_PROBE_NEEDED));
  assert.deepEqual(missing, [],
    `규칙에 있는데 어디에도 안 적힌 컬렉션: ${missing.join(", ")}\n` +
    `js/limits.js 의 RULE_PROBES 에 넣거나, 이 테스트의 NO_PROBE_NEEDED 에 ` +
    `확인하지 않아도 되는 이유를 적어주세요.`);
});
