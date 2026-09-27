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
  IMG: { character: 1600, characterThumb: 640, item: 512 }
};

export const SITE_NAME = "사이트명";

// 문서 제목(탭 이름)에 쓰임
export const PAGE_TITLES = { home: "", characters: "캐릭터", world: "세계관", story: "지난 이야기", shop: "상점", game: "게임", settings: "설정", admin: "관리", notices: "공지", login: "로그인", password: "비밀번호", notfound: "없는 페이지" };

export const CALM_KEY = "comu-calm";

/* ---------- 더미 데이터 (Supabase 테이블로 교체) ---------- */
export const SUITS = ["♠", "♥", "♣", "♦"];

export const INVENTORY_SLOTS = 12;



/* ---------- router ----------
   #home  #characters  #characters/d3  #notices  #notices/n2  #world ...
   ------------------------------------------------------------------ */
export const PAGES = ["home","characters","world","story","shop","game","settings","admin","notices","login","password"];
