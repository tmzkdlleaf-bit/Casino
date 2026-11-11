/* =========================================================
   진행 기록 — 비주얼 노벨 모드 (‘노벨’을 처음 누를 때 불러옴)
   - 코코포리아처럼 왼쪽에 말하는 사람 한 명. 대사마다 저장된 표정을 그대로 씀
   - 누르면 다음 · 자동 재생(속도 3단계) · 글자 한 자씩 · 이전/지난 대사/건너뛰기
   - 대사창은 줄 수가 정해져 있고, 긴 대사는 쪽으로 나눠 넘김 (누르면 다음 쪽 → 마지막 쪽에서 다음 대사)
   - 편집에서 넣은 배경·BGM 표시를 대사 위치에 맞춰 따라감
   - 읽던 위치는 회차마다 이 기기에 기억 (logview.js savePos — 읽기 화면·‘이어 보기’와 같이 씀)
   ========================================================= */
import { $, $$, esc } from "./dom.js?v=20261031i";
import { motionOK, state } from "./state.js?v=20261031i";
import { ALL } from "./views.js?v=20261031i";
import { SYSTEM, TAB_LABEL, V, deco, faceSrc, imgSrc, readable, stopAudio, playMark, soundOn, setSound, bgmTitle, savePos, hlClear, hlMark } from "./logview.js?v=20261031i";

const SPEEDS = [
  { label: "SPEED ×0.5", name: "느리게", char: 55, wait: 2600, per: 70 },
  { label: "SPEED ×1",   name: "보통", char: 32, wait: 1700, per: 45 },
  { label: "SPEED ×2", name: "빠르게", char: 14, wait: 900,  per: 25 }
];
const PREF_KEY = "comu-vn-pref";

const N = {
  on: false, lines: [], pos: 0, typing: false, auto: false, speed: 1,
  tTimer: 0, typeId: 0, aTimer: 0, nodes: null, total: 0, shown: 0, bgKey: null, faceKey: null, bgFlip: 0,
  side: [], upTo: -1, mine: new Set(), unread: { other: 0, secret: 0 }, openSide: null, queue: []
};
const SIDE_MAX = 120;      // 채팅창에 남겨 두는 메시지 수
try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}"); if (p.speed >= 0 && p.speed < 3) N.speed = p.speed; } catch (_) {}
const savePref = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify({ speed: N.speed })); } catch (_) {} };

/* ---------- 화면 뼈대 ---------- */
function build(){
  const box = $("#log-vn");
  if (box.dataset.built) return;
  box.dataset.built = "1";
  box.innerHTML = `
    <div class="vn-stage" id="vn-stage" role="region" aria-label="비주얼 노벨 화면 — 누르면 다음 대사" tabindex="0">
      <div class="vn-bg" aria-hidden="true"><img alt="" decoding="async"><img alt="" decoding="async"></div>
      <div class="vn-st" aria-hidden="true"><img alt="" decoding="async"></div>
      <div class="vn-edit" id="vn-edit" hidden>
        <button class="vn-ed" type="button" data-vn="ed-bg"><span class="k">배경</span><span class="v" id="vn-ed-bg"></span></button>
        <button class="vn-ed" type="button" data-vn="ed-bgm"><span class="k">BGM</span><span class="v" id="vn-ed-bgm"></span></button>
      </div>
      <div class="vn-pills" id="vn-pills"></div>
      <div class="vn-side" id="vn-side"></div>
      <div class="vn-box" id="vn-box">
        <p class="vn-name" id="vn-name"></p>
        <button class="vn-fix" type="button" data-vn="ed-line" hidden>고치기</button>
        <div class="vn-text" id="vn-text" aria-live="polite"></div>
        <span class="vn-more" id="vn-more" aria-hidden="true">▼</span>
        <div class="vn-ctl" role="toolbar" aria-label="비주얼 노벨 조작">
          <button class="vc ic" type="button" data-vn="prev" aria-label="이전 대사" title="이전 대사">◀</button>
          <button class="vc ic primary" type="button" data-vn="next" aria-label="다음 대사" title="다음 대사">▶</button>
          <span class="num" id="vn-pos"></span>
          <span class="grow"></span>
          <button class="vc save" type="button" data-vn="save" hidden disabled>저장</button>
          <button class="vc" type="button" data-vn="auto" aria-pressed="false" aria-label="자동 넘기기" title="자동 넘기기">AUTO</button>
          <button class="vc" type="button" data-vn="speed" aria-label="속도 바꾸기" title="속도 바꾸기"></button>
          <button class="vc" type="button" data-vn="log" aria-label="지난 대사" title="지난 대사">LOG</button>
          <button class="vn-pg" type="button" id="vn-pg" data-vn="page" hidden></button>
        </div>
        <label class="vn-seek"><span class="sr">대사 위치</span><input type="range" id="vn-seek" min="1" max="1" value="1"></label>
      </div>
      <div class="vn-log" id="vn-log" hidden role="dialog" aria-label="지난 대사">
        <div class="vn-log-head"><strong>지난 대사</strong><span class="grow"></span>
          <button class="btn small" type="button" data-vn="first">처음부터</button>
          <button class="btn small" type="button" data-vn="log-close">닫기</button></div>
        <ol class="vn-log-list" id="vn-log-list"></ol>
      </div>
    </div>`;
  syncButtons();
  syncEdit();
  watchText();
}

