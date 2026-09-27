/* =========================================================
   진행 기록 보기 — #story/회차번호  (이 화면에 처음 들어올 때만 불러옴)
   가볍게: ① 기록은 작게 저장된 JSON 한 개 ② 화면에는 50묶음씩 나눠 붙이고, 첫 두 묶음만 바로 그린 뒤
   나머지는 브라우저가 한가할 때 이어 붙임 ③ 화면 밖 묶음은 content-visibility로 그리기를 건너뜀
   ========================================================= */
import { $, $$, esc, setTitle } from "./dom.js";
import { DATA, nav } from "./state.js";
import { ALL } from "./views.js";

const cache = new Map();          // 주소 → 기록 JSON
const SIZE_KEY = "comu-log-size";
const SIZES = [.9375, 1, 1.0625, 1.1875, 1.3125];
let size = 2;
try { const v = +localStorage.getItem(SIZE_KEY); if (v >= 0 && v < SIZES.length) size = v; } catch (_) {}

const V = { log: null, hidden: new Set(), job: 0, number: null };
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

/* ---------- 묶음 만들기: 같은 사람이 같은 탭에서 이어 말하면 한 덩어리 ---------- */
const SYSTEM = /^(system|시스템|システム)$/i;
function groups(log){
  const out = [];
  let last = null;
  for (const [t, s, text] of log.m){
    if (V.hidden.has(t)) continue;
    if (last && last.t === t && last.s === s){ last.lines.push(text); continue; }
    last = { t, s, lines: [text] };
    out.push(last);
  }
  return out;
}

function para(text){
  const d = parseDice(text);
  if (d) return `<p class="lg-dice g-${d.grade}"><span class="cmd">${esc(d.command)}</span><span class="arr" aria-hidden="true">›</span><span class="res">${esc(d.result)}</span></p>`;
  return `<p>${deco(esc(text))}</p>`;
}

/* 꾸밈 문법 (나비코코 변환기와 같은 표기): **굵게**, *기울임*, {#색|글자}. 이미 이스케이프된 글에만 적용 */
function deco(h){
  if (!/[*{]/.test(h)) return h;
  return h
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\{(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\|([^{}]+)\}/g, (_, c, t) => `<span style="color:${readable(c.length === 4 ? "#" + [...c.slice(1)].map(x => x + x).join("") : c.toLowerCase())}">${t}</span>`);
}

function groupHtml(g, log, faces){
  const [tab, format] = log.tabs[g.t], [name, color, narr] = log.sp[g.s];
  const body = g.lines.map(para).join("");
  // 기본 메인 탭이 아니면 탭 이름을 작게 붙임 (영문 기본 이름은 한국어로)
  const label = /^(main|메인|メイン)$/i.test(tab) ? "" : /^(info|other|secret)$/i.test(tab) ? TAB_LABEL[format] : tab;
  const tag = label ? `<span class="lg-tab">${esc(label)}</span>` : "";
  if (!name || SYSTEM.test(name)) return `<div class="lg-sys f-${format}">${body}</div>`;
  if (narr) return `<div class="lg-narr f-${format}">${tag}${body}</div>`;
  const c = readable(color), face = faces.get(name);
  const av = face
    ? `<span class="lg-av"><img src="${esc(face.src)}" alt="" loading="lazy" decoding="async"></span>`
    : `<span class="lg-av ini" style="--c:${c}" aria-hidden="true">${esc([...name][0])}</span>`;
  return `<article class="lg f-${format}">${av}<div class="lg-b"><p class="lg-n" style="color:${c}">${esc(name)}${tag}</p>${body}</div></article>`;
}

/* ---------- 그리기: 나눠서, 한가할 때 ---------- */
const idle = window.requestIdleCallback || (fn => setTimeout(() => fn({ timeRemaining: () => 8 }), 16));
const CHUNK = 50;

function render(){
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
  $("#log-meta").textContent = `대사 ${V.log.n.toLocaleString("ko-KR")}개`;
  drawTabs();
  render();
}

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
  const sz = e.target.closest(".log-size button");
  if (sz){
    size = Math.max(0, Math.min(SIZES.length - 1, size + +sz.dataset.size));
    try { localStorage.setItem(SIZE_KEY, String(size)); } catch (_) {}
    applySize();
    $$(".log-size button").forEach(b => b.disabled = (b.dataset.size === "-1" && size === 0) || (b.dataset.size === "1" && size === SIZES.length - 1));
  }
});
