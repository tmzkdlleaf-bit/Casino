/* =========================================================
   진행 기록 보기 — #story/회차번호  (이 화면에 처음 들어올 때만 불러옴)
   가볍게: ① 기록은 작게 저장된 JSON 한 개 ② 화면에는 50묶음씩 나눠 붙이고, 첫 두 묶음만 바로 그린 뒤
   나머지는 브라우저가 한가할 때 이어 붙임 ③ 화면 밖 묶음은 content-visibility로 그리기를 건너뜀
   ========================================================= */
import { publicUrl, sb } from "./data.js?v=20261031g";
import { guessTabFormat } from "./logparse.js?v=20261031g";
import { loadSecrets, mergeLog } from "./logsecret.js?v=20261031g";
import { $, $$, esc, setTitle } from "./dom.js?v=20261031g";
import { DATA, nav, state } from "./state.js?v=20261031g";
import { ALL } from "./views.js?v=20261031g";

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

export const V = { log: null, hidden: new Set(), job: 0, number: null, chapter: null, editing: false, mode: "read", secretsOk: true };
const MODE_KEY = "comu-log-mode";
try { if (localStorage.getItem(MODE_KEY) === "novel") V.mode = "novel"; } catch (_) {}
export const TAB_LABEL = { info: "정보", secret: "비밀", other: "잡담" };

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
  box.innerHTML = "";
  if (!list.length){ box.innerHTML = `<p class="empty-note">보이는 탭에 대사가 없습니다.</p>`; return; }
  let i = 0;
  const addChunk = () => {
    const html = list.slice(i, i + CHUNK).map(g => groupHtml(g, log, faces)).join("");
    box.insertAdjacentHTML("beforeend", `<div class="lg-chunk">${html}</div>`);
    i += CHUNK;
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
  $("#log-tabbar").hidden = log.tabs.length < 2;
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
document.addEventListener("click", e => {
  const b = e.target.closest("[data-rail]"); if (!b || !V.log) return;
  const at = V.log.bg[+b.dataset.rail].at;
  render({ upTo: at });
  requestAnimationFrame(() => { const el = $(`#log-body [data-bk="${b.dataset.rail}"]`); el?.scrollIntoView({ block: "start" }); railHere(); });
});

/* ---------- 읽기 / 노벨 ---------- */
const novel = () => import("./novel.js?v=20261031g");
async function applyMode(){
  const vn = V.mode === "novel" && !!V.log;
  $$("#log-mode button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === (vn ? "novel" : "read"))));
  $("#log-pane").hidden = vn;
  $("#log-vn").hidden = !vn;
  $(".log-box").classList.toggle("is-vn", vn);
  $("#log-rail").hidden = vn || !(V.log?.bg || []).some(b => b.url);
  P.follow = false; stopAudio(); $("#log-follow").setAttribute("aria-pressed", "false"); bgmLabel();   // 모드를 바꾸면 BGM은 꺼진 상태에서 시작
  syncVol(vn);
  $("#log-edit").hidden = !state.isAdmin || !V.log;     // 편집은 읽기·노벨 둘 다에서
  const eb = $("#log-editbar"); if (eb) eb.hidden = vn || !V.editing;
  document.body.classList.toggle("vn-on", vn);
  $$("#log-width button").forEach(b => { b.disabled = vn; });   // 노벨에서는 쓸 일이 없지만 자리는 그대로
  // 노벨에서는 잡담이 채팅창으로 나오므로, 직접 탭을 끈 적이 없으면 잡담 탭을 켬 (읽기 화면 기본값은 접힘)
  if (vn && !V.tabsTouched && V.log){ let ch = false; V.log.tabs.forEach(([, f], t) => { if (f === "other" && V.hidden.delete(t)) ch = true; }); if (ch){ drawTabs(); render(); } }
  $('[data-page="log"]').classList.toggle("folded", false);
  const m = await novel();
  if (vn) m.openNovel(); else m.closeNovel();
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
  $("#log-tabs").innerHTML = ""; $("#log-tabbar").hidden = true; aaMenu(false); $("#log-rail").hidden = true;
  $('[data-page="log"]').classList.remove("folded");
  applySize(); applyWidth(); applyBig(); applySt(); bgmTitle(); applyTabFold();
  const box = $("#log-body");
  $("#log-edit").hidden = true; $("#log-snd").hidden = true;
  $("#log-mode").hidden = true; $("#log-pane").hidden = false; $("#log-vn").hidden = true; $(".log-box").classList.remove("is-vn");
  import("./novel.js?v=20261031g").then(m => m.closeNovel()).catch(() => {});
  stopAudio(); V.editing = false; box.classList.remove("editing"); document.body.classList.remove("vn-on");
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
  if (V.mode === "novel") applyMode();
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
function playK(k){
  const b = V.log.bgm[k];
  bgmTitle(b?.kind === "audio" ? b.title : "");
  if (!b || b.kind !== "audio"){ stopAudio(); return; }
  if (P.k === k && P.playing) return;
  const old = P.audio;
  if (old) fadeTo(old, 0, 600, () => old.pause());
  const a = new Audio(audioSrc(b.url));
  a.loop = true; a.volume = 0;
  a.play().then(() => { fadeTo(a, VOL()); }).catch(() => { P.playing = false; syncButtons(); });
  document.dispatchEvent(new CustomEvent("comu:bgm-pause"));        // 사이트 배경음악은 잠시 멈춤
  Object.assign(P, { audio: a, k, playing: true });
  syncButtons();
}
export function stopAudio(){
  if (P.audio){ const a = P.audio; fadeTo(a, 0, 500, () => a.pause()); }
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
  if (k < 0 || !b || b.kind !== "audio"){ if (P.playing) stopAudio(); return; }
  playK(k);
}
document.addEventListener("scroll", e => {
  if (e.target.id !== "log-pane" || !P.follow) return;
  clearTimeout(P.timer); P.timer = setTimeout(follow, 250);
}, true);
addEventListener("hashchange", () => { if (!location.hash.startsWith("#story/")){ stopAudio(); novel().then(m => m.closeNovel()); document.body.classList.remove("log-big", "vn-on"); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); P.follow = false; $("#log-follow")?.setAttribute("aria-pressed", "false"); } });

/* ---------- 조작 ---------- */
document.addEventListener("click", e => {
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
    return;
  }
  const pb = e.target.closest("[data-bgm-play]");
  if (pb && !V.editing){ const k = +pb.dataset.bgmPlay; P.k === k && P.playing ? stopAudio() : playK(k); return; }
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
    applyMode();
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
  if (e.target.closest("#log-edit")){ import("./logedit.js?v=20261031g").then(m => m.toggleEdit()); return; }
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
  if (big && !document.fullscreenElement && !$("#vn-log:not([hidden])")){ e.stopPropagation(); setBig(false); }
});
