/* =========================================================
   진행 기록 보기 — #story/회차번호  (이 화면에 처음 들어올 때만 불러옴)
   가볍게: ① 기록은 작게 저장된 JSON 한 개 ② 화면에는 50묶음씩 나눠 붙이고, 첫 두 묶음만 바로 그린 뒤
   나머지는 브라우저가 한가할 때 이어 붙임 ③ 화면 밖 묶음은 content-visibility로 그리기를 건너뜀
   ========================================================= */
import { publicUrl } from "./data.js";
import { $, $$, esc, setTitle } from "./dom.js";
import { DATA, nav, state } from "./state.js";
import { ALL } from "./views.js";

const cache = new Map();          // 주소 → 기록 JSON
const SIZE_KEY = "comu-log-size";
const SIZES = [.9375, 1, 1.0625, 1.1875, 1.3125];
let size = 2;
try { const v = +localStorage.getItem(SIZE_KEY); if (v >= 0 && v < SIZES.length) size = v; } catch (_) {}

export const V = { log: null, hidden: new Set(), job: 0, number: null, chapter: null, editing: false };
const TAB_LABEL = { info: "정보", secret: "비밀", other: "잡담" };

/* ---------- 다이스 (나비코코 변환기와 같은 규칙) ---------- */
function parseDice(text){
  if (text.includes("\n") || !/[＞→]/.test(text)) return null;
  const parts = text.split(/\s*[＞]\s*/);
  if (parts.length < 2) return null;
  const command = parts[0];
  if (!/\d*[dD]\d+|CCB?|CC\b|SCCB|RES|choice|x\d/i.test(command)) return null;
  const result = parts[parts.length - 1];
  return { command, result, grade: gradeDice(result) };
}
function gradeDice(result){
  const r = result.toLowerCase();
  if (/펌블|대실패|치명적\s*실패|ファンブル|致命的失敗|fumble/.test(r)) return "fumble";
  if (/크리티컬|대성공|결정적\s*성공|クリティカル|決定的成功|スペシャル|critical|special/.test(r)) return "critical";
  if (/실패|失敗|failure/.test(r)) return "failure";
  if (/성공|成功|success/.test(r)) return "success";
  return "neutral";
}

/* ---------- 이름 색: 어두운 창 위에서 4.5:1 이상 보이도록 밝힘 ---------- */
const lum = hex => {
  const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return .2126 * v[0] + .7152 * v[1] + .0722 * v[2];
};
const BG_L = lum("#181715");
const colorCache = new Map();
function readable(hex){
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return "#EDE3C8";
  if (colorCache.has(hex)) return colorCache.get(hex);
  let [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)), out = hex;
  for (let k = 0; k < 12 && (lum(out) + .05) / (BG_L + .05) < 4.5; k++){
    r += (237 - r) * .2; g += (227 - g) * .2; b += (200 - b) * .2;           // 아이보리 쪽으로 조금씩
    out = "#" + [r, g, b].map(n => Math.round(n).toString(16).padStart(2, "0")).join("");
  }
  colorCache.set(hex, out);
  return out;
}

/* ---------- 묶음 만들기: 같은 사람이 같은 탭·같은 표정으로 이어 말하면 한 덩어리. BGM 표시가 있으면 거기서 끊음 ---------- */
const SYSTEM = /^(system|시스템|システム)$/i;
function groups(log){
  const out = [], marks = new Map();
  (log.bgm || []).forEach((b, k) => { if (!marks.has(b.at)) marks.set(b.at, []); marks.get(b.at).push(k); });
  let last = null;
  log.m.forEach(([t, s, text, f = -1], i) => {
    if (marks.has(i)){ for (const k of marks.get(i)) out.push({ bgm: k }); last = null; }
    if (V.hidden.has(t)) return;
    if (last && last.t === t && last.s === s && last.f === f){ last.lines.push(i); return; }
    last = { t, s, f, lines: [i] };
    out.push(last);
  });
  for (const [at, ks] of marks) if (at >= log.m.length) for (const k of ks) out.push({ bgm: k });   // 맨 끝에 붙은 표시
  return out;
}

export const faceSrc = (log, f) => { const u = f >= 0 && log.faces?.[f]; return !u ? "" : /^(https?:|data:)/.test(u) ? u : publicUrl("logs", u); };
export const audioSrc = u => !u ? "" : /^https?:/.test(u) ? u : publicUrl("logs", u);
const ytId = u => (String(u || "").match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/) || [])[1];

function para(text, i){
  const d = parseDice(text);
  if (d) return `<p class="lg-dice g-${d.grade}" data-i="${i}"><span class="cmd">${esc(d.command)}</span><span class="arr" aria-hidden="true">›</span><span class="res">${esc(d.result)}</span></p>`;
  return `<p data-i="${i}">${deco(esc(text))}</p>`;
}