/* ---------- 지금 보이는 탭의 대사 목록 ---------- */
/* 메인 탭 → 왼쪽 대사창(한 줄씩 넘김), 그 밖의 탭 → 오른쪽에 탭마다 메시지 창 (지나갈 때 하나씩 올라옴) */
const fmtOf = t => V.log.tabs[t]?.[1] || "main";
/* 책갈피가 많을 때 고르지 않은 책갈피에 쓰는 짧은 이름: "Ho1 비밀" → "Ho1", 그 밖에는 앞 두 글자 */
const shortLabel = t => { const n = tabLabel(t), m = n.match(/^\s*(ho\s*\d+|pc\s*\d+|\d+)/i); return m ? m[1].replace(/\s+/g, "") : [...n.replace(/\s+/g, "")].slice(0, 2).join(""); };
const tabLabel = t => { const [n, f] = V.log.tabs[t]; return /^(main|info|other|secret)$/i.test(n) ? TAB_LABEL[f] || n : n; };
/* 메인 밖의 탭은 두 묶음(비밀 / 잡담·정보 등). 무대 오른쪽 위 버튼으로 하나씩 열면 무대 위에 채팅 창이 겹쳐 뜸 */
const GROUPS = [["secret", "비밀"], ["rest", "잡담"]];
const groupOf = t => fmtOf(t) === "secret" ? "secret" : "rest";
const ORDER = { secret: -1, other: 0, info: 1, main: 2 };     // 잡담 묶음 안 책갈피 순서: 잡담 → 정보 → 그 밖
const SIDE_KEY = "comu-vn-side2";                          // { open: 열어 둔 묶음, pick:{묶음: 탭 이름} } — 이 기기에 기억
let SP = { open: null, pick: {} };
try { SP = { open: null, pick: {}, ...JSON.parse(localStorage.getItem(SIDE_KEY) || "{}") }; } catch (_) {}
const saveSP = () => { try { localStorage.setItem(SIDE_KEY, JSON.stringify(SP)); } catch (_) {} };
const win = t => $(`.vn-chat[data-t="${t}"]`);

function collect(){
  const log = V.log;
  N.lines = []; N.side = [];
  log.m.forEach((x, i) => { if (V.hidden.has(x[0])) return; (fmtOf(x[0]) === "main" ? N.lines : N.side).push(i); });
  $("#vn-seek").max = Math.max(1, N.lines.length);
  // 내 캐릭터 이름: 채팅창에서 오른쪽 말풍선으로
  const mine = new Set(state.mine.map(m => m.uuid));
  N.mine = new Set(ALL().filter(c => mine.has(c.uuid)).map(c => c.name.trim()));
  // 이 사람에게 보이는 메인 밖의 탭을 두 묶음으로
  // 비밀은 이름·번호 순(Ho1, Ho2, HO3…), 잡담 묶음은 잡담 → 정보 → 그 밖 (같은 종류끼리는 처음 나온 순)
  const tabs = [...new Set(N.side.map(i => log.m[i][0]))].sort((a, b) => ORDER[fmtOf(a)] - ORDER[fmtOf(b)]
    || (fmtOf(a) === "secret" ? log.tabs[a][0].localeCompare(log.tabs[b][0], "ko", { numeric: true, sensitivity: "base" }) : 0) || a - b);
  // 창은 하나: 위쪽 글자 탭에 비밀(분홍) → 잡담·정보 순. 오른쪽 위 [비밀] [잡담] 버튼은 그 묶음의 마지막으로 본 탭을 엶
  N.active = {}; N.tabs = tabs;
  for (const [g] of GROUPS){ const ts = tabs.filter(t => groupOf(t) === g); if (ts.length) N.active[g] = ts.find(t => log.tabs[t][0] === SP.pick[g]) ?? ts[0]; }
  const gs = GROUPS.filter(([g]) => N.active[g] != null);
  const dense = tabs.length > 5;
  const mark = t => `<button type="button" role="tab" class="vn-mark f-${fmtOf(t)}" data-mark="${t}" aria-selected="false" title="${esc(tabLabel(t))}"><span class="nm">${esc(dense && fmtOf(t) === "secret" ? shortLabel(t) : tabLabel(t))}</span><span class="n"></span></button>`;
  $("#vn-side").innerHTML = tabs.length ? `<section class="vn-grp" hidden aria-label="메인 밖의 탭">
      <header><div class="vn-marks" role="tablist">${tabs.map((t, k) => (k && groupOf(t) !== groupOf(tabs[k - 1]) ? `<span class="sep" aria-hidden="true"></span>` : "") + mark(t)).join("")}</div>
        <button type="button" class="vn-chat-x" data-vn="side-close" aria-label="닫기">×</button></header>
      ${tabs.map(t => `<div class="vn-chat f-${fmtOf(t)}" data-t="${t}" role="tabpanel" hidden><ol class="vn-chat-list"></ol></div>`).join("")}
    </section>` : "";
  $("#vn-pills").innerHTML = gs.map(([g, label]) => `<button type="button" class="vn-pill g-${g}" data-side="${g}" aria-pressed="false">${label}<span class="n"></span></button>`).join("");
  for (const q of N.queue) clearTimeout(q.timer); N.queue = [];
  N.upTo = -1; N.unread = {}; N.cur = null;
  setSide(gs.some(([g]) => g === SP.open) ? SP.open : null, true);
}

