import { HERO_CHIPS, SUITS } from "./config.js";
import { $, $$, isRed, splitText, suitIcon } from "./dom.js";
import { DATA, motionOK, state } from "./state.js";
import { placeSegInk } from "./views.js";

/* ---------- effects ---------- */

/* 슬라이딩 밑줄 */
export function moveInk(container, active, ink){
  if (!active) { ink.style.width = "0"; return; }
  ink.style.left = active.offsetLeft + "px";
  ink.style.width = active.offsetWidth + "px";
}

/* 홈에 떨어지는 칩 */
export function renderHeroChips(){
  $("#hero-chips").innerHTML = HERO_CHIPS.map(([l, t, size, c, r, tx, d]) =>
    `<span class="fall" style="left:${l}%;top:${t}%;--d:${d}s"><span class="chip ${c}" style="--size:${size}rem;--tx:${tx}deg;--r1:${r}deg"></span></span>`).join("");
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

export function applyCalm(){
  document.body.classList.toggle("calm", state.calm);
  $("#set-calm").checked = state.calm;
  if (state.calm) $$(".strip").forEach(m => m.classList.add("dealt"));
  applyReel();
}

/* 캐릭터 자동 넘김: 멈춤 버튼 / 애니메이션 끄기 / 동작 줄이기 설정이면 멈추고 손으로 넘기는 줄이 됨 (WCAG 2.2.2) */
export function applyReel(){
  const reel = $("#reel"), btn = $("#reel-toggle");
  if (!reel) return;
  const still = !motionOK();
  reel.classList.toggle("static", still);
  reel.classList.toggle("paused", state.reelPaused);
  btn.hidden = still;
  btn.setAttribute("aria-pressed", String(state.reelPaused));
}

/* ---------- intro ----------
   0.15s 칩 착지 + 고리 파동 → 0.95s 카드가 사방에서 날아와 모임 → 1.75s 부채꼴
   → 2.05s 뒤집힘 → 2.2s 칩 폭발·불티·섬광 → 2.3s 이름 → 2.95s 금빛 훑기 → 3.7s 막이 열림 */
const R = (a, b) => a + Math.random() * (b - a);

function buildIntro(stage){
  const n = 9, mid = (n - 1) / 2;
  const cards = Array.from({ length: n }, (_, i) => {
    const off = i - mid, s = SUITS[i % 4];
    const ang = R(0, Math.PI * 2), dist = R(70, 95);
    return `<span class="icard" style="--i:${i};--sr:${R(-4, 4).toFixed(1)}deg;--fx:${(Math.cos(ang) * dist).toFixed(1)}vw;--fy:${(Math.sin(ang) * dist).toFixed(1)}vh;--fr:${R(-260, 260).toFixed(0)}deg;--rot:${off * 9}deg;--lift:${(Math.abs(off) * .45).toFixed(2)}rem;z-index:${10 - Math.abs(Math.round(off))}">
      <span class="flipper"><span class="side card-back"></span>
      <span class="side pcard ${isRed(s) ? "red-suit" : ""}"><span class="pip tl">${suitIcon(s)}</span><span class="big">${suitIcon(s)}</span><span class="pip br">${suitIcon(s)}</span></span></span></span>`;
  }).join("");
  const colors = ["red", "green", "", "red", ""];
  const chips = Array.from({ length: 18 }, (_, i) => {
    const ang = (i / 18) * Math.PI * 2 + R(-.2, .2), dist = R(42, 78), sz = R(1.6, 4.2).toFixed(2);
    return `<span class="chip bchip ${colors[i % colors.length]}" style="--sz:${sz}rem;--t:${R(2.18, 2.3).toFixed(2)}s;--bx:${(Math.cos(ang) * dist).toFixed(1)}vmax;--by:${(Math.sin(ang) * dist).toFixed(1)}vmax;--rx:${R(40, 80).toFixed(0)}deg;--rz:${R(-720, 720).toFixed(0)}deg"></span>`;
  }).join("");
  const sparks = Array.from({ length: 34 }, () => {
    const ang = R(0, Math.PI * 2), dist = R(14, 44);
    return `<i class="spark" style="--t:${R(2.18, 2.45).toFixed(2)}s;--bx:${(Math.cos(ang) * dist).toFixed(1)}vmax;--by:${(Math.sin(ang) * dist).toFixed(1)}vmax"></i>`;
  }).join("");
  const name = $(".mark-name").textContent.trim() || document.title;
  stage.innerHTML = `
    <div class="glow"></div>
    <span class="ring" style="--t:.9s;--s:5"></span>
    <span class="chip red big-chip"></span>
    <div class="deck">${cards}</div>
    <div class="flash" style="--t:2.18s"></div>
    <span class="ring" style="--t:2.2s;--s:9"></span>
    <span class="ring" style="--t:2.32s;--s:6"></span>
    <div class="burst">${chips}${sparks}</div>
    <p class="intro-name split" data-text="${name.replace(/"/g, "&quot;")}"></p>
    <span class="intro-line"></span>`;
  const p = $(".intro-name", stage);
  splitText(p);
  p.insertAdjacentHTML("beforeend", `<span class="shine" aria-hidden="true">${p.dataset.text.replace(/</g, "&lt;")}</span>`);
}

export function runIntro({ force = false } = {}){
  const intro = $("#intro"), stage = $("#intro-stage");
  let seen = false;
  try { seen = sessionStorage.getItem("intro-seen") === "1"; } catch (_) {}
  const q = new URLSearchParams(location.search).has("intro");
  const shell = [$("#skip-link"), $("#site-head"), $("#app")];
  const onKey = e => { if (e.key === "Escape") skip(); };   // Enter/Space는 '건너뛰기' 버튼이 받음
  let t1, t2, done = false;

  function finish(){
    const hadFocus = intro.contains(document.activeElement);
    document.body.classList.remove("intro-on");
    intro.hidden = true; intro.classList.remove("out");
    stage.innerHTML = "";
    shell.forEach(el => el.inert = false);
    removeEventListener("keydown", onKey);
    intro.removeEventListener("click", skip);
    if (hadFocus) $("#skip-link").focus({ preventScroll: true });   // 버튼이 사라져도 포커스가 문서 맨 앞에 남도록
    try { sessionStorage.setItem("intro-seen", "1"); } catch (_) {}
  }
  function open(){
    intro.classList.add("out");
    document.body.classList.remove("intro-on");                      // 막이 열리는 순간 홈의 칩·제목이 움직이기 시작
  }
  function skip(){
    if (done) return; done = true;
    clearTimeout(t1); clearTimeout(t2);
    open();
    setTimeout(finish, 900);
  }

  if (!force && ((seen && !q) || !motionOK())){ finish(); return; }

  if (!$(".curtain", intro)) intro.insertAdjacentHTML("afterbegin", `<div class="curtain top"></div><div class="curtain bottom"></div>`);
  buildIntro(stage);
  intro.hidden = false;
  document.body.classList.add("intro-on");
  // 재생 중에는 뒤쪽 화면을 조작 불가로 — 가려진 요소에 포커스가 가지 않게 (WCAG 2.4.11)
  shell.forEach(el => el.inert = true);
  if (force) $("#intro-skip").focus({ preventScroll: true });

  t1 = setTimeout(() => { done = true; open(); }, 3700);
  t2 = setTimeout(finish, 4600);
  intro.addEventListener("click", skip);
  addEventListener("keydown", onKey);
}
