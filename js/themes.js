// =============================================================
//  테마 목록
// =============================================================
//  예전에는 "뽀로로 모드" 토글 버튼 하나뿐이었지만, 테마가 늘어나면서
//  탭에서 골라 쓰는 방식으로 바꿨습니다. 각 테마는 body 에 붙는 클래스
//  하나로 표현되고, 실제 배색은 styles.css 에서 CSS 변수로 갈아끼웁니다.
//
//  preview 는 테마 고르기 화면의 "작은 화면" 미리보기에 쓰는 값입니다.
//  색 막대 세 칸만 보여주면 실제로 어떤 화면이 되는지 알 수 없어서,
//  상단바 · 카드 · 버튼까지 갖춘 축소판 UI를 그리고 그 축소판에
//  아래 값들을 CSS 변수로 그대로 흘려 넣습니다. 그래서 미리보기는
//  테마를 "설명"하는 게 아니라 테마 그 자체로 칠해집니다.
// =============================================================

export const THEMES = [
  {
    id: "default",
    name: "기본",
    group: "기본",
    tagline: "애플처럼 담백한 유리 화면",
    swatch: ["#f5f5f7", "#0a84ff", "#1d1d1f"],
    preview: {
      kind: "default",
      bg: "linear-gradient(160deg, #f7f7f9 0%, #eef1f6 100%)",
      ink: "#1d1d1f",
      muted: "#a1a1a6",
      card: "rgba(255, 255, 255, 0.66)",
      edge: "rgba(255, 255, 255, 0.95)",
      accent: "#0a84ff",
      onAccent: "#ffffff",
      radius: "9px",
      blur: "5px",
      shadow: "0 5px 14px rgba(0, 0, 0, 0.10)",
      spec: "rgba(255, 255, 255, 0.85)",
    },
  },
  {
    id: "pororo",
    name: "뽀로로 (테무산)",
    group: "재미",
    tagline: "어디서 본 듯한 짝퉁 펭귄과 얼음처럼 성에 낀 유리",
    swatch: ["#bfe6ff", "#ffffff", "#ff8a00"],
    note: "켜두면 펭귄이 계속 끼어듭니다",
    preview: {
      kind: "pororo",
      bg: "linear-gradient(165deg, #d3edff 0%, #b3e0ff 100%)",
      ink: "#0b2d4a",
      muted: "#4d7fa3",
      card: "rgba(255, 255, 255, 0.60)",
      edge: "#0b2d4a",
      accent: "#ff8a3d",
      onAccent: "#0b2d4a",
      radius: "7px",
      blur: "6px",
      shadow: "3px 3px 0 #0b2d4a",
      spec: "rgba(255, 255, 255, 0.9)",
    },
  },

  // ---- 독일 ----
  //  국기(흑적금)와 독일제국기(흑백적), 비스마르크, 브란덴부르크 문·쾰른
  //  대성당·라이히스탁을 한 화면에 담은 대형 테마. 밤의 금박 유리 화면.
  {
    id: "germany",
    name: "독일",
    group: "독일",
    era: "제국의 독수리부터 오늘의 흑·적·금까지",
    tagline: "종이빛 유리 · 브란덴부르크 문 · 비스마르크 · 두 개의 국기",
    swatch: ["#f1efea", "#8a6a12", "#c8102e"],
    preview: {
      kind: "germany",
      bg: "linear-gradient(180deg, #f6f4f0 0%, #f1efea 60%, #e8e4da 100%)",
      ink: "#1a1a1c",
      muted: "#8d887e",
      card: "rgba(255, 255, 255, 0.72)",
      edge: "rgba(138, 106, 18, 0.4)",
      accent: "linear-gradient(180deg, #c8102e 0%, #8f0b20 100%)",
      onAccent: "#ffffff",
      radius: "8px",
      blur: "7px",
      shadow: "0 5px 14px rgba(60, 48, 20, 0.16)",
      spec: "rgba(255, 255, 255, 0.9)",
    },
  },

  // ---- 리퀴드 글라스 ----
  //  테두리를 긋지 않고 위아래 가장자리만 눌러 유리처럼 보이게 하는 단색 테마.
  //  · 흰 배경, 검은 글자, 회색 한 단계뿐이고 파랑·금색 같은 강조색이
  //    화면 어디에도 남지 않는다.
  //  · 다른 테마와 달리 화면에 요소를 새로 얹지 않는다(독일 테마의 무대,
  //    뽀로로의 눈·마스코트 같은 것이 없다). 배색과 질감만 바꾼다.
  {
    id: "mono",
    name: "리퀴드 글라스",
    group: "기본",
    tagline: "",
    swatch: ["#ffffff", "#6b6b6b", "#0a0a0a"],
    preview: {
      kind: "mono",
      bg: "#ffffff",
      ink: "#0a0a0a",
      muted: "#a6a6a6",
      card: "rgba(255, 255, 255, 0.6)",
      edge: "rgba(0, 0, 0, 0.14)",
      accent: "rgba(255, 255, 255, 0.75)",
      onAccent: "#0a0a0a",
      radius: "6px",
      blur: "8px",
      shadow: "0 5px 14px rgba(0, 0, 0, 0.1)",
      spec: "rgba(255, 255, 255, 0.95)",
    },
  },
];

export const THEME_IDS = THEMES.map((t) => t.id);
export const DEFAULT_THEME = "default";
export const isTheme = (id) => THEME_IDS.includes(id);
export const getTheme = (id) => THEMES.find((t) => t.id === id) || THEMES[0];

// 화면에서 묶어 보여줄 순서
export const THEME_GROUPS = ["기본", "재미", "독일"];

// 참고(코드에만 남김): 1933~1945년 나치 독일의 상징은 독일 형법 86a조가
// 지금도 전시를 금지하는 혐오 표식이라 이 테마에 넣지 않았습니다.
// 화면에는 따로 안내를 띄우지 않습니다.
