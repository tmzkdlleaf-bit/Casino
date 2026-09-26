import { SITE_NAME } from "./config.js";

export const setTitle = t => { document.title = t ? `${t} | ${SITE_NAME}` : SITE_NAME; };

/* ---------- helpers ---------- */
export const $ = (s, r = document) => r.querySelector(s);

export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

export const isRed = s => s === "♥" || s === "♦";

export function toast(msg){
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200);
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
  el.style.setProperty("--len", Math.max(1, [...text.replace(/\s/g, "")].length));   // 히어로 제목: 글자 수에 맞춰 화면 폭을 채움
  el.innerHTML = `<span class="sr">${esc(text)}</span><span aria-hidden="true">` + [...text].map((ch, i) =>
    ch === " " ? " " : `<span class="clip"><span class="ch" style="--i:${i}">${esc(ch)}</span></span>`
  ).join("") + `</span>`;
}

/* 이미지가 없을 때 보이는 자리표시 글자는 보조기기에서 숨김 */
export const ph = (t = "이미지") => `<span aria-hidden="true">${t}</span>`;
