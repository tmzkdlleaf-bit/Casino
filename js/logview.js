/* =========================================================
   진행 기록 보기 — #story/회차번호  (이 화면에 처음 들어올 때만 불러옴)
   가볍게: ① 기록은 작게 저장된 JSON 한 개 ② 화면에는 50묶음씩 나눠 붙이고, 첫 두 묶음만 바로 그린 뒤
   나머지는 브라우저가 한가할 때 이어 붙임 ③ 화면 밖 묶음은 content-visibility로 그리기를 건너뜀
   그 밖에: 읽기↔노벨(novel.js) 전환, BGM 재생기, 찾기(탭 줄 자리에 겹쳐 뜸), 읽던 자리 기억(logpos.js — ‘이어 보기’)
   ========================================================= */
import { publicUrl, sb } from "./data.js?v=20261031i";
import { guessTabFormat } from "./logparse.js?v=20261031i";
import { loadSecrets, mergeLog } from "./logsecret.js?v=20261031i";
import { anchorOf, findPos, getPos, posKey, posState, setPos } from "./logpos.js?v=20261031i";
import { $, $$, esc, setTitle } from "./dom.js?v=20261031i";
import { DATA, nav, state } from "./state.js?v=20261031i";
import { ALL } from "./views.js?v=20261031i";

const cache = new Map();          // 주소 → 기록 JSON
const SIZE_KEY = "comu-log-size";
const SIZES = [.9375, 1, 1.0625, 1.1875, 1.3125];
let size = 2;
try { const r = localStorage.getItem(SIZE_KEY), v = +r; if (r !== null && v >= 0 && v < SIZES.length) size = v; } catch (_) {}   // 저장값이 없으면 기본 크기
/* 본문 폭: 좁게·보통·넓게 / 크게 보기(사이트 메뉴·제목 숨김) — 이 기기에 기억 */
const WIDTH_KEY = "comu-log-width", BIG_KEY = "comu-log-big";
const WIDTHS = ["38rem", "48rem", "64rem"];
let width = 1, big = false;
try { const r = localStorage.getItem(WIDTH_KEY), v = +r; if (r !== null && v >= 0 && v < WIDTHS.length) width = v; big = localStorage.getItem(BIG_KEY) === "1"; } catch (_) {}

export const V = { log: null, hidden: new Set(), job: 0, number: null, chapter: null, editing: false, mode: "read", secretsOk: true, posReady: false, posMoved: false, openTop: 0, allDrawn: false };
const MODE_KEY = "comu-log-mode";
try { if (localStorage.getItem(MODE_KEY) === "novel") V.mode = "novel"; } catch (_) {}
export const TAB_LABEL = { info: "정보", secret: "비밀", other: "잡담" };

/* ---------- 찾기 표시 (읽기·노벨 같이 씀) ----------
   글자를 감싸는 대신 브라우저의 ‘강조 범위’(CSS Custom Highlight)를 씀 → 화면 구조를 건드리지 않음.
   이 기능이 없는 예전 브라우저에서는 낱말 표시는 빠지고, 찾은 대사로 가서 그 줄이 잠깐 밝아지는 것만 됨 */
const F = { open: false, q: "", hits: [], set: new Set(), cur: -1, off: new Map(), idx: null, t: 0 };
const HL = typeof Highlight === "function" && window.CSS?.highlights ? { all: new Highlight(), cur: new Highlight() } : null;
if (HL){ HL.cur.priority = 1; CSS.highlights.set("log-find", HL.all); CSS.highlights.set("log-find-cur", HL.cur); }
export function hlClear(){ HL?.all.clear(); HL?.cur.clear(); }
const norm = t => String(t).normalize("NFC").toLowerCase();
/* root 안의 글에서 q가 나오는 자리들 */
function rangesIn(root, q){
  const nq = norm(q || ""), out = [];
  if (!root || !nq) return out;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (w.nextNode()){
    const node = w.currentNode, text = norm(node.data);
    if (text.length !== node.data.length) continue;          // 소문자·정규화로 길이가 달라지는 글(드묾)은 자리를 못 맞추니 건너뜀
    for (let at = text.indexOf(nq); at >= 0; at = text.indexOf(nq, at + nq.length)){
      const r = new Range(); r.setStart(node, at); r.setEnd(node, at + nq.length); out.push(r);
    }
  }
  return out;
}
/* root 안의 q에 표시. cur면 첫 곳을 ‘지금 결과’ 색으로. 첫 곳(Range)을 돌려줌 */
export function hlMark(root, q, cur = false){
  const list = rangesIn(root, q);
  if (HL){ for (const r of list) HL.all.add(r); if (cur && list[0]){ HL.cur.clear(); HL.cur.add(list[0]); } }
  return list[0] || null;
}

/* ---------- 이름 색: 어두운 창 위에서 4.5:1 이상 보이도록 밝힘 ---------- */
const lum = hex => {
  const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return .2126 * v[0] + .7152 * v[1] + .0722 * v[2];
};
const BG_L = lum("#161C4E");   // 기록 창 배경(유리 패널)보다 살짝 밝게 잡아 여유를 둠
const colorCache = new Map();
export function readable(hex){
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return "#E6EEFB";
  if (colorCache.has(hex)) return colorCache.get(hex);
  let [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)), out = hex;
  for (let k = 0; k < 12 && (lum(out) + .05) / (BG_L + .05) < 4.5; k++){
    r += (237 - r) * .2; g += (227 - g) * .2; b += (200 - b) * .2;           // 아이보리 쪽으로 조금씩
    out = "#" + [r, g, b].map(n => Math.round(n).toString(16).padStart(2, "0")).join("");
  }
  colorCache.set(hex, out);
  return out;
}

/* ---------- 묶음 만들기: 같은 사람이 같은 탭·같은 표정으로 이어 말하면 한 덩어리. 배경·BGM 표시가 있으면 거기서 끊음 ---------- */
export const SYSTEM = /^(system|시스템|システム)$/i;
function groups(log){
  const out = [], marks = new Map();
  const add = (at, g) => { if (!marks.has(at)) marks.set(at, []); marks.get(at).push(g); };
  (log.bg || []).forEach((b, k) => add(b.at, { bg: k }));
  (log.bgm || []).forEach((b, k) => add(b.at, { bgm: k }));
  let last = null;
  log.m.forEach(([t, s, text, f = -1], i) => {
    if (marks.has(i)){ out.push(...marks.get(i)); last = null; }
    if (V.hidden.has(t)) return;
    if (last && last.t === t && last.s === s && last.f === f){ last.lines.push(i); return; }
    last = { t, s, f, lines: [i] };
    out.push(last);
  });
  for (const [at, gs] of marks) if (at >= log.m.length) out.push(...gs);   // 맨 끝에 붙은 표시
  return out;
}