/* ---------- 메시지 창 ---------- */
/* 정보 미리보기 제목: [제목]·【제목】처럼 맨 앞 괄호가 있으면 그 안의 말, 아니면 첫 줄의 첫 문장 (길면 자름) */
function previewOf(text){
  const plain = String(text).replace(/\*\*?|\{#[0-9a-fA-F]{3,6}\||\}/g, "").trim();
  let rest = plain;
  const br = plain.match(/^[\[【『「〈《(]([^\]】』」〉》)\n]{1,30})[\]】』」〉》)]\s*/);
  if (br){
    // [정보]·[공지]처럼 탭 이름 같은 말이면 건너뛰고 뒤 문장을 제목으로
    if (!/^(정보|info|공지|안내|알림|메모|note)$/i.test(br[1].trim()) && plain.length > br[0].length) return br[1].trim();
    rest = plain.slice(br[0].length);
  }
  const line = rest.split("\n").find(l => l.trim()) || "";
  const sent = (line.match(/^.+?[.!?。！？…](?=\s|$)/) || [line])[0].trim();
  return [...sent].length > 28 ? [...sent].slice(0, 27).join("") + "…" : sent || "정보";
}
const hhmm = sec => { if (!sec) return ""; const d = new Date(sec * 1000); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
function chatHtml(i, fresh){
  const log = V.log, [t, s, text, , tm] = log.m[i], [name, color, narr] = log.sp[s];
  const time = tm ? `<time class="tm">${hhmm(tm)}</time>` : "";
  const quiet = !name || SYSTEM.test(name) || narr;
  const cls = fresh ? " fresh" : "";
  // 정보 탭: 제목(첫 단어나 첫 문장)만 보이고, 누르면 그 자리에서 전문을 펼침
  if (fmtOf(t) === "info") return `<li class="info${cls}" data-i="${i}"><button type="button" class="vn-info" data-note aria-expanded="false"><span class="ttl">${esc(previewOf(text))}</span>${time}<span class="arw" aria-hidden="true">▸</span></button><div class="body" hidden>${quiet ? "" : `<p class="who" style="color:${readable(color)}">${esc(name)}</p>`}${deco(esc(text))}</div></li>`;
  if (quiet) return `<li class="q${cls}" data-i="${i}">${deco(esc(text))}${time}</li>`;
  const me = N.mine.has(name.trim());
  return `<li class="${me ? "mine" : ""}${cls}" data-i="${i}"><span class="who" style="color:${readable(color)}">${esc(name)}</span><span class="row"><span class="bub">${deco(esc(text))}</span>${time}</span></li>`;
}
const toBottom = list => { list.scrollTop = list.scrollHeight; };    // 새 메시지가 오면 늘 맨 아래(최신)로
function badge(t){
  const n = N.unread[t] || 0;
  const m = $(`.vn-mark[data-mark="${t}"] .n`); if (m) m.textContent = n ? n : "";
  const g = groupOf(t), sum = Object.entries(N.unread).filter(([k, v]) => v && groupOf(+k) === g).reduce((a, [, v]) => a + v, 0);
  const b = $(`.vn-pill[data-side="${g}"] .n`); if (b) b.textContent = sum ? sum : "";
}
/* 지금 눈에 보이는 탭인지: 그 묶음이 열려 있고 그 책갈피가 골라져 있을 때 */
const visible = t => N.openSide != null && N.cur === t;
function appendSide(k, fresh){
  const t = V.log.m[k][0], w = win(t);
  if (!w) return;
  const list = w.querySelector(".vn-chat-list");
  list.insertAdjacentHTML("beforeend", chatHtml(k, fresh));
  while (list.children.length > SIDE_MAX) list.firstElementChild.remove();
  toBottom(list);
  if (fresh && !visible(t)){ N.unread[t] = (N.unread[t] || 0) + 1; badge(t); }
}
function flushQueue(){                                     // 아직 안 올라온 것을 바로 붙임 (다음 대사로 넘어갈 때)
  for (const q of N.queue || []){ clearTimeout(q.timer); if (!q.done) appendSide(q.k, false); }
  N.queue = [];
}
/* 대사 번호 i 앞까지의 옆 내용을 보여 줌
   - 앞으로 한 줄 가면: 그 사이에 올라온 것만 한 개씩 차례로 (보낸 시간이 있으면 실제 간격에 맞춰, 없으면 일정하게)
   - 뒤로 가거나 건너뛰면: 그 위치까지를 한 번에 다시 그림 */
function showSide(i, last, step){
  const until = last ? Infinity : i;                       // 마지막 대사에서는 뒤에 남은 것까지 전부
  const forward = N.upTo >= 0 && until >= N.upTo && step;  // 한 줄 앞으로 갈 때만 하나씩, 막대로 건너뛰면 한 번에
  flushQueue();
  if (!forward){
    $$(".vn-chat-list").forEach(l => l.innerHTML = "");
    const items = N.side.filter(k => k < until), keep = {}, pick = [];
    for (let j = items.length - 1; j >= 0; j--){ const t = V.log.m[items[j]][0]; keep[t] = (keep[t] ?? SIDE_MAX) - 1; if (keep[t] >= 0) pick.push(items[j]); }
    pick.reverse().forEach(k => appendSide(k, false));
    $$(".vn-chat-list").forEach(toBottom);
  } else {
    const items = N.side.filter(k => k >= N.upTo && k < until);
    let delay = 0, lastT = (N.pos > 0 ? V.log.m[N.lines[N.pos - 1]]?.[4] : 0) || 0;
    N.queue = items.map(k => {
      const tm = V.log.m[k][4];
      // 실제 간격 g초 → 0.25~1.5초, 시간이 없으면 0.45초씩
      delay += !motionOK() ? 0 : tm && lastT ? 250 + Math.min(1250, Math.max(0, tm - lastT) * 60) : 450;
      if (tm) lastT = tm;
      const q = { k, done: false };
      q.timer = setTimeout(() => { q.done = true; appendSide(k, motionOK()); }, delay);
      return q;
    });
  }
  N.upTo = until === Infinity ? V.log.m.length : until;
}
/* 글자 탭: 창 안에서 탭 바꾸기 */
function pickTab(t, quiet){
  const g = groupOf(t);
  N.cur = t; N.active[g] = t;
  $$(".vn-chat").forEach(w => { w.hidden = +w.dataset.t !== t; });
  $$(".vn-mark").forEach(b => b.setAttribute("aria-selected", String(+b.dataset.mark === t)));
  if (N.openSide !== g){ N.openSide = g; syncPills(); }
  if (!quiet){ SP.pick[g] = V.log.tabs[t][0]; SP.open = g; saveSP(); }
  seen(t);
}
function seen(t){ if (t == null) return; N.unread[t] = 0; badge(t); const l = win(t)?.querySelector(".vn-chat-list"); if (l) toBottom(l); }
function syncPills(){ $$(".vn-pill").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.side === N.openSide))); $("#vn-stage")?.classList.toggle("side-open", !!N.openSide); }
/* 창 열기(그 묶음의 탭으로)·닫기 — 이 기기에 기억 */
function setSide(g, quiet){
  N.openSide = g || null;
  const grpEl = $(".vn-grp"); if (grpEl) grpEl.hidden = !N.openSide;
  syncPills();
  if (N.openSide) pickTab(N.active[N.openSide], true);
  if (!quiet){ SP.open = N.openSide; saveSP(); }
}