/* 꾸밈 문법 (나비코코 변환기와 같은 표기): **굵게**, *기울임*, {#색|글자}. 이미 이스케이프된 글에만 적용 */
function deco(h){
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

function groupHtml(g, log, faces){
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
  $("#log-tabs").innerHTML = log.tabs.map(([name, format], t) => {
    const n = log.m.reduce((k, x) => k + (x[0] === t), 0);
    const label = /^(main|info|other|secret)$/i.test(name) ? { main: "메인", ...TAB_LABEL }[format] : name;
    return `<button type="button" data-tab="${t}" aria-pressed="${!V.hidden.has(t)}">${esc(label)}<span class="num"> ${n.toLocaleString("ko-KR")}</span></button>`;
  }).join("");
  $("#log-tabs").hidden = log.tabs.length < 2;
}

function applySize(){ $("#log-body").style.setProperty("--lg-fs", SIZES[size] + "rem"); }

/* ---------- 여닫기 ---------- */
export async function openLog(number){
  const c = DATA.chapters.find(x => String(x.number) === String(number));
  if (!c) return;
  V.number = c.number;
  $("#log-ep").textContent = `제${c.number}화${c.date ? " · " + c.date : ""}`;
  $("#log-title").textContent = c.title;
  setTitle(`제${c.number}화 ${c.title}`);
  $("#log-meta").textContent = "";
  $("#log-tabs").innerHTML = "";
  applySize();
  const box = $("#log-body");
  $("#log-edit").hidden = true; $("#log-follow").hidden = true;
  stopAudio(); V.editing = false; box.classList.remove("editing");
  if (!c.log){ box.innerHTML = `<p class="empty-note">이 회차에는 아직 진행 기록이 없습니다.</p>`; $("#log-tabs").hidden = true; return; }
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
  if (V.number !== c.number || nav.current !== "log") return;          // 기다리는 사이 다른 화면으로 옮김
  V.log = cache.get(c.log);
  V.hidden = new Set(V.log.tabs.map(([, f], t) => f === "other" ? t : -1).filter(t => t >= 0));   // 잡담은 처음엔 접어 둠
  V.chapter = c;
  $("#log-meta").textContent = `대사 ${V.log.m.length.toLocaleString("ko-KR")}개`;
  $("#log-edit").hidden = !state.isAdmin;
  $("#log-follow").hidden = !(V.log.bgm || []).some(b => b.kind === "audio");
  drawTabs();
  render();
}

/* ---------- 구간 BGM ----------
   ‘BGM 따라 듣기’를 켜면 읽는 위치(창 위에서 40%)를 지난 마지막 BGM 표시의 음악이 흐름. 누르기 전에는 재생하지 않음 */
const P = { audio: null, k: -1, playing: false, follow: false, timer: 0 };
const VOL = .4;
function fadeTo(a, v, ms = 800, done){
  clearInterval(a._f);
  const from = a.volume, t0 = performance.now();
  a._f = setInterval(() => { const x = Math.min(1, (performance.now() - t0) / ms); a.volume = from + (v - from) * x; if (x >= 1){ clearInterval(a._f); done?.(); } }, 40);
}
function playK(k){
  const b = V.log.bgm[k];
  if (!b || b.kind !== "audio"){ stopAudio(); return; }
  if (P.k === k && P.playing) return;
  const old = P.audio;
  if (old) fadeTo(old, 0, 600, () => old.pause());
  const a = new Audio(audioSrc(b.url));
  a.loop = true; a.volume = 0;
  a.play().then(() => { fadeTo(a, VOL); }).catch(() => { P.playing = false; syncButtons(); });
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
addEventListener("hashchange", () => { if (!location.hash.startsWith("#story/")){ stopAudio(); P.follow = false; $("#log-follow")?.setAttribute("aria-pressed", "false"); } });

/* ---------- 조작 ---------- */
document.addEventListener("click", e => {
  const tb = e.target.closest("#log-tabs button");
  if (tb && V.log){
    const t = +tb.dataset.tab;
    V.hidden.has(t) ? V.hidden.delete(t) : V.hidden.add(t);
    tb.setAttribute("aria-pressed", String(!V.hidden.has(t)));
    const pane = $("#log-pane"), top = pane.scrollTop;
    render();
    pane.scrollTop = Math.min(top, pane.scrollHeight);
    return;
  }
  const pb = e.target.closest("[data-bgm-play]");
  if (pb && !V.editing){ const k = +pb.dataset.bgmPlay; P.k === k && P.playing ? stopAudio() : playK(k); return; }
  const yt = e.target.closest("[data-yt]");
  if (yt && !V.editing){
    const b = V.log.bgm[+yt.dataset.yt], id = ytId(b.url);
    if (P.playing) stopAudio();
    yt.nextElementSibling.innerHTML = `<iframe title="${esc(b.title || "유튜브 음악")}" src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&start=${+b.start || 0}" allow="autoplay; encrypted-media" allowfullscreen loading="lazy"></iframe>`;
    yt.remove();
    return;
  }
  if (e.target.closest("#log-follow")){
    P.follow = !P.follow;
    $("#log-follow").setAttribute("aria-pressed", String(P.follow));
    P.follow ? follow() : stopAudio();
    return;
  }
  if (e.target.closest("#log-edit")){ import("./logedit.js").then(m => m.toggleEdit()); return; }
  const sz = e.target.closest(".log-size button");
  if (sz){
    size = Math.max(0, Math.min(SIZES.length - 1, size + +sz.dataset.size));
    try { localStorage.setItem(SIZE_KEY, String(size)); } catch (_) {}
    applySize();
    $$(".log-size button").forEach(b => b.disabled = (b.dataset.size === "-1" && size === 0) || (b.dataset.size === "1" && size === SIZES.length - 1));
  }
});
