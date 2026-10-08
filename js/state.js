import { CALM_KEY, SUITS } from "./config.js?v=20261009d";

export const mqReduce = matchMedia("(prefers-reduced-motion: reduce)");

export const mqFine = matchMedia("(hover: hover) and (pointer: fine)");

export const state = { isAdmin: false, session: null, profile: null, mine: [], calm: false, filter: "dealer", castPos: { dealer: 0, player: 0 }, reelPaused: false, recFilter: "전체", recLimit: 20, invItems: [], admDirty: false };

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
  // characters (+ inventory). id = slug
  dealers: Array.from({ length: 7 }, (_, i) => ({ id: "d" + (i + 1), uuid: "d" + (i + 1), name: "딜러 " + (i + 1), role: "딜러", suit: SUITS[i % 4], img: "", ...PROFILE_DUMMY() })),
  players: Array.from({ length: 7 }, (_, i) => ({ id: "p" + (i + 1), uuid: "p" + (i + 1), name: "참가자 " + (i + 1), role: "참가자", chip: i % 2 ? "red" : "green", img: "", ...PROFILE_DUMMY() })),
  chapters: Array.from({ length: 5 }, (_, i) => ({ number: i + 1, title: "회차 제목", summary: "요약 자리입니다.", date: "0000.00.00" })),
  items: Array.from({ length: 8 }, () => ({ name: "아이템 이름", price: 0 })),
  // game_slots — 홈 '다음 게임'
  slots: [],
  // game_records — 전적 (최신순)
  records: []
};

/* 더미 전적 (DB를 쓰지 않을 때만 보임) */
DATA.records = Array.from({ length: 26 }, (_, i) => {
  const games = ["블랙잭", "포커", "룰렛", "바카라"], w = (i % 3 ? DATA.players : DATA.dealers)[(i * 5) % 7];
  return { id: "r" + i, date: "0000.00.00", time: "00:00", iso: "", game: games[i % 4], winner: w,
    players: [DATA.players[i % 7].name, DATA.players[(i + 2) % 7].name], chips: (i % 4 ? 1 : -1) * (100 + i * 50), note: i % 5 ? "" : "메모 자리" };
});

/* 라우터 상태 — 여러 모듈이 읽고 router가 갱신 */
export const nav = { current: null, key: null, lastProfile: null, listScroll: 0 };