/* 대사 번호 i 직전(같은 번호 포함)의 마지막 표시 */
const markAt = (list, i) => { let k = -1; (list || []).forEach((b, j) => { if (b.at <= i) k = j; }); return k; };

/* ---------- 배경 ---------- */
function showBg(i){
  const log = V.log, k = markAt(log.bg, i), src = k >= 0 ? imgSrc(log.bg[k].url) : "";
  if (src === N.bgKey) return;
  N.bgKey = src;
  const imgs = $$(".vn-bg img"), stage = $("#vn-stage");
  stage.classList.toggle("has-bg", !!src);
  if (!src){ imgs.forEach(im => im.classList.remove("on")); return; }
  const next = imgs[N.bgFlip ^= 1], prev = imgs[N.bgFlip ^ 1];
  next.onload = () => { next.classList.add("on"); prev.classList.remove("on"); };
  next.onerror = () => { next.classList.remove("on"); };
  next.src = src;
  if (next.complete && next.naturalWidth) next.onload();
}

/* ---------- 스탠딩 (왼쪽 한 명) ---------- */
let siteFaces = null;
function standingOf(s, f){
  const [name] = V.log.sp[s];
  const st = faceSrc(V.log, f);
  if (st) return st;
  siteFaces ??= new Map(ALL().filter(c => c.img || c.thumb).map(c => [c.name.trim(), c.img || c.thumb]));
  return siteFaces.get((name || "").trim()) || "";
}
function showStanding(src, s){
  const wrap = $(".vn-st"), img = $(".vn-st img");
  const key = src ? s + "|" + src : "";
  if (key === N.faceKey) return;
  const sameSpeaker = N.faceKey && key && N.faceKey.split("|")[0] === String(s);
  N.faceKey = key;
  if (!src){ wrap.classList.remove("on"); return; }
  const swap = () => {
    img.src = src;
    wrap.classList.remove("enter", "change");
    if (motionOK()){ void wrap.offsetWidth; wrap.classList.add(sameSpeaker ? "change" : "enter"); }
    wrap.classList.add("on");
  };
  // 새 이미지를 먼저 받아 두고 바꿈 (깜빡임 없이)
  const pre = new Image(); pre.decoding = "async"; pre.src = src;
  (pre.decode ? pre.decode() : Promise.resolve()).catch(() => {}).then(() => { if (N.faceKey === key) swap(); });
}

/* 다음 몇 줄의 표정·배경을 미리 받아 둠 */
function preload(pos){
  const log = V.log;
  for (let p = pos + 1; p <= pos + 4 && p < N.lines.length; p++){
    const [, s, , f] = log.m[N.lines[p]], src = standingOf(s, f);
    if (src){ const im = new Image(); im.src = src; }
  }
  const nb = (log.bg || []).find(b => b.at > N.lines[pos]);
  if (nb && nb.url){ const im = new Image(); im.src = imgSrc(nb.url); }
}

/* BGM: logview의 재생기 하나를 같이 씀 (읽기↔노벨 바꿔도 같은 곡이면 이어짐) */
function syncBgm(i){
  const k = markAt(V.log.bgm, i), b = k >= 0 ? V.log.bgm[k] : null, key = b && b.kind !== "stop" ? k : -1;
  if (soundOn()) playMark(key);
  else bgmTitle(key >= 0 ? b.title : "");
}

/* ---------- 한 자씩 + 쪽 넘김 ----------
   대사창은 줄 수가 정해져 있음 (이름 한 줄 + 대사 몇 줄 — site.css의 --vn-lines).
   대사가 그보다 길면 쪽으로 나눠, 누를 때마다 다음 쪽을 보이고 마지막 쪽에서 다음 대사로 넘어감.
   글자는 처음부터 제자리에 깔아 두고 가려 두었다가(.h) 차례로 드러냄 → 글자가 나오는 동안 줄바꿈이 흔들리지 않음 */
