import { HERO_CHIPS, SUITS } from "./config.js";
import { $, $$, esc, isRed, splitText, suitIcon } from "./dom.js";
import { DATA, motionOK, state } from "./state.js";
import { ALL, placeSegInk, renderCast } from "./views.js";

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

/* =========================================================
   캐릭터 캐러셀 — 다섯 명이 보이고 가운데가 가장 큼. 양 끝은 이어져 돎
   state.castPos[쪽] = 가운데 캐릭터 번호 (끄는 동안에는 소수)
   ========================================================= */
// 가운데에서 떨어진 칸 수별: 위치(카드 폭 배수), 크기, 투명도, 흑백, 밝기
const CC = { P: [0, .98, 1.84, 2.62, 3.3], S: [1, .8, .74, .68, .64], O: [1, .92, .62, 0, 0], G: [0, .8, 1, 1, 1], B: [1, .7, .5, .4, .4] };
const lerp = (t, a) => { const i = Math.min(Math.floor(t), a.length - 2), f = Math.min(t - i, 1); return a[i] + (a[i + 1] - a[i]) * f; };
const norm = (i, n) => ((i % n) + n) % n;
export const castList = () => state.filter === "player" ? DATA.players : DATA.dealers;
export function wrapOff(i, pos, n){ let o = norm(i - pos, n); if (o > n / 2) o -= n; return o; }
export const castStep = () => ($(".cc", $("#cc-track"))?.offsetWidth || 200) * CC.P[1];

export function layoutCast(instant = false){
  const cards = $$("#cc-track .cc"), n = cards.length;
  if (!n) return;
  const W = cards[0].offsetWidth;
  if (!W) return;                     // 화면에 안 보일 때는 다음에
  const pos = state.castPos[state.filter];
  cards.forEach((el, i) => {
    const off = wrapOff(i, pos, n), a = Math.min(Math.abs(off), 4), sign = off < 0 ? -1 : 1, prev = parseFloat(el.dataset.off);
    // 끝에서 끝으로 넘어가는 카드는 움직임 없이 바로 옮김
    if (instant || (!isNaN(prev) && Math.abs(off - prev) > n / 2)) el.classList.add("jump");
    el.dataset.off = off;
    el.style.setProperty("--x", (sign * lerp(a, CC.P) * W).toFixed(1) + "px");
    el.style.setProperty("--s", lerp(a, CC.S).toFixed(3));
    el.style.setProperty("--o", lerp(a, CC.O).toFixed(3));
    el.style.setProperty("--g", lerp(a, CC.G).toFixed(3));
    el.style.setProperty("--b", lerp(a, CC.B).toFixed(3));
    el.style.setProperty("--a", a.toFixed(2));
    el.style.zIndex = 100 - Math.round(a * 10);
    el.style.pointerEvents = a > 2.4 ? "none" : "";
    el.classList.toggle("is-center", a < .5);
    el.tabIndex = a < .5 ? 0 : -1;
    a < .5 ? el.removeAttribute("aria-hidden") : el.setAttribute("aria-hidden", "true");
  });
  requestAnimationFrame(() => requestAnimationFrame(() => cards.forEach(el => el.classList.remove("jump"))));
  const idx = norm(Math.round(pos), n), c = castList()[idx];
  $("#cc-count").innerHTML = `<b>${String(idx + 1).padStart(2, "0")}</b> / ${String(n).padStart(2, "0")}<span class="sr"> — ${esc(c.name)}</span>`;
  $("#cc-go").href = "#characters/" + c.id;
  $("#cc-go").setAttribute("aria-label", `${c.name} 프로필 보기`);
  $("#cc-chip").style.transform = `rotate(${Math.round(pos) * 60}deg)`;
}

export function castGo(d){
  if (castList().length < 2) return;
  state.castPos[state.filter] = Math.round(state.castPos[state.filter]) + d;
  layoutCast();
}
export function castGoIndex(i){
  const n = castList().length, pos = Math.round(state.castPos[state.filter]);
  state.castPos[state.filter] = pos + wrapOff(i, pos, n);
  layoutCast();
}
/* 특정 캐릭터를 가운데로 (그 캐릭터가 속한 쪽으로 전환) */
export function castSelect(id){
  for (const g of ["dealer", "player"]){
    const i = (g === "player" ? DATA.players : DATA.dealers).findIndex(c => c.id === id);
    if (i >= 0){ state.filter = g; state.castPos[g] = i; return; }
  }
}

