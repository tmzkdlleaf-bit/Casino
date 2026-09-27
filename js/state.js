import { CALM_KEY, SUITS } from "./config.js";

export const mqReduce = matchMedia("(prefers-reduced-motion: reduce)");

export const mqFine = matchMedia("(hover: hover) and (pointer: fine)");

export const state = { isAdmin: false, session: null, profile: null, mine: [], calm: false, filter: "dealer", reelPaused: false, noticeFilter: "전체", invItems: [], admDirty: false };

// mine: 내 소유 캐릭터 [{uuid, balance}]
try { state.calm = localStorage.getItem(CALM_KEY) === "1"; } catch (_) {}

export const motionOK = () => !mqReduce.matches && !state.calm;

// 인벤토리 칸 수
export function PROFILE_DUMMY(){
  return {
    age: "나이 자리", height: "키 자리",
    keywords: ["키워드", "키워드", "키워드"],
    description: "짧은 설명글 자리입니다.",
    inventory: Array.from({ length: 4 }, (_, i) => ({ name: "소지품 이름", quantity: i === 0 ? 3 : 1, note: i === 1 ? "캐릭터별 메모 자리" : "", description: "아이템 설명 자리", img: "" }))
  };
}

export const DATA = {
  // notice_categories / notices
  categories: ["분류 1", "분류 2", "분류 3"],
  notices: Array.from({ length: 7 }, (_, i) => ({
    id: "n" + (7 - i), date: "0000.00.00", title: i < 2 ? "고정 공지 제목 자리" : "공지 제목 자리",
    body: "공지 본문 자리입니다.", category: ["분류 1", "분류 2", "분류 3"][i % 3], pinned: i < 2, pinOrder: i
  })),
  // characters (+ inventory). id = slug
  dealers: Array.from({ length: 7 }, (_, i) => ({ id: "d" + (i + 1), name: "딜러 이름", role: "딜러", suit: SUITS[i % 4], img: "", ...PROFILE_DUMMY() })),
  players: Array.from({ length: 7 }, (_, i) => ({ id: "p" + (i + 1), name: "참가자 이름", role: "참가자", chip: i % 2 ? "red" : "green", img: "", ...PROFILE_DUMMY() })),
  world: Array.from({ length: 4 }, (_, i) => ({ id: "w" + (i + 1), title: "항목 제목 " + (i + 1) })),
  chapters: Array.from({ length: 5 }, (_, i) => ({ number: i + 1, title: "회차 제목", summary: "요약 자리입니다.", date: "0000.00.00" })),
  items: Array.from({ length: 8 }, () => ({ name: "아이템 이름", price: 0 })),
  // game_slots — 홈 '다음 게임'
  slots: []
};

/* 라우터 상태 — 여러 모듈이 읽고 router가 갱신 */
export const nav = { current: null, key: null, lastProfile: null, listScroll: 0 };
