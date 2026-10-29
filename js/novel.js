/* =========================================================
   진행 기록 — 비주얼 노벨 모드 (‘노벨’을 처음 누를 때 불러옴)
   - 코코포리아처럼 왼쪽에 말하는 사람 한 명. 대사마다 저장된 표정을 그대로 씀
   - 누르면 다음 · 자동 재생(속도 3단계) · 글자 한 자씩 · 이전/지난 대사/건너뛰기
   - 편집에서 넣은 배경·BGM 표시를 대사 위치에 맞춰 따라감
   - 읽던 위치는 회차마다 이 기기에 기억
   ========================================================= */
import { $, $$, esc } from "./dom.js?v=20261029g";
import { motionOK, state } from "./state.js?v=20261029g";
import { ALL } from "./views.js?v=20261029g";
import { SYSTEM, TAB_LABEL, V, audioSrc, deco, faceSrc, imgSrc, readable, stopAudio, ytId } from "./logview.js?v=20261029g";

const SPEEDS = [
  { label: "느리게", char: 55, wait: 2600, per: 70 },
  { label: "보통",   char: 32, wait: 1700, per: 45 },
  { label: "빠르게", char: 14, wait: 900,  per: 25 }
];
const PREF_KEY = "comu-vn-pref";
const POS_KEY = n => "comu-vn-pos-" + n;
const VOL = .4;

const N = {
  on: false, lines: [], pos: 0, typing: false, auto: false, speed: 1, sound: false,
  tTimer: 0, aTimer: 0, nodes: null, bgKey: null, bgmKey: null, audio: null, faceKey: null, bgFlip: 0,
  side: [], upTo: -1, mine: new Set(), unread: { other: 0, secret: 0 }, openSide: null, queue: []
};
const SIDE_MAX = 120;      // 채팅창에 남겨 두는 메시지 수
try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}"); if (p.speed >= 0 && p.speed < 3) N.speed = p.speed; N.sound = !!p.sound; } catch (_) {}
const savePref = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify({ speed: N.speed, sound: N.sound })); } catch (_) {} };

/* ---------- 화면 뼈대 ---------- */
function build(){
  const box = $("#log-vn");
  if (box.dataset.built) return;
  box.dataset.built = "1";
  box.innerHTML = `
    <div class="vn-stage" id="vn-stage" role="region" aria-label="비주얼 노벨 화면 — 누르면 다음 대사" tabindex="0">
      <div class="vn-bg" aria-hidden="true"><img alt="" decoding="async"><img alt="" decoding="async"></div>
      <div class="vn-st" aria-hidden="true"><img alt="" decoding="async"></div>
      <div class="vn-box" id="vn-box">
        <p class="vn-name" id="vn-name"></p>
        <div class="vn-text" id="vn-text" aria-live="polite"></div>
        <span class="vn-more" id="vn-more" aria-hidden="true">▼</span>
      </div>
      <div class="vn-side" id="vn-side" aria-label="메인 밖의 탭"></div>
      <div class="vn-sidebtns" id="vn-sidebtns"></div>
      <div class="vn-log" id="vn-log" hidden role="dialog" aria-label="지난 대사">
        <div class="vn-log-head"><strong>지난 대사</strong><span class="grow"></span>
          <button class="btn small" type="button" data-vn="first">처음부터</button>
          <button class="btn small" type="button" data-vn="log-close">닫기</button></div>
        <ol class="vn-log-list" id="vn-log-list"></ol>
      </div>
    </div>
    <div class="vn-ctl" role="toolbar" aria-label="비주얼 노벨 조작">
      <div class="vn-ctl-main">
        <button class="btn small" type="button" data-vn="prev" aria-label="이전 대사">◀ 이전</button>
        <button class="btn small primary" type="button" data-vn="next" aria-label="다음 대사">다음 ▶</button>
        <button class="btn small log-btn" type="button" data-vn="auto" aria-pressed="false">자동</button>
        <button class="btn small" type="button" data-vn="speed" aria-label="속도 바꾸기"></button>
        <button class="btn small" type="button" data-vn="log">지난 대사</button>
        <button class="btn small log-btn" type="button" data-vn="sound" aria-pressed="false">BGM</button>
      </div>
      <label class="vn-seek"><span class="sr">대사 위치</span><input type="range" id="vn-seek" min="1" max="1" value="1"><span class="num" id="vn-pos"></span></label>
    </div>`;
  syncButtons();
}

