import { $, $$, splitText } from "./dom.js";
import { DATA, motionOK, mqFine, state } from "./state.js";
import { placeSegInk } from "./views.js";

/* ---------- effects ---------- */

/* 슬라이딩 밑줄 */
export function moveInk(container, active, ink){
  if (!active) { ink.style.width = "0"; return; }
  ink.style.left = active.offsetLeft + "px";
  ink.style.width = active.offsetWidth + "px";
}

export function moveNavInk(){
  const nav = $("#nav"), a = $('#nav a[aria-current="page"]'), ink = $(".nav-ink", nav);
  if (!a) return moveInk(nav, null, ink);
  const pad = parseFloat(getComputedStyle(a).paddingLeft);
  ink.style.left = (a.offsetLeft + pad) + "px";
  ink.style.width = (a.offsetWidth - pad * 2) + "px";
}

/* 헤더 배경 */
export function onScroll(){ $("#site-head").classList.toggle("scrolled", scrollY > 40); }

/* 히어로: 커서 조명 + 칩 시차 */
export function bindHero(){
  const hero = $("#hero");
  let raf = 0;
  hero.addEventListener("pointermove", e => {
    if (!mqFine.matches) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const r = hero.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      hero.style.setProperty("--mx", x * 100 + "%");
      hero.style.setProperty("--my", y * 100 + "%");
      if (motionOK()){
        hero.style.setProperty("--px", ((x - .5) * 2).toFixed(3));
        hero.style.setProperty("--py", ((y - .5) * 2).toFixed(3));
      }
    });
  });
  hero.addEventListener("pointerleave", () => { hero.style.setProperty("--px", 0); hero.style.setProperty("--py", 0); });
}

/* 펠트 면 위 조명 */
export function bindSpots(){
  document.addEventListener("pointermove", e => {
    if (!mqFine.matches) return;
    const el = e.target.closest("[data-spot]");
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", e.clientX - r.left + "px");
    el.style.setProperty("--my", e.clientY - r.top + "px");
  }, { passive: true });
}

/* 자석 버튼 */
export function bindMagnetic(){
  document.addEventListener("pointermove", e => {
    if (!mqFine.matches || !motionOK()) return;
    const b = e.target.closest(".magnetic");
    $$(".magnetic.pulled").forEach(x => { if (x !== b){ x.classList.remove("pulled"); x.style.setProperty("--tx","0px"); x.style.setProperty("--ty","0px"); }});
    if (!b) return;
    const r = b.getBoundingClientRect();
    b.classList.add("pulled");
    b.style.setProperty("--tx", (e.clientX - r.left - r.width / 2) * .25 + "px");
    b.style.setProperty("--ty", (e.clientY - r.top - r.height / 2) * .35 + "px");
  }, { passive: true });
}

/* 화면에 들어오면 스트립이 아래에서 열림 */
export let dealIO;

export function deal(){
  // clip-path로 가려진 요소는 교차 판정이 안 되므로 부모 컨테이너를 관찰
  const rows = $$('[data-page="characters"] .strips');
  if (!motionOK() || !("IntersectionObserver" in window)){
    $$(".strip", rows[0]?.closest("section")).forEach(m => m.classList.add("dealt"));
    return;
  }
  dealIO?.disconnect();
  dealIO = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      $$(".strip", en.target).forEach(m => m.classList.add("dealt"));
      dealIO.unobserve(en.target);
    });
  }, { threshold: .2 });
  rows.forEach(r => dealIO.observe(r));
}

/* 세계관 목차 스크롤 추적 */
export let spyIO;

export function bindSpy(){
  spyIO?.disconnect();
  spyIO = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      $$("#world-toc a").forEach(a => {
        const on = a.dataset.jump === en.target.id;
        a.classList.toggle("active", on);
        on ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current");
      });
    });
  }, { rootMargin: "-40% 0px -55% 0px" });
  $$("#world-body section").forEach(s => spyIO.observe(s));
}

