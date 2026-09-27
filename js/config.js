/* =========================================================
   CONFIG
   관리자 여부는 로그인한 계정의 profiles.role 로 판정합니다.
   권한의 실제 차단은 DB(RLS, supabase/setup.sql)에서 이뤄지고, 여기서는 화면만 나눕니다.
   ========================================================= */
export const CONFIG = {
  // 공개용 anon 키. service_role 키는 절대 넣지 말 것
  SUPABASE_URL: "https://fuyfqejfqoflygvymbhp.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1eWZxZWpmcW9mbHlndnltYmhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4OTI5MTAsImV4cCI6MjA5NjQ2ODkxMH0.Bb3eevn__xlaILyKywMvZ6maIgaKMCFYBu6dv9BJtr4",
  PASSWORD_MIN: 8,
  // 업로드 이미지 규격 (가로·세로 중 긴 변 px). WebP로 변환해 저장
  IMG: { character: 1600, characterThumb: 640, item: 512 },

  // 세계관 배경 이미지 — 화면 전체에 흐리게 깔림. 비우면 안개만 표시
  //   예) "assets/bg.webp" (저장소에 파일을 넣은 경우) 또는 https:// 로 시작하는 주소
  BG_IMAGE: "",
  // 배경음악 — 오른쪽 아래 버튼으로 켜고 끔. 비우면 버튼이 나타나지 않음. 방문자가 누르기 전에는 재생하지 않음
  //   예) "assets/bgm.mp3"
  BGM_URL: "",
  BGM_VOLUME: 0.35,

  // 홈 '바로가기' — label: 보이는 이름, href: 주소(비우면 '준비 중'으로 표시)
  //   사이트 안: "#world"  /  바깥: "https://..." (새 창으로 열림)
  QUICK_LINKS: [
    { label: "룰·가이드",   href: "" },
    { label: "세계관",      href: "#world" },
    { label: "신청서 양식", href: "" },
    { label: "캐입 계정",   href: "" },
    { label: "게임 규칙",   href: "#game" },
    { label: "상점",        href: "#shop" }
  ]
};

/* 홈에 떨어져 있는 칩: [가로%, 세로%, 크기rem, 색, 회전deg, 기울기deg, 지연s] */
export const HERO_CHIPS = [
  [36,  8, 4.2, "",      18, 55, .00],
  [49, 15, 2.8, "red",  -30, 30, .10],
  [47, 24, 5.2, "",      -8, 60, .18],
  [57, 36, 3.2, "green", 40, 20, .28],
  [30, 20, 2.4, "red",   12, 65, .36],
  [44, 46, 6.0, "",     -22, 40, .44],
  [56, 58, 3.4, "red",   64, 50, .56],
  [21,  9, 3.0, "green", 20, 58, .62]
];

export const SITE_NAME = "사이트명";

// 문서 제목(탭 이름)에 쓰임
export const PAGE_TITLES = { home: "", characters: "캐릭터", world: "세계관", story: "지난 이야기", shop: "상점", game: "게임", settings: "설정", admin: "관리", notices: "공지", login: "로그인", password: "비밀번호", notfound: "없는 페이지" };

export const CALM_KEY = "comu-calm";
export const BGM_KEY = "comu-bgm";

/* ---------- 더미 데이터 (Supabase 테이블로 교체) ---------- */
export const SUITS = ["♠", "♥", "♣", "♦"];

export const INVENTORY_SLOTS = 12;



/* ---------- router ----------
   #home  #characters  #characters/d3  #notices  #notices/n2  #world ...
   ------------------------------------------------------------------ */
export const PAGES = ["home","characters","world","story","shop","game","settings","admin","notices","login","password"];