/* ---------- 지금 보이는 탭의 대사 목록 ---------- */
/* 메인 탭 → 왼쪽 대사창(한 줄씩 넘김), 그 밖의 탭 → 오른쪽에 탭마다 메시지 창 (지나갈 때 하나씩 올라옴) */
const fmtOf = t => V.log.tabs[t]?.[1] || "main";
const tabLabel = t => { const [n, f] = V.log.tabs[t]; return /^(main|info|other|secret)$/i.test(n) ? TAB_LABEL[f] || n : n; };
/* 오른쪽은 두 묶음: 안쪽(왼쪽)=비밀 탭들, 바깥쪽(오른쪽)=잡담과 그 밖의 탭들. 묶음 위의 책갈피로 탭을 오감 */
const GROUPS = [["secret", "비밀"], ["rest", "잡담"]];
const groupOf = t => fmtOf(t) === "secret" ? "secret" : "rest";
const ORDER = { other: 0, info: 1, secret: 0, main: 2 };     // 잡담 묶음 안 책갈피 순서: 잡담 → 정보 → 그 밖
const SIDE_KEY = "comu-vn-side";                           // { fold:[묶음], pick:{묶음: 탭 이름} } — 이 기기에 기억
let SP = { fold: [], pick: {} };
try { SP = { fold: [], pick: {}, ...JSON.parse(localStorage.getItem(SIDE_KEY) || "{}") }; } catch (_) {}
const saveSP = () => { try { localStorage.setItem(SIDE_KEY, JSON.stringify(SP)); } catch (_) {} };
const win = t => $(`.vn-chat[data-t="${t}"]`);
const grp = g => $(`.vn-grp[data-g="${g}"]`);

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
  N.active = {};
  const html = GROUPS.map(([g, label]) => {
    const ts = tabs.filter(t => groupOf(t) === g);
    if (!ts.length) return "";
    const want = ts.find(t => log.tabs[t][0] === SP.pick[g]);
    const act = want ?? ts[0];
    N.active[g] = act;
    return `<section class="vn-grp g-${g}" data-g="${g}" ${SP.fold.includes(g) ? 'data-folded="true"' : ""} aria-label="${label} 묶음">
      <header>
        <div class="vn-marks" role="tablist">${ts.map(t => `<button type="button" role="tab" class="vn-mark f-${fmtOf(t)}" data-mark="${t}" aria-selected="${t === act}">${esc(tabLabel(t))}<span class="n"></span></button>`).join("")}</div>
        <button type="button" class="vn-fold" data-fold="${g}" aria-expanded="${!SP.fold.includes(g)}" aria-label="${label} 묶음 접기·펴기"><span aria-hidden="true">▾</span></button>
        <button type="button" class="vn-chat-x" data-vn="side-close" aria-label="닫기">×</button>
      </header>
      ${ts.map(t => `<div class="vn-chat f-${fmtOf(t)}" data-t="${t}" role="tabpanel" ${t === act ? "" : "hidden"}><ol class="vn-chat-list"></ol></div>`).join("")}
    </section>`;
  }).join("");
  $("#vn-side").innerHTML = html;
  const gs = GROUPS.filter(([g]) => N.active[g] != null);
  $("#vn-sidebtns").innerHTML = gs.map(([g, label]) => `<button type="button" class="vn-sidebtn g-${g}" data-side="${g}">${label} <span class="n"></span></button>`).join("");
  $("#vn-stage").classList.toggle("has-side", gs.length > 0);
  $("#vn-stage").classList.toggle("two-side", gs.length > 1);
  for (const q of N.queue) clearTimeout(q.timer); N.queue = [];
  N.upTo = -1; N.unread = {}; setSide(null);
}