const PG = { n: 1, i: 0, step: 1, w: 0, h: 0, set: 0 };   // 쪽 수, 지금 쪽, 한 쪽 높이, 잰 때의 창 크기, 우리가 맞춘 스크롤 위치
const txEl = () => $("#vn-text");
function setScroll(y){ const tx = txEl(); PG.set = Math.round(y); tx.scrollTop = PG.set; }
function layoutPages(){
  const tx = txEl();
  tx.style.paddingBottom = "0px";
  const h = tx.clientHeight, full = tx.scrollHeight;
  const lh = parseFloat(getComputedStyle(tx).lineHeight) || h || 1;
  PG.step = Math.max(1, Math.floor((h + 1) / lh)) * lh;                 // 한 쪽 = 창에 온전히 들어가는 줄 수만큼
  PG.n = full <= h + 1 ? 1 : Math.max(1, Math.ceil((full - 2) / PG.step));   // 창 안에 다 들어가면 한 쪽
  PG.i = 0; PG.w = tx.clientWidth; PG.h = h;
  // 마지막 쪽도 새 쪽 맨 위에서 시작하게 아래를 채움 (앞 쪽의 끝줄이 다시 보이지 않게)
  tx.style.paddingBottom = PG.n > 1 ? Math.max(0, Math.ceil((PG.n - 1) * PG.step + h - full)) + "px" : "";
  setScroll(0);
  syncPage();
}
function syncPage(){
  const b = $("#vn-pg"); if (!b) return;
  const more = PG.i < PG.n - 1;
  b.hidden = PG.n < 2; b.disabled = !more;
  b.textContent = `${PG.i + 1}/${PG.n}${more ? " ▼" : ""}`;
  b.setAttribute("aria-label", more ? `다음 쪽 보기 (${PG.n}쪽 중 ${PG.i + 1}쪽)` : `마지막 쪽 (${PG.n}쪽 중 ${PG.n}쪽)`);
  syncNav();
}
function syncNav(){
  const p = $('[data-vn="prev"]'); if (!p) return;
  p.disabled = N.pos === 0 && PG.i === 0;
  $('[data-vn="next"]').disabled = N.pos >= N.lines.length - 1 && PG.i >= PG.n - 1 && !N.typing;
}
function pageTo(i){
  const tx = txEl();
  PG.i = Math.max(0, Math.min(PG.n - 1, i));
  setScroll(PG.i * PG.step);
  syncPage();
  tx.classList.remove("flip");
  if (motionOK()){ void tx.offsetWidth; tx.classList.add("flip"); }
}

function stopTyping(){ clearTimeout(N.tTimer); N.typing = false; }
/* 가려 둔 글자를 모두 보임 */
function revealAll(){
  if (N.nodes) for (const n of N.nodes){ n.node.data = n.chars.join(""); n.hid.remove(); }
  N.nodes = null; N.shown = N.total;
  txEl().setAttribute("aria-busy", "false");
}
/* 앞에서부터 k글자까지 보임 (줄어들지는 않음) */
function reveal(k){
  let left = k;
  for (const n of N.nodes){
    const show = Math.max(0, Math.min(n.chars.length, left));
    if (show !== n.shown){ n.shown = show; n.node.data = n.chars.slice(0, show).join(""); n.hid.textContent = n.chars.slice(show).join(""); }
    left -= n.chars.length;
    if (left <= 0) break;
  }
  N.shown = Math.min(k, N.total);
}
/* 아직 가려진 첫 글자가 놓인 줄의 위치 (대사 글 맨 위 기준). 잴 수 없으면 -1, 다 보였으면 Infinity */
function frontTop(){
  const tx = txEl();
  for (const n of N.nodes || []) if (n.shown < n.chars.length){
    const r = n.hid.getClientRects()[0];
    return r ? r.top - tx.getBoundingClientRect().top + tx.scrollTop : -1;
  }
  return Infinity;
}
/* 한 쪽(또는 대사 전체)이 다 나옴: 다음 표시를 띄우고, 자동 넘김이면 시간을 잼 */
function pageDone(){
  stopTyping();
  if (N.shown >= N.total) revealAll();
  $("#vn-more").classList.add("on");
  syncNav();
  scheduleAuto();
}
function finishTyping(){ stopTyping(); revealAll(); pageDone(); }
function typeLoop(){
  // 지난 시간으로 몇 글자를 보일지 계산 (브라우저가 타이머를 늦춰도 속도가 일정하게)
  const per = SPEEDS[N.speed].char, id = ++N.typeId, t0 = performance.now() - N.shown * per;
  N.typing = true;
  const tick = () => {
    if (!N.typing || id !== N.typeId) return;
    const want = Math.min(N.total, Math.floor((performance.now() - t0) / per) + 1);
    if (want > N.shown) reveal(want);
    if (N.shown >= N.total || frontTop() >= (PG.i + 1) * PG.step - 1){ pageDone(); return; }   // 다 나왔거나 이 쪽을 다 채움
    N.tTimer = setTimeout(tick, 16);   // 숨은 탭에서도 멈추지 않게 (늦어져도 지난 시간만큼 한꺼번에 보임)
  };
  tick();
}
/* 대사 글을 넣은 뒤 부름: 쪽을 나누고, 꾸밈(굵게·색)을 살린 채로 글자만 차례로 드러냄 */
function startText(instant){
  const tx = txEl();
  stopTyping();
  tx.classList.remove("flip");
  layoutPages();                                            // 글이 모두 깔린 상태에서 쪽 수를 잼
  const walker = document.createTreeWalker(tx, NodeFilter.SHOW_TEXT), list = [];
  while (walker.nextNode()) if (walker.currentNode.data) list.push(walker.currentNode);
  N.total = list.reduce((k, n) => k + [...n.data].length, 0); N.shown = 0; N.nodes = null;
  if (instant || !motionOK() || !N.total){ N.shown = N.total; tx.setAttribute("aria-busy", "false"); pageDone(); return; }
  N.nodes = list.map(node => {
    const chars = [...node.data], hid = document.createElement("span");
    hid.className = "h"; hid.textContent = node.data;
    node.data = ""; node.after(hid);
    return { node, hid, chars, shown: 0 };
  });
  tx.setAttribute("aria-busy", "true");                     // 읽어 주는 프로그램은 다 나온 뒤 한 번에
  typeLoop();
}
function pageNext(){
  stopTyping(); clearTimeout(N.aTimer);
  $("#vn-more").classList.remove("on");
  pageTo(PG.i + 1);
  if (!N.nodes){ pageDone(); return; }
  // 새 쪽의 첫 글자까지는 바로 보이고(앞 쪽에서 덜 나온 글자 포함), 거기서부터 다시 한 자씩
  const top = PG.i * PG.step - 1;
  for (let guard = 0; N.shown < N.total && frontTop() < top && guard < 4000; guard++) reveal(N.shown + 8);
  if (N.shown >= N.total) pageDone(); else typeLoop();
}
function pagePrev(){
  stopTyping(); clearTimeout(N.aTimer);
  revealAll();
  pageTo(PG.i - 1);
  pageDone();
}
/* 대사 글을 손으로(휠·밀기) 움직이면: 가려 둔 글자를 모두 보이고, 가까운 쪽 번호로 맞춤 */
function onTextScroll(){
  const tx = txEl();
  if (!N.on || Math.abs(tx.scrollTop - PG.set) <= 1) return;        // 쪽 넘김으로 움직인 것
  PG.set = tx.scrollTop;
  PG.i = Math.max(0, Math.min(PG.n - 1, Math.round(tx.scrollTop / PG.step)));
  syncPage();
  if (N.nodes || N.typing) finishTyping();
}
/* 창 크기나 글자 크기가 바뀌면 쪽을 다시 나눔 (보던 쪽 근처에서 이어 감) */
let ro = null;
function watchText(){
  const tx = txEl();
  tx.addEventListener("scroll", onTextScroll, { passive: true });
  if (ro || !window.ResizeObserver) return;
  ro = new ResizeObserver(() => {
    if (!N.on || !tx.clientHeight || (tx.clientWidth === PG.w && tx.clientHeight === PG.h)) return;
    const at = PG.n > 1 ? PG.i / PG.n : 0;
    stopTyping(); revealAll();
    layoutPages();
    if (at) pageTo(Math.round(at * PG.n));
    pageDone();
  });
  ro.observe(tx);
}

