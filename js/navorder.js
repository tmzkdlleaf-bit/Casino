/* =========================================================
   하단 메뉴 순서 바꾸기 — 방문자마다 각자, 이 브라우저에만 저장
   PC: 아이콘을 끌어서 / 휴대폰: 길게 누른 뒤 끌어서 / 설정: 위·아래 버튼 (끌기 대체 수단, WCAG 2.5.7)
   '더보기' 버튼은 항상 맨 끝에 고정
   ========================================================= */
import { NAV_ORDER_KEY } from "./config.js?v=20261009c";
import { $, $$, announce, esc, toast } from "./dom.js?v=20261009c";

const nav = $("#nav");
const items = () => $$(":scope > a.il", nav);
const DEFAULT = items().map(a => a.getAttribute("href"));
const nameOf = a => a.querySelector(".tip")?.textContent.replace(/\s*\(새 글 있음\)/, "").trim() || a.getAttribute("href");

function load(){
  try { return JSON.parse(localStorage.getItem(NAV_ORDER_KEY) || "null"); } catch (_) { return null; }
}
function save(){
  const order = items().map(a => a.getAttribute("href"));
  try {
    if (order.join() === DEFAULT.join()) localStorage.removeItem(NAV_ORDER_KEY);
    else localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(order));
  } catch (_) {}
}

/* 저장된 순서 적용: 모르는 주소는 버리고, 새로 생긴 메뉴는 원래 자리 순서대로 뒤에 */
export function applyNavOrder(order = load()){
  const byHref = Object.fromEntries(items().map(a => [a.getAttribute("href"), a]));
  const list = [...(Array.isArray(order) ? order.filter(h => byHref[h]) : []), ...DEFAULT.filter(h => !(order || []).includes(h))];
  const more = $("#dock-more");
  [...new Set(list)].forEach(h => nav.insertBefore(byHref[h], more));
  renderNavOrderList();
}

/* 옆 아이콘들이 부드럽게 자리를 옮기도록 (FLIP) */
function reorder(fn){
  const before = new Map(items().map(a => [a, a.getBoundingClientRect().left]));
  fn();
  items().forEach(a => {
    if (a.classList.contains("dragging")) return;
    const dx = before.get(a) - a.getBoundingClientRect().left;
    if (!dx) return;
    a.style.transition = "none"; a.style.transform = `translateX(${dx}px)`;
    requestAnimationFrame(() => { a.style.transition = ""; a.style.transform = ""; });
  });
}

/* ---------- 끌기 ---------- */
const HOLD = 450, SLOP = 8;
let D = null;

nav.addEventListener("dragstart", e => { if (e.target.closest("a.il")) e.preventDefault(); });   // 브라우저 기본 링크 끌기 막기
nav.addEventListener("contextmenu", e => { if (D) e.preventDefault(); });                         // 길게 누를 때 뜨는 메뉴 막기

nav.addEventListener("pointerdown", e => {
  const a = e.target.closest("a.il");
  if (!a || e.button !== 0 || !e.isPrimary) return;
  D = { a, id: e.pointerId, x0: e.clientX, y0: e.clientY, on: false, touch: e.pointerType !== "mouse", start: items().slice() };
  if (D.touch) D.timer = setTimeout(() => begin(e.clientX), HOLD);
});

function begin(x){
  if (!D) return;
  D.on = true;
  try { nav.setPointerCapture(D.id); } catch (_) {}
  D.a.classList.add("dragging");
  nav.classList.add("reordering");
  $("#site-head").classList.add("tips-off");
  navigator.vibrate?.(15);
  follow(x);
}

/* 변형(transform)을 뺀 원래 자리의 가운데 */
const center = el => el.offsetParent.getBoundingClientRect().left + el.offsetLeft + el.offsetWidth / 2;