/* 캐릭터 필터 */
export function applyFilter(){
  $$("#seg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.filter === state.filter));
  $$(".cast-group").forEach(g => g.hidden = !(state.filter === "all" || g.dataset.group === state.filter));
  placeSegInk($("#seg"));
}

export function filterSummary(){
  const d = DATA.dealers.length, p = DATA.players.length;
  return state.filter === "dealer" ? `딜러 ${d}명 표시` : state.filter === "player" ? `참가자 ${p}명 표시` : `전체 ${d + p}명 표시`;
}

/* ---------- 모바일 메뉴 ---------- */
export const SHELL = () => [$("#app"), $(".site-foot"), $("#skip-link")];

export function setMenu(open, { restoreFocus = true } = {}){
  const head = $("#site-head"), btn = $("#menu-btn");
  if (open === head.classList.contains("open")) return;
  head.classList.toggle("open", open);
  btn.setAttribute("aria-expanded", open);
  document.body.classList.toggle("menu-open", open);
  SHELL().forEach(el => el.inert = open);     // 메뉴가 열린 동안 뒤쪽 콘텐츠로 포커스가 새지 않게
  if (open) $("#nav a:not([hidden])")?.focus();
  else if (restoreFocus) btn.focus();
}

export function applyCalm(){
  document.body.classList.toggle("calm", state.calm);
  $("#set-calm").checked = state.calm;
  if (state.calm) $$(".strip").forEach(m => m.classList.add("dealt"));
}

/* ---------- intro ---------- */
export function runIntro(){
  const intro = $("#intro");
  let seen = false;
  try { seen = sessionStorage.getItem("intro-seen") === "1"; } catch (_) {}
  const force = new URLSearchParams(location.search).has("intro");

  const shell = [$("#skip-link"), $("#site-head"), $("#app"), $(".site-foot")];
  const onKey = e => { if (e.key === "Escape") skip(); };   // Enter/Space는 '건너뛰기' 버튼이 받음
  const finish = () => {
    document.body.classList.remove("intro-on");
    const hadFocus = intro.contains(document.activeElement);
    intro.remove();
    shell.forEach(el => el.inert = false);
    removeEventListener("keydown", onKey);
    if (hadFocus) $("#skip-link").focus({ preventScroll: true });   // 버튼이 사라져도 포커스가 문서 맨 앞에 남도록
    try { sessionStorage.setItem("intro-seen", "1"); } catch (_) {}
  };

  if ((seen && !force) || !motionOK()){ finish(); return; }
  // 재생 중에는 뒤쪽 화면을 조작 불가로 — 가려진 요소에 포커스가 가지 않게 (WCAG 2.4.11)
  shell.forEach(el => el.inert = true);

  // 카드 5장: 흩어진 위치에서 모였다가 부채꼴로 펼침
  const n = 5, mid = (n - 1) / 2;
  $("#deck").innerHTML = Array.from({ length: n }, (_, i) => {
    const off = i - mid, top = i === Math.round(mid);
    const fx = (Math.random() - .5) * 120 + "vw", fy = (Math.random() > .5 ? 1 : -1) * (60 + Math.random() * 20) + "vh";
    return `<span class="icard ${top ? "top" : ""}" style="--i:${i};--sr:${(Math.random() - .5) * 8}deg;--fx:${fx};--fy:${fy};--fr:${(Math.random() - .5) * 200}deg;--rot:${off * 11}deg;--lift:${Math.abs(off) * .4}rem;z-index:${top ? 9 : i}">
      <span class="flipper">
        <span class="side card-back"></span>
        <span class="side pcard red-suit"><span class="pip tl">♥</span><span class="big">♥</span><span class="pip br">♥</span></span>
      </span>
    </span>`;
  }).join("");
  $$(".split", intro).forEach(splitText);

  let done = false;
  const release = setTimeout(() => document.body.classList.remove("intro-on"), 3500);  // 막이 열리는 순간 히어로 재생
  const end = setTimeout(() => { done = true; finish(); }, 4600);

  function skip(){
    if (done) return; done = true;
    clearTimeout(release); clearTimeout(end);
    intro.classList.add("skip");
    document.body.classList.remove("intro-on");
    setTimeout(finish, 750);
  }
  // 기존: keydown에 { once:true } — Tab 등 다른 키를 먼저 누르면 리스너가 사라져 Esc가 먹지 않던 문제 수정
  intro.addEventListener("click", skip);
  addEventListener("keydown", onKey);
}