/* ---------- 자동 재생 ---------- */
function scheduleAuto(){
  clearTimeout(N.aTimer);
  if (!N.auto || N.typing) return;
  // 기다리는 시간은 지금 쪽의 글자 수만큼 (여러 쪽이면 쪽마다 나눠서)
  const i = N.lines[N.pos], len = Math.ceil([...(V.log.m[i]?.[2] || "")].length / PG.n), sp = SPEEDS[N.speed];
  N.aTimer = setTimeout(() => {
    if (!N.auto || !N.on) return;
    if (PG.i < PG.n - 1){ pageNext(); return; }
    if (N.pos >= N.lines.length - 1){ setAuto(false); return; }
    go(N.pos + 1);
  }, sp.wait + Math.min(len, 160) * sp.per);
}
function setAuto(on){
  N.auto = on;
  syncButtons();
  if (on && !N.typing) scheduleAuto(); else if (!on) clearTimeout(N.aTimer);
}

/* ---------- 한 줄 보여 주기 ---------- */
function go(pos, { instant = false } = {}){
  if (!N.lines.length){ emptyState(); return; }
  const prevPos = N.on && N.upTo >= 0 ? N.pos : -2;
  N.pos = Math.max(0, Math.min(N.lines.length - 1, pos));
  const log = V.log, i = N.lines[N.pos], [t, s, text, f = -1] = log.m[i], [tab, format] = log.tabs[t], [name, color, narr] = log.sp[s];
  stopTyping(); clearTimeout(N.aTimer);
  $("#vn-more").classList.remove("on");

  const isSys = !name || SYSTEM.test(name), isNarr = !isSys && narr;
  const box = $("#vn-box");
  box.className = `vn-box f-${format}${isSys ? " sys" : isNarr ? " narr" : ""}`;
  const label = /^(main|메인|メイン)$/i.test(tab) ? "" : /^(info|other|secret)$/i.test(tab) ? TAB_LABEL[format] : tab;
  const tag = label ? `<span class="lg-tab">${esc(label)}</span>` : "";
  const nm = $("#vn-name");
  if (isSys || isNarr){ nm.innerHTML = tag; nm.hidden = !tag; nm.style.removeProperty("--c"); }
  else { nm.hidden = false; nm.style.setProperty("--c", readable(color)); nm.innerHTML = `<span class="n">${esc(name)}</span>${tag}`; }
  hlClear();                                                // 찾기 표시는 그 대사에 있을 때만
  const tx = $("#vn-text");
  tx.innerHTML = text.split("\n").map(l => `<span class="ln">${deco(esc(l))}</span>`).join("\n");
  startText(instant);

  showStanding(isSys || isNarr ? "" : standingOf(s, f), s);
  showSide(i, N.pos === N.lines.length - 1, N.pos === prevPos + 1);
  showBg(i);
  syncBgm(i);
  preload(N.pos);

  $("#vn-seek").value = N.pos + 1;
  $("#vn-seek").style.setProperty("--seek", (N.lines.length > 1 ? N.pos / (N.lines.length - 1) * 100 : 100) + "%");
  $("#vn-pos").textContent = `${(N.pos + 1).toLocaleString("ko-KR")} / ${N.lines.length.toLocaleString("ko-KR")}`;
  syncNav();
  if (!N.quiet) savePos(N.pos >= N.lines.length - 1 ? log.m.length - 1 : i);   // 읽던 자리 기억. 마지막 대사까지 오면 ‘다 읽음’
  if (!$("#vn-log").hidden) drawLog();
  if (V.editing) syncEdit();
}

function emptyState(){
  stopTyping(); N.nodes = null;
  $("#vn-name").hidden = true;
  $("#vn-text").textContent = "메인 탭 대사가 없습니다.";
  layoutPages();
  showStanding("", -1);
  showSide(0, true);
  $("#vn-pos").textContent = "";
}

/* 누르면 늘 앞으로 (글자가 나오는 중이어도): 이 대사에 아직 안 본 쪽이 있으면 다음 쪽, 없으면 다음 대사.
   마지막 대사에서는 남은 글자만 마저 보임 */