/* 딜러 ↔ 참가자 전환 */
export function applyFilter({ instant = false, enter = false } = {}){
  $$("#seg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.filter === state.filter));
  placeSegInk($("#seg"));
  renderCast();
  layoutCast(true);
  const track = $("#cc-track");
  if (enter && !instant && motionOK()){ track.classList.remove("enter"); void track.offsetWidth; track.classList.add("enter"); }
}

export function filterSummary(){
  return state.filter === "player" ? `참가자 ${DATA.players.length}명` : `딜러 ${DATA.dealers.length}명`;
}

export function applyCalm(){
  document.body.classList.toggle("calm", state.calm);
  $("#set-calm").checked = state.calm;
  applyShow();
}

/* 홈 '딜러와 참가자': 한 명씩 약 1.4초 보였다가 다음 사람으로 겹쳐 바뀜 (반복)
   멈춤 버튼 / 마우스를 올리거나 키보드로 들어가면 멈춤 (WCAG 2.2.2)
   '애니메이션 끄기'·동작 줄이기 설정이면 자동으로 넘기지 않고 이전·다음 버튼으로만 */
const SHOW = { list: [], i: 0, layer: 0, timer: 0, hover: false, on: false, seq: 0 };
const HOLD = 1400, FADE = 800;

export function initShow(){
  SHOW.list = ALL(); SHOW.i = 0;
  const box = $("#show");
  const empty = !SHOW.list.length;
  $(".show-link", box).hidden = empty; $(".show-ctl", box).hidden = empty;
  $(".empty-note", box)?.remove();
  if (empty){ box.insertAdjacentHTML("beforeend", `<p class="empty-note">등록된 캐릭터가 없습니다.</p>`); return; }
  paint(0, true);
  applyShow();
}

function paint(i, instant = false){
  const box = $("#show"), c = SHOW.list[i];
  if (!c) return;
  const layers = $$(".show-img", box), next = instant ? layers[SHOW.layer] : layers[SHOW.layer ^ 1];
  const img = $("img", next), src = c.thumb || c.img || "";
  const seq = ++SHOW.seq;
  const apply = () => {
    if (seq !== SHOW.seq) return;                      // 그사이 다른 사람으로 넘어갔으면 무시
    if (!instant){ layers[SHOW.layer].classList.remove("on"); SHOW.layer ^= 1; }
    next.classList.add("on");
    box.classList.add("swap");
    setTimeout(() => {
      if (seq !== SHOW.seq) return;
      const dealer = c.role === "딜러";
      const mk = $(".show-mk", box);
      mk.className = "show-mk" + (dealer && isRed(c.suit) ? " red" : "");
      mk.innerHTML = dealer ? suitIcon(c.suit) : `<span class="chip ${c.chip}"></span>`;
      $("#show-nm").textContent = c.name;
      $("#show-role").textContent = c.role;
      $("#show-link").href = `#characters/${c.id}`;
      box.classList.remove("swap");
    }, instant ? 0 : 300);
  };
  img.hidden = !src;
  img.style.objectPosition = c.focus || "";   // 관리 화면에서 정한 초점 (없으면 CSS 기본값)
  if (src){ img.src = src; (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(apply); }
  else { img.removeAttribute("src"); apply(); }
  // 다음 사람 이미지는 미리 받아 둠
  const n = SHOW.list[(i + 1) % SHOW.list.length], pre = n && (n.thumb || n.img);
  if (pre){ const im = new Image(); im.decoding = "async"; im.src = pre; }
}

export function showStep(d){
  if (!SHOW.list.length) return;
  SHOW.i = (SHOW.i + d + SHOW.list.length) % SHOW.list.length;
  paint(SHOW.i);
  schedule();
}

function running(){ return SHOW.on && motionOK() && !state.reelPaused && !SHOW.hover && !document.hidden && SHOW.list.length > 1; }
function schedule(){
  clearTimeout(SHOW.timer);
  if (running()) SHOW.timer = setTimeout(() => showStep(1), HOLD + FADE);
}
export function showStart(){ SHOW.on = true; schedule(); }
export function showStop(){ SHOW.on = false; clearTimeout(SHOW.timer); }
export function setShowHover(on){ SHOW.hover = on; schedule(); }

export function applyShow(){
  const btn = $("#show-toggle"), auto = motionOK();
  btn.hidden = !auto;
  btn.setAttribute("aria-pressed", String(state.reelPaused));
  $(".sr", btn).textContent = state.reelPaused ? "자동 넘김 재생" : "자동 넘김 멈춤";
  $("#show").style.setProperty("--fade", auto ? FADE + "ms" : "0ms");
  schedule();
}

/* ---------- intro ----------
   0.15s 칩 착지 + 고리 파동 → 0.95s 카드가 사방에서 날아와 모임 → 1.75s 부채꼴
   → 2.05s 뒤집힘 → 2.2s 칩 폭발·불티·섬광 → 2.3s 이름 → 2.95s 금빛 훑기 → 3.7s 막이 열림 */
const R = (a, b) => a + Math.random() * (b - a);
const K = 1.6;   // 인트로 속도 배율 — CSS .opening의 --k와 같은 값

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
    setTimeout(finish, 900 * K);
  }

  if (!force && ((seen && !q) || !motionOK())){ finish(); return; }

  if (!$(".curtain", intro)) intro.insertAdjacentHTML("afterbegin", `<div class="curtain top"></div><div class="curtain bottom"></div>`);
  buildIntro(stage);
  intro.hidden = false;
  document.body.classList.add("intro-on");
  // 재생 중에는 뒤쪽 화면을 조작 불가로 — 가려진 요소에 포커스가 가지 않게 (WCAG 2.4.11)
  shell.forEach(el => el.inert = true);
  if (force) $("#intro-skip").focus({ preventScroll: true });

  t1 = setTimeout(() => { done = true; open(); }, 3700 * K);
  t2 = setTimeout(finish, 4600 * K);
  intro.addEventListener("click", skip);
  addEventListener("keydown", onKey);
}