/* ---------- 메시지 창 ---------- */
const hhmm = sec => { if (!sec) return ""; const d = new Date(sec * 1000); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
function chatHtml(i, fresh){
  const log = V.log, [t, s, text, , tm] = log.m[i], [name, color, narr] = log.sp[s];
  const time = tm ? `<time class="tm">${hhmm(tm)}</time>` : "";
  const quiet = !name || SYSTEM.test(name) || narr;
  const cls = fresh ? " fresh" : "";
  // 정보 탭: 접힌 쪽지 — 누르면 그 자리에서 펼침
  if (fmtOf(t) === "info") return `<li class="note${cls}"><button type="button" class="vn-note" data-note aria-expanded="false"><span class="ic" aria-hidden="true"></span><span class="t">쪽지</span><span class="w">${quiet ? "" : esc(name)}</span>${time}</button><div class="paper" hidden>${deco(esc(text))}</div></li>`;
  if (quiet) return `<li class="q${cls}">${deco(esc(text))}${time}</li>`;
  const me = N.mine.has(name.trim());
  return `<li class="${me ? "mine" : ""}${cls}"><span class="who" style="color:${readable(color)}">${esc(name)}</span><span class="row"><span class="bub">${deco(esc(text))}</span>${time}</span></li>`;
}
const toBottom = list => { list.scrollTop = list.scrollHeight; };    // 새 메시지가 오면 늘 맨 아래(최신)로
function badge(t){
  const n = N.unread[t] || 0;
  const m = $(`.vn-mark[data-mark="${t}"] .n`); if (m) m.textContent = n ? n : "";
  const g = groupOf(t), sum = Object.entries(N.unread).filter(([k, v]) => v && groupOf(+k) === g).reduce((a, [, v]) => a + v, 0);
  const b = $(`.vn-sidebtn[data-side="${g}"] .n`); if (b) b.textContent = sum ? sum : "";
}
/* 지금 눈에 보이는 탭인지: 묶음이 펴져 있고, 그 책갈피가 골라져 있고, (휴대폰이면) 그 묶음이 열려 있을 때 */
const visible = t => { const g = groupOf(t), el = grp(g); return el && el.dataset.folded !== "true" && N.active[g] === t && (!isNarrow() || N.openSide === g); };
function appendSide(k, fresh){
  const t = V.log.m[k][0], w = win(t);
  if (!w) return;
  const list = w.querySelector(".vn-chat-list");
  list.insertAdjacentHTML("beforeend", chatHtml(k, fresh));
  while (list.children.length > SIDE_MAX) list.firstElementChild.remove();
  toBottom(list);
  if (fresh && !visible(t)){ N.unread[t] = (N.unread[t] || 0) + 1; badge(t); }
}
const isNarrow = () => getComputedStyle($("#vn-sidebtns")).display !== "none";   // 휴대폰처럼 좁으면 버튼으로 엶
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
/* 묶음 접고 펴기 (넓은 화면) — 이 기기에 기억 */
function toggleFold(g){
  const el = grp(g), fold = el.dataset.folded !== "true";
  if (fold){ el.dataset.folded = "true"; SP.fold = [...new Set([...SP.fold, g])]; }
  else { delete el.dataset.folded; SP.fold = SP.fold.filter(x => x !== g); seen(N.active[g]); }
  el.querySelector(".vn-fold").setAttribute("aria-expanded", String(!fold));
  saveSP();
}
/* 책갈피: 묶음 안에서 탭 바꾸기 */
function pickTab(t){
  const g = groupOf(t), el = grp(g);
  N.active[g] = t;
  el.querySelectorAll(".vn-chat").forEach(w => { w.hidden = +w.dataset.t !== t; });
  el.querySelectorAll(".vn-mark").forEach(b => b.setAttribute("aria-selected", String(+b.dataset.mark === t)));
  if (el.dataset.folded === "true") toggleFold(g);
  SP.pick[g] = V.log.tabs[t][0]; saveSP();
  seen(t);
}
function seen(t){ if (t == null) return; N.unread[t] = 0; badge(t); const l = win(t)?.querySelector(".vn-chat-list"); if (l) toBottom(l); }
/* 휴대폰: 묶음 버튼으로 하나씩 열고 닫음 */
function setSide(g){
  N.openSide = g || null;
  $("#vn-side")?.setAttribute("data-open", N.openSide ?? "");
  $$(".vn-grp").forEach(el => el.classList.toggle("is-open", el.dataset.g === N.openSide));
  if (N.openSide) seen(N.active[N.openSide]);
  $$(".vn-sidebtn").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.side === N.openSide)));
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