export const faceSrc = (log, f) => { const u = f >= 0 && log.faces?.[f]; return !u ? "" : /^(https?:|data:)/.test(u) ? u : publicUrl("logs", u); };
export const imgSrc = u => !u ? "" : /^(https?:|data:|blob:)/.test(u) ? u : publicUrl("logs", u);
export const audioSrc = u => !u ? "" : /^https?:/.test(u) ? u : publicUrl("logs", u);
export const ytId = u => (String(u || "").match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/) || [])[1];

function para(text, i){
  return `<p data-i="${i}">${deco(esc(text))}</p>`;
}

/* 꾸밈 문법 (나비코코 변환기와 같은 표기): **굵게**, *기울임*, {#색|글자}. 이미 이스케이프된 글에만 적용 */
export function deco(h){
  if (!/[*{]/.test(h)) return h;
  return h
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\{(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\|([^{}]+)\}/g, (_, c, t) => `<span style="color:${readable(c.length === 4 ? "#" + [...c.slice(1)].map(x => x + x).join("") : c.toLowerCase())}">${t}</span>`);
}

function bgmHtml(k, log){
  const b = log.bgm[k];
  if (b.kind === "stop") return `<div class="lg-bgm stop" data-k="${k}"><span class="note" aria-hidden="true">♪</span><span class="t">음악 멈춤</span></div>`;
  const title = esc(b.title || "배경음악");
  if (b.kind === "youtube"){
    const id = ytId(b.url);
    return `<div class="lg-bgm yt" data-k="${k}"><span class="note" aria-hidden="true">♪</span><span class="t">${title}</span>
      ${id ? `<button class="btn small" type="button" data-yt="${k}">유튜브로 듣기</button><div class="yt-slot"></div>` : ""}</div>`;
  }
  return `<div class="lg-bgm" data-k="${k}"><span class="note" aria-hidden="true">♪</span><span class="t">${title}</span>
    <button class="btn small" type="button" data-bgm-play="${k}" aria-pressed="${P.k === k && P.playing}">${P.k === k && P.playing ? "멈춤" : "재생"}<span class="sr"> — ${title}</span></button></div>`;
}

/* 배경 표시: 읽기 화면에서는 작은 견본만 (비주얼 노벨 모드에서 실제 배경으로 깔림) */
function bgHtml(k, log){
  const b = log.bg[k], src = imgSrc(b.url);
  return src
    ? `<div class="lg-bgimg" data-bk="${k}"><img src="${esc(src)}" alt="" loading="lazy" decoding="async"><span class="t">${esc(b.title || "배경")}</span></div>`
    : `<div class="lg-bgimg none" data-bk="${k}"><span class="t">배경 없음</span></div>`;
}

function groupHtml(g, log, faces){
  if ("bg" in g) return bgHtml(g.bg, log);
  if ("bgm" in g) return bgmHtml(g.bgm, log);
  const [tab, format] = log.tabs[g.t], [name, color, narr] = log.sp[g.s];
  const body = g.lines.map(i => para(log.m[i][2], i)).join("");
  // 기본 메인 탭이 아니면 탭 이름을 작게 붙임 (영문 기본 이름은 한국어로)
  const label = /^(main|메인|メイン)$/i.test(tab) ? "" : /^(info|other|secret)$/i.test(tab) ? TAB_LABEL[format] : tab;
  const tag = label ? `<span class="lg-tab">${esc(label)}</span>` : "";
  if (!name || SYSTEM.test(name)) return `<div class="lg-sys f-${format}">${body}</div>`;
  if (narr) return `<div class="lg-narr f-${format}">${tag}${body}</div>`;
  const c = readable(color), st = faceSrc(log, g.f), site = faces.get(name.trim());
  const av = st ? `<span class="lg-av st"><img src="${esc(st)}" alt="" loading="lazy" decoding="async"></span>`
    : site ? `<span class="lg-av"><img src="${esc(site.src)}" alt="" loading="lazy" decoding="async"></span>`
    : `<span class="lg-av ini" style="--c:${c}" aria-hidden="true">${esc([...name][0])}</span>`;
  return `<article class="lg f-${format}${st ? " has-st" : ""}">${av}<div class="lg-b"><p class="lg-n" style="color:${c}">${esc(name)}${tag}</p>${body}</div></article>`;
}

/* ---------- 그리기: 나눠서, 한가할 때 ---------- */
const idle = window.requestIdleCallback || (fn => setTimeout(() => fn({ timeRemaining: () => 8 }), 16));
const CHUNK = 50;

export function render({ upTo = -1 } = {}){
  const box = $("#log-body"), log = V.log, job = ++V.job;
  const list = groups(log);
  const faces = new Map(ALL().filter(c => c.thumb || c.img).map(c => [c.name.trim(), { src: c.thumb || c.img }]));
  box.innerHTML = ""; hlClear();
  V.allDrawn = !list.length;
  if (!list.length){ box.innerHTML = `<p class="empty-note">보이는 탭에 대사가 없습니다.</p>`; return; }
  let i = 0;
  const addChunk = () => {
    const html = list.slice(i, i + CHUNK).map(g => groupHtml(g, log, faces)).join("");
    box.insertAdjacentHTML("beforeend", `<div class="lg-chunk">${html}</div>`);
    i += CHUNK;
    if (i >= list.length) V.allDrawn = true;
    if (F.q) markChunk(box.lastElementChild);               // 찾는 말 표시
  };
  addChunk(); if (i < list.length) addChunk();                       // 첫 화면은 바로
  // 편집 뒤처럼 특정 대사로 돌아가야 하면 그 대사가 들어 있는 묶음까지는 바로 그림
  if (upTo >= 0){ const at = list.findIndex(g => g.lines?.includes(upTo)); while (at >= 0 && i <= at + CHUNK && i < list.length) addChunk(); }
  const more = dl => {
    if (job !== V.job || nav.current !== "log") return;                  // 다른 화면으로 가면 멈춤
    while (i < list.length && dl.timeRemaining() > 4) addChunk();
    if (i < list.length) idle(more);
  };
  if (i < list.length) idle(more);
}

function drawTabs(){
  const log = V.log;
  const ord = { main: 0, other: 1, info: 2, secret: 3 };
  const order = log.tabs.map((x, t) => t).sort((a, b) => (ord[log.tabs[a][1]] ?? 1) - (ord[log.tabs[b][1]] ?? 1) || log.tabs[a][0].localeCompare(log.tabs[b][0], "ko", { numeric: true }));
  $("#log-tabs").innerHTML = order.map(t => { const [name, format] = log.tabs[t];
    const n = log.m.reduce((k, x) => k + (x[0] === t), 0);
    const label = /^(main|info|other|secret)$/i.test(name) ? { main: "메인", ...TAB_LABEL }[format] : name;
    return `<button type="button" class="tchip f-${format}" data-tab="${t}" aria-pressed="${!V.hidden.has(t)}" >${esc(label)} <span class="c">${n.toLocaleString("ko-KR")}</span></button>`;
  }).join("");
  $("#log-tabbar").hidden = log.tabs.length < 2 && !F.open;   // 탭이 하나뿐이면 줄을 숨김 (찾기 중에는 찾기 칸 자리로 씀)
  tabSum();
}
/* 탭 줄 접기: 접으면 '탭 7/9'만 한 줄로 — 이 기기에 기억 */
const TF_KEY = "comu-log-tabfold";
let tabFold = false;
try { tabFold = localStorage.getItem(TF_KEY) === "1"; } catch (_) {}
function applyTabFold(){ $("#log-tabbar").classList.toggle("folded", tabFold); $("#log-tabfold").setAttribute("aria-expanded", String(!tabFold)); $("#log-tabs").hidden = tabFold; }
function tabSum(){ const n = V.log?.tabs.length || 0; $("#log-tabsum").textContent = n ? `${n - [...V.hidden].filter(t => t < n).length}/${n}` : ""; }

function applySize(){
  $("#log-body").style.setProperty("--lg-fs", SIZES[size] + "rem"); $("#log-vn").style.setProperty("--lg-fs", SIZES[size] + "rem");
  $$(".log-size button").forEach(b => b.disabled = (b.dataset.size === "-1" && size === 0) || (b.dataset.size === "1" && size === SIZES.length - 1));
}
function applyWidth(){
  $("#log-body").style.setProperty("--lg-w", WIDTHS[width]);
  $$("#log-width button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.w === width)));
}
/* 크게 보기: 아래 메뉴와 제목을 숨기고 기록 창이 브라우저 화면을 채움 */
function applyBig(){
  document.body.classList.toggle("log-big", big && nav.current === "log");
  $$("#log-bigseg button").forEach(b => b.setAttribute("aria-pressed", String((b.dataset.big === "1") === big)));
}
export const setBig = on => { big = on; try { localStorage.setItem(BIG_KEY, on ? "1" : "0"); } catch (_) {} applyBig(); };
/* 보기 설정(Aa) 메뉴: 글자 크기·본문 폭·스탠딩·크게 보기 */
const ST_KEY = "comu-log-st";
let showSt = true;
try { showSt = localStorage.getItem(ST_KEY) !== "0"; } catch (_) {}
function applySt(){ $(".log-box").classList.toggle("no-st", !showSt); $$("#log-st button").forEach(b => b.setAttribute("aria-pressed", String((b.dataset.st === "1") === showSt))); }
function aaMenu(open){ const m = $("#log-aa-menu"), b = $("#log-aa"); if (!m) return; m.hidden = !open; b.setAttribute("aria-expanded", String(open)); }
/* 전체 화면: 기록 화면(읽기·노벨)을 모니터 전체로 */
function toggleFull(){
  const sec = $('[data-page="log"]');
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else sec.requestFullscreen?.().catch(() => { const b = $("#log-full"); b.disabled = true; b.title = "이 브라우저에서는 전체 화면을 쓸 수 없습니다"; });
}
document.addEventListener("fullscreenchange", () => {
  const on = document.fullscreenElement === $('[data-page="log"]');
  $("#log-full").textContent = on ? "전체 화면 끝" : "전체 화면";
  $("#log-full").setAttribute("aria-pressed", String(on));
});
if (!document.documentElement.requestFullscreen) $("#log-full").hidden = true;   // 아이폰 등

/* 스크롤하면 위쪽(제목 줄) 접기 — 내려 읽는 중엔 접고, 위로 올리거나 맨 위면 다시 펼침 */
let lastTop = 0;
$("#log-pane").addEventListener("scroll", e => {
  const top = e.target.scrollTop, page = $('[data-page="log"]');
  if (top < 40) page.classList.remove("folded");
  else if (top > lastTop + 12) page.classList.add("folded");
  else if (top < lastTop - 60) page.classList.remove("folded");
  if (Math.abs(top - lastTop) > 12 || top < 40) lastTop = top;
}, { passive: true });

/* ---------- 읽기: 오른쪽 장면 막대 — 배경 표시마다 점, 읽는 위치는 분홍 눈금. 점을 누르면 그 장면으로 ---------- */
function drawRail(){
  const r = $("#log-rail"), log = V.log, n = log?.m.length || 0;
  const marks = (log?.bg || []).map((b, k) => ({ b, k })).filter(x => x.b.url);
  r.hidden = !n || !marks.length;
  if (r.hidden) return;
  r.innerHTML = marks.map(({ b, k }) => `<button type="button" data-rail="${k}" style="top:${(Math.min(b.at, n - 1) / Math.max(1, n - 1) * 100).toFixed(2)}%" aria-label="${esc(b.title || "장면")}로" title="${esc(b.title || "장면")}"></button>`).join("") + `<i class="here" aria-hidden="true"></i>`;
  railHere();
}
function railHere(){
  const p = $("#log-pane"), h = $("#log-rail .here"); if (!h) return;
  const max = p.scrollHeight - p.clientHeight;
  h.style.top = (max > 0 ? p.scrollTop / max * 100 : 0).toFixed(2) + "%";
}
$("#log-pane").addEventListener("scroll", railHere, { passive: true });
/* 장면 막대는 본문이 시작하는 곳부터 (위 막대·탭 줄 높이가 화면 크기나 접힘에 따라 달라서, 고정 값이면 그 위로 삐져나옴) */
if (window.ResizeObserver) new ResizeObserver(() => {
  const p = $("#log-pane"); if (!p.offsetParent) return;
  $("#log-rail").style.top = (p.offsetTop + 16) + "px";
  railHere();
}).observe($("#log-pane"));
document.addEventListener("click", e => {
  const b = e.target.closest("[data-rail]"); if (!b || !V.log) return;
  const at = V.log.bg[+b.dataset.rail].at;
  render({ upTo: at });
  requestAnimationFrame(() => { const el = $(`#log-body [data-bk="${b.dataset.rail}"]`); el?.scrollIntoView({ block: "start" }); railHere(); });
});

/* ---------- 읽기 / 노벨 ---------- */
/* 노벨 모듈은 처음 쓸 때 불러옴. 불러온 뒤에는 VN으로 바로 씀 (닫기처럼 순서가 중요한 일을 기다림 없이 하려고) */
let VN = null;
const novel = () => VN ? Promise.resolve(VN) : import("./novel.js?v=20261031i").then(m => (VN = m));
/* 화면 세로 위치 y에서 읽고 있는 대사: 첫 줄이 y보다 위에 있는 마지막 대사.
   화면 밖 묶음은 높이를 어림값으로 잡아 두고 안쪽은 그리지 않으므로, 묶음 자체의 위치로만 판단함
   (그 안쪽 대사의 위치는 묶음 밖으로 삐져나온 값이라 믿을 수 없고, 하나하나 재면 느려짐) */
function lineAt(y){
  let cur = -1;
  for (const ch of $$("#log-body .lg-chunk")){
    const r = ch.getBoundingClientRect();
    if (r.top > y) break;
    const ps = ch.querySelectorAll("[data-i]");
    if (r.bottom < y){ if (ps.length) cur = +ps[ps.length - 1].dataset.i; continue; }   // 통째로 위에 있는 묶음: 마지막 대사
    for (const p of ps){ if (p.getBoundingClientRect().top > y) break; cur = +p.dataset.i; }
  }
  return cur;
}
/* 읽기 화면에서 지금 읽는 대사(화면 위에서 40% 지점) */
function readLine(){ const pane = $("#log-pane"); return lineAt(pane.getBoundingClientRect().top + pane.clientHeight * .4); }
/* i번 대사가 꺼 둔 탭의 것이면: 그 앞의 가장 가까운 보이는 대사 (없으면 뒤쪽). 보이는 대사가 하나도 없으면 -1 */
function visibleNear(i){
  const m = V.log?.m || [];
  i = Math.max(0, Math.min(m.length - 1, i));
  for (let k = i; k >= 0; k--) if (!V.hidden.has(m[k][0])) return k;
  for (let k = i + 1; k < m.length; k++) if (!V.hidden.has(m[k][0])) return k;
  return -1;
}
/* 읽기 화면을 i번 대사(꺼 둔 탭이면 가까운 보이는 대사)가 40% 지점에 오게. 그 대사의 요소를 돌려줌.
   pin(요소)이 화면 세로 위치를 돌려주면 대사 첫 줄 대신 그 자리를 맞춤 (긴 대사 안의 찾은 낱말) */
let lineJob = 0;
function scrollToLine(i, pin){
  const k = visibleNear(i), sel = `#log-body [data-i="${k}"]`;
  if (k < 0) return null;
  let el = $(sel);
  if (!el){ render({ upTo: k }); el = $(sel); }                       // 아직 안 그린 뒤쪽이면 그 묶음까지 바로 그림
  if (!el) return null;
  const pane = $("#log-pane"), job = ++lineJob;
  const off = () => (pin?.(el) ?? el.getBoundingClientRect().top) - (pane.getBoundingClientRect().top + pane.clientHeight * .4) + 2;
  pane.scrollTop += off();
  // 화면 밖 묶음은 높이를 어림해 두었다가 보일 때 실제로 그리므로, 자리가 잡힐 때까지 몇 번 더 맞춤.
  // 그 사이 사람이 직접 움직이면(휠·터치·키) 바로 그만둠
  let n = 0, calm = 0, stop = false;
  const quit = () => { stop = true; };
  const evs = ["wheel", "touchstart", "pointerdown", "keydown"];
  evs.forEach(t => addEventListener(t, quit, { capture: true, passive: true, once: true }));
  const done = () => { evs.forEach(t => removeEventListener(t, quit, { capture: true })); railHere(); };
  const fix = () => {
    if (stop || job !== lineJob || !el.isConnected || n++ > 12) return done();
    const d = off();
    if (Math.abs(d) > 1){ pane.scrollTop += d; calm = 0; } else if (++calm > 1) return done();
    requestAnimationFrame(fix);
  };
  requestAnimationFrame(fix);
  railHere();
  return el;
}
/* 읽던 자리 기억 (이 기기에만): 읽기 화면은 스크롤이 멈출 때, 노벨은 대사를 넘길 때. 지난 이야기의 ‘이어 보기’가 이 값을 씀 */
export function savePos(i){
  if (!V.posReady || !V.log || !V.chapter || i < 0) return;
  setPos(posKey(V.chapter), { i, n: V.log.m.length, a: anchorOf(V.log, i) });
}
function saveReadPos(){
  if (!V.posReady || !V.log || V.mode === "novel" || nav.current !== "log") return;
  const pane = $("#log-pane"), max = pane.scrollHeight - pane.clientHeight;
  // 맨 위는 ‘안 읽음’, 다 그려진 뒤의 맨 아래는 ‘다 읽음’
  savePos(pane.scrollTop < 40 ? 0 : V.allDrawn && max > 0 && pane.scrollTop >= max - 8 ? V.log.m.length - 1 : readLine());
}
let posT = 0;
$("#log-pane").addEventListener("scroll", () => {
  if (!V.posReady || V.mode === "novel") return;
  // 열기만 하고 움직이지 않았으면 읽던 자리를 바꾸지 않음 (다 읽은 회차를 잠깐 열어 봐도 ‘다 읽음’ 그대로)
  if (!V.posMoved){ if (Math.abs($("#log-pane").scrollTop - V.openTop) < 4) return; V.posMoved = true; }
  clearTimeout(posT); posT = setTimeout(() => { posT = 0; saveReadPos(); }, 400);
}, { passive: true });
document.addEventListener("visibilitychange", () => { if (document.hidden && posT){ clearTimeout(posT); posT = 0; saveReadPos(); } });
/* switching: 읽기↔노벨 버튼으로 바꾼 것 / startAt: 기록을 열 때 이어 볼 대사 번호 */
async function applyMode(switching = false, startAt = -1){
  const vn = V.mode === "novel" && !!V.log;
  const from = switching && vn ? Math.max(0, readLine()) : startAt;     // 읽던 자리에서 노벨 시작
  if (switching) V.posMoved = true;
  $$("#log-mode button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === (vn ? "novel" : "read"))));
  $("#log-pane").hidden = vn;
  $("#log-vn").hidden = !vn;
  $(".log-box").classList.toggle("is-vn", vn);
  $("#log-rail").hidden = vn || !(V.log?.bg || []).some(b => b.url);
  $("#log-follow").setAttribute("aria-pressed", String(P.follow)); bgmLabel();   // BGM 켜짐·꺼짐은 두 모드가 같이 씀
  syncVol(vn);
  $("#log-edit").hidden = !state.isAdmin || !V.log;     // 편집은 읽기·노벨 둘 다에서
  const eb = $("#log-editbar"); if (eb) eb.hidden = vn || !V.editing;
  document.body.classList.toggle("vn-on", vn);
  $$("#log-width button").forEach(b => { b.disabled = vn; });   // 노벨에서는 쓸 일이 없지만 자리는 그대로
  // 노벨에서는 잡담이 채팅창으로 나오므로, 직접 탭을 끈 적이 없으면 잡담 탭을 켬 (읽기 화면 기본값은 접힘)
  if (vn && !V.tabsTouched && V.log){ let ch = false; V.log.tabs.forEach(([, f], t) => { if (f === "other" && V.hidden.delete(t)) ch = true; }); if (ch){ drawTabs(); render(); if (F.q) runFind(); } }
  $('[data-page="log"]').classList.toggle("folded", false);
  const m = await novel();
  if (nav.current !== "log"){ m.closeNovel(); return; }             // 불러오는 사이 다른 화면으로 갔으면 열지 않음
  if (vn) m.openNovel(from);
  else {
    const at = m.closeNovel();                                      // 노벨에서 보던 대사로 읽기 화면을 옮김
    if (switching && at >= 0) scrollToLine(at);
    if (P.follow) follow(); else if (switching) stopAudio();
    if (F.q) markAll();                                              // 읽기 화면으로 돌아오면 찾는 말 표시를 다시
  }
  const bar = $(".log-bar"); if (bar) bar.scrollLeft = 0;     // 휴대폰: 버튼 줄이 옆으로 밀려 ‘읽기’가 가려지지 않게
}

/* ---------- 여닫기 ---------- */
export async function openLog(number){
  const c = DATA.chapters.find(x => String(x.number) === String(number));
  if (!c) return;
  V.number = c.number;
  $("#log-ep").textContent = `제${c.number}화${c.date ? " · " + c.date : ""}`;
  $("#log-title").textContent = c.title;
  setTitle(`제${c.number}화 ${c.title}`);
  $("#log-meta").textContent = "";
  V.posReady = false; clearTimeout(posT); closeFind(true);
  $("#log-tabs").innerHTML = ""; $("#log-tabbar").hidden = true; aaMenu(false); $("#log-rail").hidden = true;
  $('[data-page="log"]').classList.remove("folded");
  applySize(); applyWidth(); applyBig(); applySt(); bgmTitle(); applyTabFold();
  const box = $("#log-body");
  $("#log-edit").hidden = true; $("#log-snd").hidden = true;
  $("#log-mode").hidden = true; $("#log-pane").hidden = false; $("#log-vn").hidden = true; $(".log-box").classList.remove("is-vn");
  VN?.closeNovel();                                   // 열려 있던 노벨 화면 정리 (아직 불러온 적 없으면 열린 것도 없음)
  stopAudio(); setSound(false); V.editing = false; box.classList.remove("editing"); document.body.classList.remove("vn-on");
  $("#log-edit").setAttribute("aria-label", "편집"); $("#log-edit").setAttribute("aria-pressed", "false"); { const eb = $("#log-editbar"); if (eb) eb.hidden = true; }
  if (!c.log){ box.innerHTML = `<p class="empty-note">이 회차에는 아직 진행 기록이 없습니다.</p>`; return; }
  box.innerHTML = `<p class="empty-note" role="status">기록을 불러오는 중…</p>`;
  try {
    if (!cache.has(c.log)){
      const r = await fetch(c.log);
      if (!r.ok) throw new Error(r.status);
      cache.set(c.log, await r.json());
    }
  } catch (_){
    box.innerHTML = `<p class="empty-note" role="alert">기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>`;
    return;
  }
  // 비밀 탭: 이 사람이 볼 수 있는 것만 DB가 내줌 (로그인 안 했으면 묻지 않음)
  const sec = state.session && sb ? await loadSecrets(sb, c.id) : { rows: [], ok: true };
  if (V.number !== c.number || nav.current !== "log") return;          // 기다리는 사이 다른 화면으로 옮김
  V.log = mergeLog(cache.get(c.log), sec.rows);
  V.secretsOk = sec.ok; V.tabsTouched = false;
  // 예전에 올린 기록: 'Ho2 비밀'처럼 이름 앞뒤에 붙은 탭은 메인으로 저장돼 있었음 → 이름으로 다시 짐작
  if ((V.log.v || 2) < 3) for (const tab of V.log.tabs) if (tab[1] === "main"){ const g = guessTabFormat(tab[0]); if (g !== "main") tab[1] = g; }
  V.hidden = new Set(V.log.tabs.map(([, f], t) => f === "other" ? t : -1).filter(t => t >= 0));   // 잡담은 처음엔 접어 둠
  V.chapter = c;
  $("#log-meta").textContent = `대사 ${V.log.m.length.toLocaleString("ko-KR")}개`;
  $("#log-edit").hidden = !state.isAdmin;

  syncVol(false);
  $("#log-mode").hidden = false;
  drawTabs();
  render();
  drawRail();
  // 읽던 자리에서 이어 보기: ‘처음부터’로 들어왔거나 다 읽은 회차는 맨 앞에서
  const fromStart = String(state.logStart) === String(c.number); state.logStart = null;
  const saved = getPos(posKey(c)), resume = !fromStart && posState(saved).kind === "mid" ? findPos(V.log, saved) : -1;
  V.posReady = true; V.posMoved = false;
  if (fromStart) savePos(0);                                         // ‘처음부터’: 읽던 자리를 지움
  if (V.mode === "novel") applyMode(false, resume);
  else { if (resume > 0) scrollToLine(resume); V.openTop = $("#log-pane").scrollTop; }
}

/* ---------- 구간 BGM ----------
   ‘BGM 따라 듣기’를 켜면 읽는 위치(창 위에서 40%)를 지난 마지막 BGM 표시의 음악이 흐름. 누르기 전에는 재생하지 않음 */
const P = { audio: null, k: -1, playing: false, follow: false, timer: 0 };
/* 기록 BGM 볼륨 (0~1) — 읽기·노벨 같이, 이 기기에 기억. 유튜브는 iframe에 setVolume 명령으로 */
const VOL_KEY = "comu-log-vol";
export const LV = { v: .4 };
try { const r = localStorage.getItem(VOL_KEY); if (r !== null && +r >= 0 && +r <= 1) LV.v = +r; } catch (_) {}
export function ytVolume(frame){ try { frame?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "setVolume", args: [Math.round(LV.v * 100)] }), "*"); } catch (_) {} }
export function setVolume(v){
  LV.v = Math.max(0, Math.min(1, v));
  try { localStorage.setItem(VOL_KEY, String(LV.v)); } catch (_) {}
  if (P.audio && P.playing){ clearInterval(P.audio._f); P.audio.volume = LV.v; }
  document.querySelectorAll("iframe.yt-vol").forEach(ytVolume);
  document.querySelectorAll("input.vol").forEach(i => { i.value = Math.round(LV.v * 100); i.style.setProperty("--vol", Math.round(LV.v * 100) + "%"); });
  document.dispatchEvent(new CustomEvent("comu:log-vol", { detail: LV.v }));
}
document.addEventListener("input", e => { if (e.target.matches?.("input.vol")) setVolume(+e.target.value / 100); });
const VOL = () => LV.v;
/* BGM 버튼: 켜져 있으면 일시정지(❚❚), 꺼져 있으면 재생(▶) */
export function bgmLabel(){ const b = $("#log-follow"); if (!b) return; const on = b.getAttribute("aria-pressed") === "true"; b.innerHTML = `<span aria-hidden="true">${on ? "❚❚" : "▶"}</span>`; b.setAttribute("aria-label", on ? "BGM 일시정지" : "BGM 재생"); }
/* BGM 곡 이름 (지금 나오는 곡, 없으면 이 기록의 첫 곡) */
export function bgmTitle(t){ const el = $("#log-bgm-t"); if (!el) return; const first = (V.log?.bgm || []).find(b => b.kind !== "stop"); el.textContent = t || first?.title || "BGM"; el.title = el.textContent; }
/* 읽기 화면: 기록에 BGM 표시가 있으면 볼륨 막대를 보임 (노벨은 대사창 안 BGM 버튼 옆) */
function syncVol(vn){ const v = $("#log-vol"); if (!v) return; $("#log-snd").hidden = !(V.log?.bgm || []).some(b => b.kind !== "stop"); v.value = Math.round(LV.v * 100); v.style.setProperty("--vol", v.value + "%"); }
function fadeTo(a, v, ms = 800, done){
  clearInterval(a._f);
  const from = a.volume, t0 = performance.now();
  a._f = setInterval(() => { const x = Math.min(1, (performance.now() - t0) / ms); a.volume = from + (v - from) * x; if (x >= 1){ clearInterval(a._f); done?.(); } }, 40);
}
/* BGM 재생기 하나를 읽기·노벨이 같이 씀 → 모드를 바꿔도 같은 곡이면 끊기지 않고 이어짐 */
export function playMark(k){
  const b = k >= 0 ? V.log?.bgm?.[k] : null;
  if (!b || b.kind === "stop"){ stopAudio(); bgmTitle(""); return; }
  bgmTitle(b.title);
  if (P.k === k && P.playing) return;
  stopAudio();
  document.dispatchEvent(new CustomEvent("comu:bgm-pause"));        // 사이트 배경음악은 잠시 멈춤
  if (b.kind === "youtube"){
    const id = ytId(b.url);
    if (!id) return;
    $(".log-box").insertAdjacentHTML("beforeend", `<iframe id="log-yt" title="${esc(b.title || "배경음악")}" tabindex="-1" aria-hidden="true"
      src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&loop=1&playlist=${id}&start=${+b.start || 0}&controls=0&enablejsapi=1" class="yt-vol" allow="autoplay; encrypted-media"
      style="position:fixed; left:-9999px; top:0; width:2px; height:2px; opacity:0; pointer-events:none; border:0"></iframe>`);
    const fr = $("#log-yt"); fr.addEventListener("load", () => { ytVolume(fr); setTimeout(() => ytVolume(fr), 800); });
    Object.assign(P, { audio: null, k, playing: true });
  } else {
    const a = new Audio(audioSrc(b.url));
    a.loop = true; a.volume = 0;
    a.play().then(() => { fadeTo(a, VOL()); }).catch(() => { if (P.audio === a){ P.playing = false; syncButtons(); } });
    Object.assign(P, { audio: a, k, playing: true });
  }
  syncButtons();
}
export const soundOn = () => P.follow;
export function setSound(on){ P.follow = !!on; $("#log-follow")?.setAttribute("aria-pressed", String(P.follow)); bgmLabel(); }
export function stopAudio(){
  if (P.audio){ const a = P.audio; fadeTo(a, 0, 500, () => a.pause()); }
  $("#log-yt")?.remove();
  Object.assign(P, { audio: null, k: -1, playing: false });
  syncButtons();
}
function syncButtons(){
  $$("[data-bgm-play]").forEach(btn => {
    const on = +btn.dataset.bgmPlay === P.k && P.playing;
    btn.setAttribute("aria-pressed", String(on));
    btn.firstChild.textContent = on ? "멈춤" : "재생";
  });
}
/* 읽는 위치 앞의 마지막 BGM 표시 찾기. 화면 밖 묶음은 묶음 자체의 위치로만 판단해 다시 그리지 않음 */
function currentMark(){
  const pane = $("#log-pane"), thr = pane.getBoundingClientRect().top + pane.clientHeight * .4;
  let cur = -1;
  for (const el of $$("#log-body .lg-bgm")){
    const ch = el.closest(".lg-chunk").getBoundingClientRect();
    if (ch.top > thr) break;
    if (ch.bottom < thr || el.getBoundingClientRect().top < thr) cur = +el.dataset.k; else break;
  }
  return cur;
}
function follow(){
  if (!P.follow || !V.log) return;
  const k = currentMark(), b = V.log.bgm[k];
  if (k < 0 || !b || b.kind === "stop"){ if (P.playing) stopAudio(); bgmTitle(""); return; }
  playMark(k);
}
document.addEventListener("scroll", e => {
  if (e.target.id !== "log-pane" || !P.follow) return;
  clearTimeout(P.timer); P.timer = setTimeout(follow, 250);
}, true);
addEventListener("hashchange", () => { if (!location.hash.startsWith("#story/")){ stopAudio(); VN?.closeNovel(); closeFind(true); document.body.classList.remove("log-big", "vn-on"); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); P.follow = false; $("#log-follow")?.setAttribute("aria-pressed", "false"); } });