function follow(x){
  const a = D.a, list = items().filter(el => el.offsetParent), i = list.indexOf(a);
  const prev = list[i - 1], next = list[i + 1];
  if (next && x > center(next)) reorder(() => nav.insertBefore(next, a));
  else if (prev && x < center(prev)) reorder(() => nav.insertBefore(a, prev));
  a.style.transform = `translateX(${x - center(a)}px) scale(1.1)`;
}

nav.addEventListener("pointermove", e => {
  if (!D || e.pointerId !== D.id) return;
  const moved = Math.hypot(e.clientX - D.x0, e.clientY - D.y0) > SLOP;
  if (!D.on){
    if (!moved) return;
    if (D.touch){ clearTimeout(D.timer); D = null; return; }   // 휴대폰: 길게 누르기 전에 움직이면 평소 동작
    begin(e.clientX);
  }
  e.preventDefault();
  follow(e.clientX);
});

function end(cancel){
  if (!D) return;
  clearTimeout(D.timer);
  const { a, on, start } = D;
  D = null;
  if (!on) return;
  a.classList.remove("dragging");
  a.style.transform = "";
  nav.classList.remove("reordering");
  if (cancel){ reorder(() => start.forEach(el => nav.insertBefore(el, $("#dock-more")))); return; }
  // 끌기 뒤에 따라오는 클릭(페이지 이동)은 무시
  addEventListener("click", swallow, true);
  setTimeout(() => removeEventListener("click", swallow, true), 0);
  if (start.some((el, i) => el !== items()[i])){
    save(); renderNavOrderList();
    announce(`${nameOf(a)} 메뉴를 ${items().indexOf(a) + 1}번째로 옮겼습니다`);
  }
}
function swallow(ev){ ev.preventDefault(); ev.stopPropagation(); }
nav.addEventListener("pointerup", e => { if (D && e.pointerId === D.id) end(false); });
nav.addEventListener("pointercancel", () => end(true));
addEventListener("keydown", e => { if (e.key === "Escape" && D?.on) end(true); });

/* ---------- 설정: 위·아래 버튼 ---------- */
export function renderNavOrderList(focus){
  const box = $("#nav-order");
  if (!box) return;
  const list = items().filter(a => !a.hidden);
  box.innerHTML = list.map((a, i) => {
    const n = esc(nameOf(a));
    return `<li><span class="no">${i + 1}</span><span class="nm">${n}</span>
      <button class="btn small" type="button" data-nav-move="-1" data-href="${esc(a.getAttribute("href"))}" aria-label="${n} 앞으로"${i === 0 ? " disabled" : ""}>↑</button>
      <button class="btn small" type="button" data-nav-move="1" data-href="${esc(a.getAttribute("href"))}" aria-label="${n} 뒤로"${i === list.length - 1 ? " disabled" : ""}>↓</button></li>`;
  }).join("");
  $("#nav-order-reset").disabled = items().every((a, i) => a.getAttribute("href") === DEFAULT[i]);
  if (focus){
    const b = $(`[data-nav-move="${focus.dir}"][data-href="${focus.href}"]`, box);
    (b && !b.disabled ? b : $(`[data-href="${focus.href}"]:not([disabled])`, box))?.focus();
  }
}

document.addEventListener("click", e => {
  const b = e.target.closest("[data-nav-move]");
  if (b){
    const dir = +b.dataset.navMove, list = items().filter(a => !a.hidden);
    const a = list.find(x => x.getAttribute("href") === b.dataset.href), i = list.indexOf(a), other = list[i + dir];
    if (!other) return;
    reorder(() => dir < 0 ? nav.insertBefore(a, other) : nav.insertBefore(other, a));
    save();
    renderNavOrderList({ href: b.dataset.href, dir: b.dataset.navMove });
    announce(`${nameOf(a)} ${list.indexOf(a) + dir + 1}번째`);
    return;
  }
  if (e.target.closest("#nav-order-reset")){
    reorder(() => applyNavOrder(DEFAULT));
    save();
    renderNavOrderList();
    toast("하단 메뉴를 기본 순서로 되돌렸습니다");
    $("#nav-order button:not([disabled])")?.focus();
  }
});