function next(){
  if (PG.i < PG.n - 1){ pageNext(); return; }
  if (N.typing && N.pos >= N.lines.length - 1){ finishTyping(); return; }
  if (N.pos < N.lines.length - 1) go(N.pos + 1);
  else if (N.auto) setAuto(false);
}
function prev(){ if (PG.i > 0) pagePrev(); else if (N.pos > 0) go(N.pos - 1); }

/* ---------- 지난 대사 ---------- */
const LOG_MAX = 300;
function drawLog(){
  const log = V.log, from = Math.max(0, N.pos - LOG_MAX + 1);
  const items = [];
  for (let p = from; p <= N.pos; p++){
    const i = N.lines[p], [, s, text] = log.m[i], [name, color, narr] = log.sp[s];
    const quiet = !name || SYSTEM.test(name) || narr;
    items.push(`<li${p === N.pos ? ' aria-current="true"' : ""}><button type="button" data-vn-jump="${p}">
      ${quiet ? "" : `<span class="n" style="color:${readable(color)}">${esc(name)}</span>`}<span class="t${quiet ? " q" : ""}">${deco(esc(text))}</span></button></li>`);
  }
  $("#vn-log-list").innerHTML = (from > 0 ? `<li class="more">앞의 ${from.toLocaleString("ko-KR")}줄은 아래 막대로 건너뛸 수 있습니다.</li>` : "") + items.join("");
}
function openLogPanel(){
  setAuto(false);
  drawLog();
  const p = $("#vn-log"); p.hidden = false;
  const list = $("#vn-log-list"); list.scrollTop = list.scrollHeight;
  $('[data-vn="log-close"]').focus();
}
function closeLogPanel(){ $("#vn-log").hidden = true; $("#vn-stage").focus({ preventScroll: true }); }

function syncButtons(){
  const a = $('[data-vn="auto"]'); if (!a) return;
  a.setAttribute("aria-pressed", String(N.auto));
  a.textContent = "AUTO";
  $('[data-vn="speed"]').textContent = SPEEDS[N.speed].label; $('[data-vn="speed"]').setAttribute("aria-label", "속도: " + SPEEDS[N.speed].name);
  $("#log-follow")?.setAttribute("aria-pressed", String(soundOn()));
  import("./logview.js?v=20261031i").then(m => m.bgmLabel());

}

/* ---------- 편집 (관리자): 지금 대사 위치에 배경·BGM 넣기, 대사 고치기, 저장 ---------- */
function syncEdit(){
  const on = !!V.editing && N.on, ed = $("#vn-edit");
  if (!ed) return;
  ed.hidden = !on; $(".vn-fix").hidden = !on; $('[data-vn="save"]').hidden = !on;
  $("#vn-stage").classList.toggle("editing", on);
  if (!on || !V.log) return;
  const i = N.lines[N.pos] ?? 0;
  const k = markAt(V.log.bg, i), bg = k >= 0 ? V.log.bg[k] : null;
  const j = markAt(V.log.bgm, i), bgm = j >= 0 ? V.log.bgm[j] : null;
  $("#vn-ed-bg").textContent = !bg || !bg.url ? "없음" : bg.title || "이미지";
  $("#vn-ed-bgm").textContent = !bgm || bgm.kind === "stop" ? "없음" : bgm.title || "음악";
  // 이 대사에서 바뀌는 표시면 강조 (누르면 그 표시를 고침)
  $('[data-vn="ed-bg"]').classList.toggle("here", !!bg && bg.at === i);
  $('[data-vn="ed-bgm"]').classList.toggle("here", !!bgm && bgm.at === i);
}
document.addEventListener("comu:log-edit", () => { if (N.on){ syncEdit(); } });
document.addEventListener("comu:log-dirty", e => {
  const b = $('[data-vn="save"]'); if (!b) return;
  const n = e.detail || 0;
  b.disabled = !n; b.textContent = n ? `변경 ${n}건 저장` : "저장";
});

/* 위 막대의 BGM 버튼 (logview.js가 부름) */
export function toggleSound(){ setSound(!soundOn()); if (!soundOn()) stopAudio(); syncBgm(N.lines[N.pos] ?? 0); return soundOn(); }

/* ---------- 여닫기 (logview.js가 부름) ---------- */
/* from: 시작할 대사 번호 (읽기 화면에서 보던 자리·‘이어 보기’ 자리). 없으면 처음부터 */
export function openNovel(from = -1){
  build();
  N.on = true; N.bgKey = null; N.faceKey = null; siteFaces = null;
  collect();
  let start = 0;
  if (from > 0){ const p = N.lines.findIndex(i => i >= from); start = p >= 0 ? p : Math.max(0, N.lines.length - 1); }
  syncButtons();
  N.quiet = true; go(start); N.quiet = false;               // 여는 것만으로는 읽던 자리를 바꾸지 않음
  syncEdit();
  $("#vn-stage").focus({ preventScroll: true });
}
export function closeNovel(){
  if (!N.on) return -1;
  N.on = false;
  stopTyping(); revealAll(); setAuto(false);
  for (const q of N.queue) clearTimeout(q.timer); N.queue = [];
  return N.lines[N.pos] ?? -1;                                     // 읽기 화면이 이 대사로 옮겨 감
}
/* 탭을 켜고 끄면 목록만 다시 만들고 같은 대사 근처에서 이어 감 */
export function refreshNovel(){
  if (!N.on) return;
  const cur = N.lines[N.pos] ?? 0;
  collect();
  const p = N.lines.findIndex(i => i >= cur);
  go(p >= 0 ? p : N.lines.length - 1);
}