/* ---------- 찾기 ----------
   위 막대의 돋보기(또는 Ctrl+F, /)를 누르면 탭 줄 자리에 찾기 칸이 겹쳐 뜸 (화면이 밀리지 않음).
   켜 둔 탭의 대사 본문에서 찾고, Enter·▼ 다음 / Shift+Enter·▲ 이전. 꺼 둔 탭에 결과가 있으면 알려 주고 눌러서 켤 수 있음.
   읽기: 그 대사로 스크롤 / 노벨: 그 대사로 건너뜀 (메인 밖의 탭이면 그 채팅창을 엶) */
/* 꾸밈 기호(**굵게**, {#색|글자})를 뺀 본문 */
const plainText = t => !/[*{]/.test(t) ? t : t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1$2").replace(/\{(?:#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\|([^{}]+)\}/g, "$1");
function markChunk(chunk){ for (const p of chunk.querySelectorAll("p[data-i]")) if (F.set.has(+p.dataset.i)) hlMark(p, F.q); }
function markAll(){
  hlClear();
  $$("#log-body .lg-chunk").forEach(markChunk);
  if (F.cur >= 0 && HL){ const r = rangesIn($(`#log-body [data-i="${F.hits[F.cur]}"]`), F.q)[0]; if (r) HL.cur.add(r); }
}
function findLabel(){
  const n = F.hits.length, lab = $("#log-find-n"), more = $("#log-find-more"), num = k => k.toLocaleString("ko-KR");
  lab.textContent = !F.q ? "" : !n ? "결과 없음" : F.cur >= 0 ? `${num(F.cur + 1)} / ${num(n)}` : `${num(n)}건`;
  lab.classList.toggle("none", !!F.q && !n);
  $("#log-find-prev").disabled = $("#log-find-next").disabled = !n;
  const off = [...F.off.values()].reduce((a, b) => a + b, 0);
  more.hidden = !off;
  if (off){ more.textContent = `꺼 둔 탭 +${num(off)}`; more.setAttribute("aria-label", `꺼 둔 탭에 ${num(off)}건 더 있습니다. 눌러서 그 탭을 켜고 같이 찾기`); more.title = "눌러서 그 탭을 켜고 같이 찾기"; }
}
function runFind(){
  clearTimeout(F.t); F.t = 0;
  const log = V.log, q = norm($("#log-q").value.trim());
  Object.assign(F, { q, hits: [], set: new Set(), cur: -1, off: new Map() });
  if (log && q){
    if (!F.idx || F.idx.length !== log.m.length) F.idx = log.m.map(x => norm(plainText(x[2])));   // 한 번 만들어 두고 다시 씀
    log.m.forEach((x, i) => {
      if (!F.idx[i].includes(q)) return;
      if (V.hidden.has(x[0])) F.off.set(x[0], (F.off.get(x[0]) || 0) + 1); else { F.hits.push(i); F.set.add(i); }
    });
  }
  if (V.mode === "novel") hlClear(); else markAll();
  findLabel();
}
/* 화면에 보이는 첫 대사 (읽기). 위로 지나간 묶음은 건너뜀 */
function topLine(){
  const top = $("#log-pane").getBoundingClientRect().top + 4;
  for (const ch of $$("#log-body .lg-chunk")){
    if (ch.getBoundingClientRect().bottom <= top) continue;
    for (const p of ch.querySelectorAll("[data-i]")) if (p.getBoundingClientRect().bottom > top) return +p.dataset.i;
  }
  return 0;
}
async function findGo(dir){
  if (F.t) runFind();                                                // 막 친 글자까지 반영
  if (!F.hits.length) return;
  const vn = V.mode === "novel" ? await novel() : null;
  if (F.cur < 0){                                                    // 처음에는 지금 보는 자리에서 가까운 결과부터
    const here = vn ? vn.nowLine() : topLine();
    F.cur = dir > 0 ? F.hits.findIndex(i => i >= here) : F.hits.length - 1 - [...F.hits].reverse().findIndex(i => i <= here);
    if (F.cur < 0 || F.cur >= F.hits.length) F.cur = dir > 0 ? 0 : F.hits.length - 1;
  } else F.cur = (F.cur + dir + F.hits.length) % F.hits.length;
  const i = F.hits[F.cur];
  findLabel();
  if (vn){ vn.findJump(i, F.q); return; }
  // 대사가 길면 첫 줄이 아니라 찾은 낱말이 보이는 곳으로
  let r;
  const el = scrollToLine(i, p => (r === undefined ? (r = rangesIn(p, F.q)[0] || null) : r)?.getBoundingClientRect().top);
  if (!el) return;
  if (HL){ HL.cur.clear(); if (r) HL.cur.add(r); }
  el.classList.add("just"); setTimeout(() => el.classList.remove("just"), 1600);
}
function openFind(){
  if (!V.log) return;
  F.open = true;
  const bar = $("#log-tabbar"), q = $("#log-q");
  bar.hidden = false; bar.classList.add("finding"); $("#log-find").hidden = false;
  $("#log-find-btn").setAttribute("aria-expanded", "true");
  aaMenu(false);
  q.focus(); q.select();
  if (q.value.trim()) runFind(); else findLabel();
}
/* reset: 다른 회차를 열 때 — 찾던 말도 지움 */
function closeFind(reset = false){
  const was = F.open;
  clearTimeout(F.t);
  Object.assign(F, { open: false, q: "", hits: [], set: new Set(), cur: -1, off: new Map(), idx: null, t: 0 });
  hlClear();
  const bar = $("#log-tabbar");
  bar.classList.remove("finding"); $("#log-find").hidden = true;
  bar.hidden = !V.log || V.log.tabs.length < 2;
  $("#log-find-btn").setAttribute("aria-expanded", "false");
  findLabel();
  if (reset) $("#log-q").value = "";
  else if (was) $("#log-find-btn").focus();
}
$("#log-q").addEventListener("input", () => { clearTimeout(F.t); F.t = setTimeout(runFind, 160); });
/* Enter(휴대폰 자판의 ‘검색’ 키 포함) = 다음 결과. 칸을 form으로 두어, 한글을 조합하는 중의 Enter는 글자 확정만 하고 넘어가지 않게 브라우저에 맡김 */
$("#log-find").addEventListener("submit", e => { e.preventDefault(); findGo(1); });
$("#log-q").addEventListener("keydown", e => {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === "Enter" && e.shiftKey){ e.preventDefault(); findGo(-1); }
  else if (e.key === "ArrowDown"){ e.preventDefault(); findGo(1); }
  else if (e.key === "ArrowUp"){ e.preventDefault(); findGo(-1); }
});
document.addEventListener("comu:log-dirty", () => { F.idx = null; if (F.open && F.q) runFind(); });   // 편집으로 본문이 바뀜
document.addEventListener("keydown", e => {
  if (nav.current !== "log" || !V.log || e.altKey || document.querySelector("dialog[open]")) return;
  const mod = e.ctrlKey || e.metaKey, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  if (mod && !e.shiftKey && e.key.toLowerCase() === "f"){
    if (F.open && document.activeElement === $("#log-q")) return;    // 찾기 칸에서 한 번 더 누르면 브라우저 찾기
    e.preventDefault(); openFind();
  } else if (!mod && e.key === "/" && !typing){ e.preventDefault(); openFind(); }
});

