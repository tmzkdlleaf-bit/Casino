import { SITE_NAME } from "./config.js?v=20261029c";

export const setTitle = t => { document.title = t ? `${t} | ${SITE_NAME}` : SITE_NAME; };

/* ---------- helpers ---------- */
export const $ = (s, r = document) => r.querySelector(s);

export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

export const isRed = s => s === "♥" || s === "♦";
/* 수트 기호 → SVG 아이콘 (index.html의 스프라이트 사용) */
const SUIT_ID = { "♠": "spade", "♥": "heart", "♣": "club", "♦": "diamond" };
export const suitIcon = (s, cls = "") => `<svg class="suit-ico ${cls}" aria-hidden="true" focusable="false"><use href="#s-${SUIT_ID[s] || "spade"}"/></svg>`;

export function toast(msg, ms = 2200){
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), ms);
}

/* 화면 밖 공지 (스크린리더) */
export function announce(msg){
  const r = $("#sr-status");
  r.textContent = "";
  setTimeout(() => { r.textContent = msg; }, 60);
}

/* 글자 단위로 쪼개 순차 등장
   aria-label 대신 숨김 텍스트를 둠 — <p> 등 일반 요소의 aria-label은 ARIA 1.2에서 금지 */
export function splitText(el){
  if (!el.dataset.text) el.dataset.text = el.textContent.trim();
  const text = el.dataset.text;
  el.removeAttribute("aria-label");
  el.innerHTML = `<span class="sr">${esc(text)}</span><span aria-hidden="true">` + [...text].map((ch, i) =>
    ch === " " ? " " : `<span class="clip"><span class="ch" style="--i:${i}">${esc(ch)}</span></span>`
  ).join("") + `</span>`;
}

/* 이미지가 없을 때 보이는 자리표시 글자는 보조기기에서 숨김 */
export const ph = (t = "이미지") => `<span aria-hidden="true">${t}</span>`;

/* =========================================================
   코인 두 종류 (update-12.sql): blue = 블루 코인, pink = 핑크 코인 — 서로 바꿀 수 없음
   ========================================================= */
export const CUR = { blue: { name: "블루 코인", short: "블루", chip: "green" }, pink: { name: "핑크 코인", short: "핑크", chip: "red" } };
export const curOf = c => (c === "pink" ? "pink" : "blue");
/* 코인 수 + 색 동그라미 (화면 읽기 프로그램에는 코인 이름도 읽어 줌) */
export function chipAmt(amount, cur = "blue", sign = false){
  const k = curOf(cur), v = Number(amount || 0);
  return `<span class="amt amt-${k}" title="${CUR[k].name}"><i class="chip ${CUR[k].chip}" aria-hidden="true"></i>${sign && v > 0 ? "+" : ""}${v.toLocaleString("ko-KR")}<span class="sr"> ${CUR[k].name}</span></span>`;
}
export const chipText = (amount, cur = "blue") => `${CUR[curOf(cur)].name} ${Number(amount || 0).toLocaleString("ko-KR")}`;