/* ---------- BGM: 표시 위치를 따라감. ‘BGM’을 켠 사람만 ---------- */
function fade(a, v, ms, done){
  clearInterval(a._f);
  const from = a.volume, t0 = performance.now();
  a._f = setInterval(() => { const x = Math.min(1, (performance.now() - t0) / ms); a.volume = from + (v - from) * x; if (x >= 1){ clearInterval(a._f); done?.(); } }, 40);
}
function stopVnAudio(){
  if (N.audio){ const a = N.audio; fade(a, 0, 500, () => a.pause()); N.audio = null; }
  const yt = $("#vn-yt"); if (yt) yt.remove();
}
function syncBgm(i){
  const log = V.log, k = markAt(log.bgm, i), b = k >= 0 ? log.bgm[k] : null;
  const key = N.sound && b && b.kind !== "stop" ? k : -1;
  if (key === N.bgmKey) return;
  N.bgmKey = key;
  stopVnAudio();
  if (key < 0) return;
  document.dispatchEvent(new CustomEvent("comu:bgm-pause"));      // 사이트 배경음악은 잠시 멈춤
  if (b.kind === "audio"){
    const a = new Audio(audioSrc(b.url));
    a.loop = true; a.volume = 0;
    a.play().then(() => fade(a, VOL, 800)).catch(() => {});
    N.audio = a;
  } else if (b.kind === "youtube"){
    const id = ytId(b.url);
    if (!id) return;
    $("#log-vn").insertAdjacentHTML("beforeend", `<iframe id="vn-yt" class="vn-yt" title="${esc(b.title || "배경음악")}" tabindex="-1" aria-hidden="true"
      src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&loop=1&playlist=${id}&start=${+b.start || 0}&controls=0" allow="autoplay; encrypted-media"></iframe>`);
  }
}

/* ---------- 한 자씩 ---------- */
function stopTyping(){ clearTimeout(N.tTimer); N.typing = false; }
function finishTyping(){
  stopTyping();
  if (N.nodes) for (const n of N.nodes) n.node.textContent = n.full;
  N.nodes = null;
  $("#vn-more").classList.add("on");
  scheduleAuto();
}
function typeText(el){
  // 꾸밈(굵게·색)을 살린 채로 글자만 차례로 채움
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push({ node: walker.currentNode, full: walker.currentNode.textContent });
  N.nodes = nodes;
  if (!motionOK()){ finishTyping(); return; }
  nodes.forEach(n => n.node.textContent = "");
  let ni = 0, ci = 0;
  N.typing = true;
  const step = () => {
    if (!N.typing) return;
    let n = nodes[ni];
    while (n && ci >= [...n.full].length){ ni++; ci = 0; n = nodes[ni]; }
    if (!n){ finishTyping(); return; }
    const chars = [...n.full];
    ci++;
    n.node.textContent = chars.slice(0, ci).join("");
    N.tTimer = setTimeout(step, chars[ci - 1] === "\n" ? SPEEDS[N.speed].char * 4 : SPEEDS[N.speed].char);
  };
  step();
}

