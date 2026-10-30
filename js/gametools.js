/* =========================================================
   게임 화면 오른쪽 위 도구 (룰렛 · 블랙잭 공통)
   - 소리: 스피커 단추 → 눌러 펼치면 크기 막대
   - 메뉴: … 단추 → 방장·관리 기능을 한곳에 (자주 쓰는 '시작'은 아래 버튼 줄에)
   ========================================================= */
import { $, $$ } from "./dom.js?v=20261031a";
import { sfxVol } from "./sfx.js?v=20261031a";

const ICON_VOL = on => `<svg viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/>${on
  ? `<path d="M11 5h1v1h1v4h-1v1h-1v-1h1V6h-1z" fill="currentColor"/><path d="M13 3h1v1h1v8h-1v1h-1v-1h1V4h-1z" fill="currentColor" opacity=".6"/>`
  : `<path d="M11 6h1v1h1V6h1v1h-1v1h1v1h-1V8h-1v1h-1V8h1V7h-1z" fill="currentColor"/>`}</svg>`;
const ICON_MENU = `<svg viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><path d="M2 3h12v2H2zM2 7h12v2H2zM2 11h12v2H2z" fill="currentColor"/></svg>`;

/* 처음 한 번 틀을 그림 (막대를 끄는 중에 다시 그려져 손에서 빠지지 않게) */
export function toolsFrame(box, volId){
  if ($(".g-menu-list", box)) return;
  const v = Math.round(sfxVol() * 100);
  box.innerHTML = `
    <details class="g-pop g-vol"><summary class="g-ico" title="효과음" aria-label="효과음 크기">${ICON_VOL(v > 0)}</summary>
      <div class="g-drop"><label class="rl-vol"><span>소리</span><input type="range" id="${volId}" min="0" max="100" step="10" value="${v}" aria-label="효과음 크기"><output>${v || "끔"}</output></label></div></details>
    <details class="g-pop g-more" hidden><summary class="g-ico" title="메뉴" aria-label="메뉴">${ICON_MENU}</summary>
      <div class="g-drop g-menu-list" role="menu"></div></details>`;
  box.addEventListener("input", e => { if (e.target.type === "range") $(".g-vol summary", box).innerHTML = ICON_VOL(+e.target.value > 0); });
  box.addEventListener("click", e => { if (e.target.closest(".g-menu-list button")) setTimeout(() => { $(".g-more", box).open = false; }, 0); });
}
/* 메뉴 항목 채우기. 항목이 없으면 메뉴 단추를 숨김 */
export function toolsMenu(box, html){
  const list = $(".g-menu-list", box);
  if (list.dataset.h === html) return;
  list.innerHTML = html; list.dataset.h = html;
  $(".g-more", box).hidden = !html.trim();
}
/* 바깥을 누르거나 Esc 면 닫힘 */
document.addEventListener("click", e => { $$("details.g-pop[open]").forEach(d => { if (!d.contains(e.target)) d.open = false; }); });
document.addEventListener("keydown", e => { if (e.key === "Escape") $$("details.g-pop[open]").forEach(d => { d.open = false; d.querySelector("summary").focus(); }); });

/* 아래 버튼 줄 단축키: 글자를 누르면 그 버튼 (입력칸에 쓰는 중엔 안 함) */
export function hotkeys(page, bar){
  document.addEventListener("keydown", e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (document.querySelector(`[data-page="${page}"]`)?.hidden) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable], dialog")) return;
    const b = $(`[data-key="${e.key.toLowerCase()}"]`, $(bar));
    if (b && !b.disabled){ e.preventDefault(); b.click(); }
  });
}
export const kbd = k => `<kbd aria-hidden="true">${k.toUpperCase()}</kbd>`;