/* ---------- 찾기 (logview.js가 부름) ---------- */
export const nowLine = () => N.on ? N.lines[N.pos] ?? -1 : -1;
/* i번 대사로 가서 찾는 말에 표시. 메인 대사면 대사창에, 그 밖의 탭이면 바로 다음 메인 대사로 가서 그 탭 채팅창을 열고 그 글을 보임 */
export function findJump(i, q){
  if (!N.on || !V.log?.m[i]) return;
  setAuto(false);
  if (!$("#vn-log").hidden) closeLogPanel();
  const t = V.log.m[i][0], main = fmtOf(t) === "main";
  let p = N.lines.findIndex(x => x >= i);
  if (p < 0) p = N.lines.length - 1;
  go(p, { instant: true });
  if (main){
    // 찾는 말이 뒤쪽에 있으면 그 쪽으로 넘김
    const r = hlMark($("#vn-text"), q, true), tx = txEl();
    if (r && PG.n > 1){ const y = r.getBoundingClientRect().top - tx.getBoundingClientRect().top + tx.scrollTop; pageTo(Math.floor((y + 2) / PG.step)); }
    return;
  }
  flushQueue();
  setSide(groupOf(t), true); pickTab(t, true);
  const li = $(`.vn-chat[data-t="${t}"] li[data-i="${i}"]`);
  if (!li) return;
  const note = li.querySelector("[data-note]");
  if (note && note.nextElementSibling.hidden){ note.nextElementSibling.hidden = false; note.setAttribute("aria-expanded", "true"); note.classList.add("read"); }
  hlMark(li, q, true);
  const list = li.closest(".vn-chat-list");                 // 그 글이 채팅창 가운데 오게 (창 안에서만 움직임)
  list.scrollTop += li.getBoundingClientRect().top - list.getBoundingClientRect().top - (list.clientHeight - li.offsetHeight) / 2;
  li.classList.add("hit"); setTimeout(() => li.classList.remove("hit"), 1600);
}

/* ---------- 조작 ---------- */
document.addEventListener("click", e => {
  if (!N.on) return;
  const note = e.target.closest("[data-note]");
  if (note){ const p = note.nextElementSibling, open = p.hidden; p.hidden = !open; note.setAttribute("aria-expanded", String(open)); note.classList.add("read"); if (open){ setAuto(false); const l = note.closest(".vn-chat-list"); if (l && note.closest("li") === l.lastElementChild) toBottom(l); } return; }
  const mark = e.target.closest("[data-mark]");
  if (mark){ pickTab(+mark.dataset.mark); return; }
  const sideBtn = e.target.closest("[data-side]");
  if (sideBtn){ setSide(N.openSide === sideBtn.dataset.side ? null : sideBtn.dataset.side); return; }
  const jump = e.target.closest("[data-vn-jump]");
  if (jump){ closeLogPanel(); go(+jump.dataset.vnJump); return; }
  const b = e.target.closest("[data-vn]");
  if (b){
    const act = b.dataset.vn;
    if (act === "next") next();
    else if (act === "page") next();
    else if (act === "prev"){ setAuto(false); prev(); }
    else if (act === "auto") setAuto(!N.auto);
    else if (act === "speed"){ N.speed = (N.speed + 1) % SPEEDS.length; savePref(); syncButtons(); if (N.auto && !N.typing) scheduleAuto(); }
    else if (act === "log") $("#vn-log").hidden ? openLogPanel() : closeLogPanel();
    else if (act === "log-close") closeLogPanel();
    else if (act === "side-close") setSide(null);
    else if (act === "first"){ closeLogPanel(); go(0); }
    else if (act === "ed-bg" || act === "ed-bgm" || act === "ed-line" || act === "save"){
      setAuto(false);
      const i = N.lines[N.pos];
      import("./logedit.js?v=20261031i").then(m => act === "save" ? m.saveEdits() : act === "ed-line" ? m.editLineAt(i) : act === "ed-bg" ? m.editBgAt(i) : m.editBgmAt(i));
    }
    else if (act === "sound"){ toggleSound(); syncButtons(); }
    // 마우스·손가락으로 누른 조작 버튼에 초점이 남으면 스페이스·화살표가 그 버튼에 먹힘 → 무대로 돌려, 바로 키로 넘길 수 있게 (키보드로 누른 경우는 그대로)
    if (e.detail && /^(next|page|prev|auto|speed)$/.test(act)) $("#vn-stage").focus({ preventScroll: true });
    return;
  }
  // 무대(대사창 포함)를 누르면 다음. 지난 대사·채팅창·쪽지는 제외. 쪽지가 펼쳐져 있으면 먼저 접음
  if (e.target.closest("#vn-stage") && !e.target.closest("#vn-log, .vn-side, .vn-pills, .vn-ctl, .vn-seek, .vn-edit")) next();
});

document.addEventListener("input", e => {
  if (N.on && e.target.id === "vn-seek"){ setAuto(false); go(+e.target.value - 1); }
});

document.addEventListener("keydown", e => {
  if (!N.on || e.altKey || e.ctrlKey || e.metaKey) return;
  if (document.querySelector("dialog[open]")) return;
  const tag = e.target.tagName;
  if (tag === "INPUT" && e.target.id !== "vn-seek" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (!e.target.closest?.("#log-vn") && e.target !== document.body) return;
  if (!$("#vn-log").hidden){ if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); closeLogPanel(); } return; }
  if (e.key === "Escape" && N.openSide != null){ e.preventDefault(); e.stopPropagation(); setSide(null); return; }
  if (e.target.closest?.(".vn-side, .vn-ctl, .vn-seek")) return;
  if (e.target.id === "vn-seek" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
  if (e.target.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return;   // 버튼은 버튼대로
  if ([" ", "Enter", "ArrowRight", "ArrowDown", "PageDown"].includes(e.key)){ e.preventDefault(); next(); }
  else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)){ e.preventDefault(); setAuto(false); prev(); }
  else if (e.key === "a" || e.key === "A") setAuto(!N.auto);
  else if (e.key === "l" || e.key === "L") openLogPanel();
});