/* ---------- 자동 재생 ---------- */
function scheduleAuto(){
  clearTimeout(N.aTimer);
  if (!N.auto || N.typing) return;
  const i = N.lines[N.pos], len = [...(V.log.m[i]?.[2] || "")].length, sp = SPEEDS[N.speed];
  N.aTimer = setTimeout(() => {
    if (!N.auto || !N.on) return;
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
function go(pos){
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
  const tx = $("#vn-text");
  tx.innerHTML = text.split("\n").map(l => `<span class="ln">${deco(esc(l))}</span>`).join("\n");
  typeText(tx);

  showStanding(isSys || isNarr ? "" : standingOf(s, f), s);
  showSide(i, N.pos === N.lines.length - 1, N.pos === prevPos + 1);
  showBg(i);
  syncBgm(i);
  preload(N.pos);

  $("#vn-seek").value = N.pos + 1;
  $("#vn-pos").textContent = `${(N.pos + 1).toLocaleString("ko-KR")} / ${N.lines.length.toLocaleString("ko-KR")}`;
  $('[data-vn="prev"]').disabled = N.pos === 0;
  $('[data-vn="next"]').disabled = N.pos >= N.lines.length - 1 && !N.typing;
  try { localStorage.setItem(POS_KEY(V.number), String(i)); } catch (_) {}
  if (!$("#vn-log").hidden) drawLog();
}

function emptyState(){
  $("#vn-name").hidden = true;
  $("#vn-text").textContent = N.side.length ? "메인 탭 대사가 없습니다. 다른 탭은 오른쪽 창에서 볼 수 있습니다." : "보이는 탭에 대사가 없습니다.";
  showStanding("", -1);
  showSide(0, true);
  $("#vn-pos").textContent = "";
}

function next(){
  if (N.typing){ finishTyping(); return; }
  if (N.pos < N.lines.length - 1) go(N.pos + 1);
  else if (N.auto) setAuto(false);
}
function prev(){ if (N.pos > 0) go(N.pos - 1); }

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
  a.textContent = N.auto ? "자동 끄기" : "자동";
  $('[data-vn="speed"]').textContent = "속도: " + SPEEDS[N.speed].label;
  const snd = $('[data-vn="sound"]');
  snd.setAttribute("aria-pressed", String(N.sound));
  snd.hidden = !(V.log?.bgm || []).some(b => b.kind !== "stop");
}

/* ---------- 여닫기 (logview.js가 부름) ---------- */
export function openNovel(){
  build();
  stopAudio();                 // 읽기 화면의 구간 BGM은 멈춤
  N.on = true; N.bgKey = null; N.faceKey = null; N.bgmKey = null; siteFaces = null;
  collect();
  let start = 0;
  try {
    const saved = +localStorage.getItem(POS_KEY(V.number));
    if (saved > 0){ const p = N.lines.findIndex(i => i >= saved); start = p >= 0 ? p : 0; }
  } catch (_) {}
  syncButtons();
  go(start);
  $("#vn-stage").focus({ preventScroll: true });
}
export function closeNovel(){
  if (!N.on) return;
  N.on = false;
  stopTyping(); setAuto(false); stopVnAudio(); N.bgmKey = null;
  for (const q of N.queue) clearTimeout(q.timer); N.queue = [];
}
/* 탭을 켜고 끄면 목록만 다시 만들고 같은 대사 근처에서 이어 감 */
export function refreshNovel(){
  if (!N.on) return;
  const cur = N.lines[N.pos] ?? 0;
  collect();
  const p = N.lines.findIndex(i => i >= cur);
  go(p >= 0 ? p : N.lines.length - 1);
}

/* ---------- 조작 ---------- */
document.addEventListener("click", e => {
  if (!N.on) return;
  const note = e.target.closest("[data-note]");
  if (note){ const p = note.nextElementSibling, open = p.hidden; p.hidden = !open; note.setAttribute("aria-expanded", String(open)); note.classList.add("read"); if (open) setAuto(false); return; }
  const mark = e.target.closest("[data-mark]");
  if (mark){ pickTab(+mark.dataset.mark); return; }
  const fold = e.target.closest("[data-fold]");
  if (fold){ if (isNarrow()) setSide(null); else toggleFold(fold.dataset.fold); return; }
  const sideBtn = e.target.closest("[data-side]");
  if (sideBtn){ setSide(N.openSide === sideBtn.dataset.side ? null : sideBtn.dataset.side); return; }
  const jump = e.target.closest("[data-vn-jump]");
  if (jump){ closeLogPanel(); go(+jump.dataset.vnJump); return; }
  const b = e.target.closest("[data-vn]");
  if (b){
    const act = b.dataset.vn;
    if (act === "next") next();
    else if (act === "prev"){ setAuto(false); prev(); }
    else if (act === "auto") setAuto(!N.auto);
    else if (act === "speed"){ N.speed = (N.speed + 1) % SPEEDS.length; savePref(); syncButtons(); if (N.auto && !N.typing) scheduleAuto(); }
    else if (act === "log") $("#vn-log").hidden ? openLogPanel() : closeLogPanel();
    else if (act === "log-close") closeLogPanel();
    else if (act === "side-close") setSide(null);
    else if (act === "first"){ closeLogPanel(); go(0); }
    else if (act === "sound"){ N.sound = !N.sound; savePref(); syncButtons(); N.bgmKey = null; syncBgm(N.lines[N.pos] ?? 0); }
    return;
  }
  // 무대(대사창 포함)를 누르면 다음. 지난 대사·채팅창·쪽지는 제외. 쪽지가 펼쳐져 있으면 먼저 접음
  if (e.target.closest("#vn-stage") && !e.target.closest("#vn-log, .vn-side, .vn-sidebtns")) next();
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
  if (e.target.closest?.(".vn-side")) return;
  if (e.target.id === "vn-seek" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
  if (e.target.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return;   // 버튼은 버튼대로
  if ([" ", "Enter", "ArrowRight", "ArrowDown", "PageDown"].includes(e.key)){ e.preventDefault(); next(); }
  else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)){ e.preventDefault(); setAuto(false); prev(); }
  else if (e.key === "a" || e.key === "A") setAuto(!N.auto);
  else if (e.key === "l" || e.key === "L") openLogPanel();
});