/* ---------- 조작 ---------- */
document.addEventListener("click", e => {
  if (e.target.closest("#log-find-btn")){ F.open ? closeFind() : openFind(); return; }
  if (e.target.closest("#log-find-next")){ findGo(1); return; }
  if (e.target.closest("#log-find-prev")){ findGo(-1); return; }
  if (e.target.closest("#log-find-x")){ closeFind(); return; }
  if (e.target.closest("#log-find-more") && V.log){
    for (const t of F.off.keys()) V.hidden.delete(t);
    V.tabsTouched = true; drawTabs(); render();
    if (V.mode === "novel") novel().then(m => m.refreshNovel());
    runFind(); $("#log-q").focus();
    return;
  }
  const tb = e.target.closest("#log-tabs button");
  if (tb && V.log){
    const t = +tb.dataset.tab;
    V.hidden.has(t) ? V.hidden.delete(t) : V.hidden.add(t);
    tb.setAttribute("aria-pressed", String(!V.hidden.has(t)));
    V.tabsTouched = true; tabSum();
    const pane = $("#log-pane"), top = pane.scrollTop;
    render();
    pane.scrollTop = Math.min(top, pane.scrollHeight);
    if (V.mode === "novel") novel().then(m => m.refreshNovel());
    railHere();
    if (F.q) runFind();                                              // 보이는 탭이 바뀌었으니 다시 찾음
    return;
  }
  const pb = e.target.closest("[data-bgm-play]");
  if (pb && !V.editing){ const k = +pb.dataset.bgmPlay; P.k === k && P.playing ? stopAudio() : playMark(k); return; }
  const yt = e.target.closest("[data-yt]");
  if (yt && !V.editing){
    const b = V.log.bgm[+yt.dataset.yt], id = ytId(b.url);
    if (P.playing) stopAudio();
    yt.nextElementSibling.innerHTML = `<iframe title="${esc(b.title || "유튜브 음악")}" class="yt-vol" src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&enablejsapi=1&start=${+b.start || 0}" allow="autoplay; encrypted-media" allowfullscreen loading="lazy"></iframe>`;
    const fr = yt.nextElementSibling?.querySelector("iframe") || $(".yt-slot iframe:last-of-type"); if (fr) fr.addEventListener("load", () => ytVolume(fr));
    yt.remove();
    return;
  }
  if (e.target.closest("#log-follow")){
    if (V.mode === "novel"){ novel().then(m => { const on = m.toggleSound(); $("#log-follow").setAttribute("aria-pressed", String(on)); bgmLabel(); }); return; }   // 노벨: 같은 버튼으로 노벨 BGM 켜고 끔
    P.follow = !P.follow;
    $("#log-follow").setAttribute("aria-pressed", String(P.follow));
    bgmLabel();

    P.follow ? follow() : stopAudio();
    return;
  }
  const md = e.target.closest("#log-mode button");
  if (md && V.log){
    V.mode = md.dataset.mode;
    try { localStorage.setItem(MODE_KEY, V.mode); } catch (_) {}
    applyMode(true);
    return;
  }
  const wb = e.target.closest("#log-width button");
  if (wb){ width = +wb.dataset.w; try { localStorage.setItem(WIDTH_KEY, String(width)); } catch (_) {} applyWidth(); return; }
  if (e.target.closest("#log-tabfold")){ tabFold = !tabFold; try { localStorage.setItem(TF_KEY, tabFold ? "1" : "0"); } catch (_) {} applyTabFold(); return; }
  if (e.target.closest("#log-aa")){ aaMenu($("#log-aa-menu").hidden); return; }
  const bg2 = e.target.closest("[data-big]"); if (bg2){ setBig(bg2.dataset.big === "1"); return; }
  const stb = e.target.closest("[data-st]"); if (stb){ showSt = stb.dataset.st === "1"; try { localStorage.setItem(ST_KEY, showSt ? "1" : "0"); } catch (_) {} applySt(); return; }
  if (!$("#log-aa-menu").hidden && !e.target.closest("#log-aa-menu")) aaMenu(false);
  if (e.target.closest("#log-full")){ toggleFull(); return; }
  if (e.target.closest("#log-edit")){ import("./logedit.js?v=20261031i").then(m => m.toggleEdit()); return; }
  const sz = e.target.closest(".log-size button");
  if (sz){
    size = Math.max(0, Math.min(SIZES.length - 1, size + +sz.dataset.size));
    try { localStorage.setItem(SIZE_KEY, String(size)); } catch (_) {}
    applySize();
  }
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape" || nav.current !== "log" || document.querySelector("dialog[open]")) return;
  // 여기서 처리한 Esc는 사이트 전체의 ‘Esc = 목록으로’까지 가지 않게 막음
  if (!$("#log-aa-menu").hidden){ e.stopPropagation(); aaMenu(false); $("#log-aa").focus(); return; }
  // 찾기 닫기: 찾기 칸 안에서 눌렀거나, 노벨의 지난 대사·채팅창처럼 먼저 닫을 것이 없을 때
  if (F.open && (e.target.id === "log-q" || (!$("#vn-log:not([hidden])") && !$("#vn-stage.side-open")))){ e.stopImmediatePropagation(); closeFind(); return; }
  if (big && !document.fullscreenElement && !$("#vn-log:not([hidden])")){ e.stopPropagation(); setBig(false); }
});
