import { CONFIG, SUITS, idOf } from "./config.js?v=20261027a";
import { EXTRA, RECORDS, USE_DB, sb } from "./data.js?v=20261027a";
import { $, $$, chipAmt, esc, isRed, ph, setTitle, splitText, suitIcon } from "./dom.js?v=20261027a";
import { initShow, layoutCast } from "./effects.js?v=20261027a";
import { buyHtml, myReqHtml } from "./shop.js?v=20261027a";
import { DATA, nav, state } from "./state.js?v=20261027a";

/* ---------- render ---------- */
export const timeTag = (label, iso) => `<time${iso ? ` datetime="${esc(iso)}"` : ""}>${esc(label)}</time>`;

export function placeSegInk(seg){
  const a = $('button[aria-pressed="true"]', seg), ink = $(".seg-ink", seg);
  if (a && ink){ ink.style.left = a.offsetLeft + "px"; ink.style.width = a.offsetWidth + "px"; }
}

const pad2 = n => String(n).padStart(2, "0");

/* 날짜 표시: 9월 30일 (화) 21:00 */
const WD = "일월화수목금토";
export const fmtSlot = iso => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]}) ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/* 남은 시간: "2일 3시간 뒤" / "3시간 20분 뒤" / "12분 뒤" / 진행 중(끝 시간이 없으면 시작 후 3시간까지) */
const SLOT_LEN = 3 * 36e5;
export function untilText(s, now = Date.now()){
  const st = Date.parse(s.start), en = s.end ? Date.parse(s.end) : st + SLOT_LEN;
  if (!(st > 0)) return "";
  if (now >= st) return now < en ? "진행 중" : "";
  const m = Math.ceil((st - now) / 6e4), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), mm = m % 60;
  return (d ? `${d}일 ${h ? h + "시간 " : ""}` : h ? `${h}시간 ${mm ? mm + "분 " : ""}` : `${mm}분 `) + "뒤";
}

/* 다음 게임: 가까운 순. 첫 줄은 크게 + 남은 시간 */
const slotRow = (s, i) => {
  const u = i === 0 ? untilText(s) : "";
  return `<li${u === "진행 중" ? ` class="live"` : ""}><span class="chip ${["red", "", "green"][i % 3]}" aria-hidden="true"></span><span>
  <strong>${esc(s.game || "게임")}</strong><span class="m">${timeTag(fmtSlot(s.start), s.start)}${s.dealer ? ` · ${esc(s.dealer.name)}` : ""}</span>${u ? `<span class="until">${u}</span>` : ""}</span></li>`;
};

const upcoming = () => (DATA.slots || []).filter(s => untilText(s) !== "" || Date.parse(s.start) > Date.now());

export function renderNext(){
  const slots = upcoming();
  $("#next-body").innerHTML = slots.length
    ? `<ul class="slots">${slots.slice(0, 4).map(slotRow).join("")}</ul>`
    : `<p class="slot-note">예정된 게임이 없습니다.</p>`;
}

/* 게임 페이지: 오늘부터 7일 달력 + 일정 전체 */
const dayKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
export function renderSchedule(){
  const slots = upcoming(), today = new Date();
  const byDay = {};
  slots.forEach(s => { const k = dayKey(new Date(s.start)); (byDay[k] ||= []).push(s); });
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i), list = byDay[dayKey(d)] || [];
    const label = `${d.getMonth() + 1}월 ${d.getDate()}일 ${WD[d.getDay()]}요일${list.length ? ` — ${list.map(s => esc(s.game || "게임")).join(", ")}` : " — 일정 없음"}`;
    return `<li class="${i === 0 ? "today " : ""}${list.length ? "has" : ""}${d.getDay() === 0 ? " sun" : ""}"><span class="sr">${label}</span><span aria-hidden="true"><span class="wd">${i === 0 ? "오늘" : WD[d.getDay()]}</span><span class="dd">${d.getDate()}</span><span class="dots">${list.slice(0, 3).map((_, j) => `<i class="${["red", "", "green"][j % 3]}"></i>`).join("")}</span></span></li>`;
  }).join("");
  $("#schedule").innerHTML = `<ol class="week" aria-label="오늘부터 7일">${week}</ol>` + (slots.length
    ? `<ul class="slots">${slots.map(slotRow).join("")}</ul>`
    : `<p class="slot-note">예정된 게임이 없습니다.</p>`);
}

/* 바로가기: config.js의 QUICK_LINKS. 주소가 비어 있으면 누를 수 없는 자리로 표시 */
export function renderQuickLinks(){
  $("#quick-links").innerHTML = CONFIG.QUICK_LINKS.map((l, i) => {
    const s = SUITS[i % 4], ext = /^https?:/.test(l.href || "");
    const inner = `${suitIcon(s)}<span>${esc(l.label)}</span>`;
    if (!l.href) return `<li class="${isRed(s) ? "red" : ""}"><span class="off">${inner}<span class="sr">(준비 중)</span></span></li>`;
    return `<li class="${isRed(s) ? "red" : ""}"><a href="${esc(l.href)}"${ext ? ` target="_blank" rel="noopener"` : ""}>${inner}${ext ? `<svg class="ico ext" aria-hidden="true"><use href="#i-external-link"/></svg><span class="sr">(새 창)</span>` : ""}</a></li>`;
  }).join("");
}

export function renderHome(){
  $("#roster-meta").textContent = `직원 ${DATA.dealers.length}명 / 참가자 ${DATA.players.length}명`;
  renderNext();
  renderSchedule();
  renderQuickLinks();
  initShow();

  const last = DATA.chapters[DATA.chapters.length - 1];
  $("#latest-card").innerHTML = last
    ? `<span class="ep">최근 이야기 · 제${last.number}화</span><h2 class="g-title">${esc(last.title)}</h2><p>${esc(last.summary)}</p><span class="more" aria-hidden="true">지난 이야기 보기</span>`
    : `<span class="ep">최근 이야기</span><h2 class="g-title">아직 기록이 없습니다</h2><span class="more" aria-hidden="true">지난 이야기 보기</span>`;
}

/* 작은 이미지(thumb)가 있으면 srcset으로 화면 크기에 맞는 파일만 받음 */
export const imgSlot = (c, alt = "", lazy = true, sizes = "100vw") => {
  if (!c.img) return ph();
  const set = c.thumb ? ` srcset="${esc(c.thumb)} ${CONFIG.IMG.characterThumb}w, ${esc(c.img)} ${CONFIG.IMG.character}w" sizes="${sizes}"` : "";
  return `<img src="${esc(c.thumb || c.img)}"${set} alt="${esc(alt)}"${c.focus ? ` style="object-position:${esc(c.focus)}"` : ""}${lazy ? ` loading="lazy"` : ` fetchpriority="high"`} decoding="async">`;
};

export const CC_SIZES = "(max-width: 760px) 75vw, 32vw";

/* 캐릭터: 보이는 쪽(딜러/참가자)의 카드를 한 줄로 깔고, 위치·크기는 effects.js의 layoutCast가 정함 */
export function renderCast(){
  $("#count-dealer").textContent = DATA.dealers.length;
  $("#count-player").textContent = DATA.players.length;
  const list = state.filter === "player" ? DATA.players : DATA.dealers, track = $("#cc-track");
  $("#cc-prev").hidden = $("#cc-next").hidden = list.length < 2;
  if (!list.length){ track.innerHTML = `<p class="empty-note">등록된 캐릭터가 없습니다.</p>`; $("#cc-count").textContent = ""; return; }
  track.innerHTML = list.map((c, i) => {
    const dealer = c.role === "직원";
    return `<a class="cc ${dealer ? "dealer" : "player"}${dealer && isRed(c.suit) ? " red-suit" : ""}" href="#characters/${c.id}" data-i="${i}" data-id="${c.id}" draggable="false"${dealer ? "" : ` style="--band:${c.chip === "red" ? "var(--velvet)" : "var(--felt)"}"`}>
      <span class="cc-in">
        <span class="cc-name">${esc(c.name)}</span>${c.roleTitle ? `<span class="cc-role">${esc(c.roleTitle)}</span>` : ""}
        <span class="cc-frame">
          <span class="img">${imgSlot(c, "", i > 6, CC_SIZES)}</span>
          ${dealer ? `<span class="pip">${suitIcon(c.suit)}</span>` : `<span class="chip ${c.chip} badge" aria-hidden="true"></span>`}
        </span>
      </span>
    </a>`;
  }).join("");
  $$("img", track).forEach(im => im.draggable = false);
  layoutCast(true);
}

export const ALL = () => [...DATA.dealers, ...DATA.players];

/* 유튜브 주소 → 영상 ID */
export const ytId = u => (String(u || "").match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/) || [])[1];

/* 이 캐릭터를 고칠 수 있는가: 주인 또는 관리자 (실제 차단은 DB 함수 owner_update_character) */
export const canEdit = c => !!(USE_DB && EXTRA.ok && c && state.session && (state.isAdmin || state.mine.some(m => m.uuid === c.uuid)));
export function updateEditBtn(){
  const c = nav.current === "profile" ? ALL().find(x => x.id === nav.lastProfile) : null;
  $("#pf-edit").hidden = !canEdit(c);
}

/* 프로필: 이전·다음은 같은 쪽(딜러끼리 / 참가자끼리) 안에서 돎. 일러스트 양옆 화살표 + 방향키
   quiet: 프로필끼리 넘길 때 — 글자 등장 효과 없이 내용만 바꿈 */
export function renderProfile(id, { quiet = false } = {}){
  const c = ALL().find(x => x.id === id);
  if (!c) return false;
  const dealer = c.role === "직원", list = dealer ? DATA.dealers : DATA.players, idx = list.indexOf(c), n = list.length;
  const prev = list[(idx - 1 + n) % n], next = list[(idx + 1) % n];

  const v = $("#pf-visual");
  v.className = "pf-visual " + (dealer ? "dealer" : "player") + (dealer && isRed(c.suit) ? " red-suit" : "");
  v.style.setProperty("--band", c.chip === "red" ? "var(--velvet)" : "var(--felt)");
  v.innerHTML = `<a class="btn pf-back" href="#characters"><span class="back-ico" aria-hidden="true"></span>캐릭터 목록으로</a><span class="img">${imgSlot(c, `${c.name} 캐릭터 이미지`, false, "(max-width: 860px) 100vw, 55vw")}</span>` +
    (dealer ? `<span class="pip">${suitIcon(c.suit)}</span>` : `<span class="chip ${c.chip} badge" aria-hidden="true"></span>`) +
    (n > 1 ? `<nav class="pf-nav" aria-label="다른 ${c.role}">
      <a class="pf-arrow arrow prev" href="#characters/${prev.id}"><span class="sr">이전 ${c.role}: </span><span class="nm">${esc(prev.name)}</span></a>
      <a class="pf-arrow arrow next" href="#characters/${next.id}"><span class="sr">다음 ${c.role}: </span><span class="nm">${esc(next.name)}</span></a>
    </nav>` : "") +
    `<span class="pf-count" aria-hidden="true">${c.role} ${String(idx + 1).padStart(2, "0")} / ${String(n).padStart(2, "0")}</span>` +
    (ytId(c.bgm) ? `<div class="pf-music"><button class="btn small pf-play" type="button" id="pf-play" aria-pressed="false"><span class="note" aria-hidden="true">♪</span><span class="lb">음악 재생</span></button><div class="pf-yt" id="pf-yt"></div></div>` : "");

  const role = $("#pf-role");
  role.textContent = c.role + (c.roleTitle ? ` · ${c.roleTitle}` : "");
  role.className = "role " + (dealer ? "tag-d" : "tag-p");
  const name = $("#pf-name");
  name.dataset.text = c.name;
  if (quiet) name.textContent = c.name; else splitText(name);

  $("#pf-dl").innerHTML = `<dt>나이</dt><dd>${esc(c.age || "—")}</dd><dt>키</dt><dd>${esc(c.height || "—")}</dd>`;
  $("#pf-kw").innerHTML = c.keywords.map(k => `<li>${esc(k)}</li>`).join("");
  $("#pf-desc").textContent = c.description;
  renderInventory(c.inventory);
  const links = (c.links || []).filter(l => /^https?:\/\//i.test(l.url || ""));
  $("#pf-links-b").hidden = !links.length;
  $("#pf-links").innerHTML = links.map(l => {
    let host = ""; try { host = new URL(l.url).hostname.replace(/^www\./, ""); } catch (_) {}
    return `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"><span class="t">${esc(l.label || host || l.url)}</span><span class="h">${esc(host)}</span><svg class="ico" aria-hidden="true"><use href="#i-external-link"/></svg><span class="sr">(새 창)</span></a></li>`;
  }).join("");
  $("#pf-edit").hidden = !canEdit(c);
  setTitle(c.name);
  return true;
}

export function renderInventory(inv, selected = 0){
  state.invItems = inv;
  const filled = inv.map((it, i) => `
    <button class="slot" type="button" data-slot="${i}" aria-pressed="${i === selected}" aria-controls="pf-inv-detail" tabindex="${i === selected ? 0 : -1}" aria-label="${esc(it.name)}, ${it.quantity}개">
      ${it.img ? `<img src="${esc(it.img)}" alt="">` : ph()}
      ${it.quantity > 1 ? `<span class="qty" aria-hidden="true">×${it.quantity}</span>` : ""}
    </button>`).join("");
  const box = $("#pf-inv"), detail = $("#pf-inv-detail");
  box.hidden = detail.hidden = !inv.length;
  $("#pf-inv-empty").hidden = !!inv.length;
  if (!inv.length){ box.innerHTML = detail.innerHTML = ""; return; }
  const empty = Array.from({ length: (6 - inv.length % 6) % 6 }, () => `<span class="slot" aria-hidden="true"></span>`).join("");
  box.innerHTML = filled + empty;

  const it = inv[selected];
  $("#pf-inv-detail").innerHTML = it
    ? `<div class="top"><strong>${esc(it.name)}</strong><span class="count">${it.quantity}개</span></div>
       <p>${esc(it.description)}</p>${it.note ? `<p class="note">${esc(it.note)}</p>` : ""}`
    : `<p>소지품이 없습니다.</p>`;
}

/* 지난 이야기: 왼쪽 회차 목록 + 오른쪽 선택한 회차 (좁은 화면은 목록 안에 요약까지) */
const epTitle = c => {
  const t = (c.title || "").trim();
  return t && !new RegExp(`^제?\\s*${c.number}\\s*화$`).test(t) ? t : "";   // "1화"처럼 회차와 같은 제목은 한 번만
};
const logLink = c => c.log ? `<a class="btn small log-link" href="#story/${esc(String(c.number))}">진행 기록 보기<span class="sr"> — 제${c.number}화</span></a>` : "";

export function renderStory(sel){
  const wrap = $("#timeline-wrap"), detail = $("#story-detail");
  if (!DATA.chapters.length){
    wrap.innerHTML = `<p class="slot-note">아직 기록이 없습니다.</p>`;
    detail.innerHTML = `<p class="empty-note">진행된 이야기가 쌓이면 여기에 보입니다.</p>`;
    return;
  }
  const last = DATA.chapters[DATA.chapters.length - 1];
  if (sel == null) sel = state.storySel ?? last.number;
  if (!DATA.chapters.some(c => c.number === sel)) sel = last.number;
  state.storySel = sel;
  wrap.innerHTML = `<ol class="timeline" id="timeline">` + DATA.chapters.map(c => {
    const t = epTitle(c);
    return `<li${c.number === sel ? ` class="on"` : ""} data-n="${esc(c.number)}">
      <button class="ch-pick" type="button" data-ch="${esc(c.number)}" aria-pressed="${c.number === sel}" aria-controls="story-detail">
        <span class="ep">제${c.number}화</span>${t ? `<span class="h">${esc(t)}</span>` : ""}${timeTag(c.date, c.iso)}
      </button>
      <div class="m-only">${c.summary ? `<p>${esc(c.summary)}</p>` : ""}${logLink(c)}</div>
    </li>`;
  }).join("") + `</ol>`;
  const c = DATA.chapters.find(x => x.number === sel), t = epTitle(c);
  detail.innerHTML = `
    <p class="ep">${t ? `제${c.number}화` : ""}${c.number === last.number ? `<span class="tag">최근</span>` : ""}</p>
    <h2 class="h" id="story-h" tabindex="-1">${esc(t || `제${c.number}화`)}</h2>
    ${c.date ? `<p class="when">${timeTag(c.date, c.iso)}</p>` : ""}
    <p class="sum">${esc(c.summary || "요약이 없습니다.")}</p>
    <div class="acts">${logLink(c) || `<span class="hint">진행 기록이 아직 없습니다.</span>`}</div>`;
}

/* 상점: 왼쪽 상품 칸 + 오른쪽(좁은 화면은 위) 선택한 상품 */
const stockText = it => it.stock == null ? "" : it.stock > 0 ? `남은 수량 ${it.stock}개` : "품절";
export function renderShop(sel){
  const detail = $("#shop-detail");
  if (!DATA.items.length){
    $("#shop").innerHTML = `<p class="empty-note" style="grid-column:1 / -1">판매 중인 아이템이 없습니다.</p>`;
    detail.innerHTML = `<div class="sd-empty"><span class="chip red" aria-hidden="true"></span><p>진열된 상품이 없습니다.</p></div>${myReqHtml()}`;
    return;
  }
  if (sel == null) sel = state.shopSel ?? 0;
  sel = Math.min(sel, DATA.items.length - 1);
  state.shopSel = sel;
  $("#shop").innerHTML = DATA.items.map((it, i) => `
    <button class="item${it.stock === 0 ? " sold" : ""}" type="button" data-item="${i}" aria-pressed="${i === sel}" aria-controls="shop-detail">
      <span class="thumb">${it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy" decoding="async">` : ph()}</span>
      <span class="row"><span class="nm">${esc(it.name)}</span>
        <span class="price">${it.price == null ? "—" : chipAmt(it.price, it.currency)}</span></span>
      ${it.stock === 0 ? `<span class="sold-tag">품절</span>` : ""}
    </button>`).join("");
  const it = DATA.items[sel], st = stockText(it);
  detail.innerHTML = `
    <div class="sd-img">${it.img ? `<img src="${esc(it.img)}" alt="" decoding="async">` : ph()}</div>
    <div class="sd-body">
      <h2 class="sd-name">${esc(it.name)}</h2>
      <p class="sd-price"><strong>${it.price == null ? "가격 미정" : chipAmt(it.price, it.currency)}</strong></p>
      ${st ? `<p class="sd-stock${it.stock === 0 ? " out" : ""}">${st}</p>` : ""}
      <p class="sd-desc">${esc(it.description || "설명이 없습니다.")}</p>
      ${buyHtml(it)}
    </div>
    ${myReqHtml()}`;
}

/* 내 소유 캐릭터 + 잔액 (공개 캐릭터 데이터와 합침) */
export const myChars = () => state.mine.map(m => ({ ...ALL().find(c => c.uuid === m.uuid), balance: m.balance, pink: m.pink || 0 })).filter(c => c.name);
/* 칩 종류별 잔액 */
export const balOf = (c, cur) => (cur === "pink" ? c?.pink : c?.balance) ?? 0;

/* 계정 영역(설정 페이지) + 상점 보유 칩 */
export function renderAccount(){
  const p = state.profile, on = !!state.session;
  $("#acct-guest").hidden = on;
  $("#acct-form").hidden = !on;
  $$("#site-head [data-guest-only]").forEach(el => el.hidden = on || !USE_DB);
  $$("#site-head [data-member-only]").forEach(el => el.hidden = !on);
  $$("#site-head [data-admin-only]").forEach(el => el.hidden = !state.isAdmin);
  if (on){
    const mine = myChars();
    $("#acct-email").textContent = idOf(state.session.user.email) || "—";
    $("#acct-char").textContent = mine.length ? mine.map(c => `${c.name} (${c.roleTitle || c.role})`).join(", ") : "연결 안 됨";
    $("#acct-chips").innerHTML = mine.length ? mine.map(c => `${mine.length > 1 ? esc(c.name) + " " : ""}${chipAmt(c.balance, "blue")} ${chipAmt(c.pink, "pink")}`).join("<br>") : "—";
    if (document.activeElement !== $("#set-name")) $("#set-name").value = p?.display_name || "";
    $("#pw-user").value = idOf(state.session.user.email);
  }
  updateEditBtn();
  // 칩은 캐릭터별. 상점에는 대표 캐릭터(참가자 우선)의 잔액을 표시
  const main = myChars().sort((a, b) => (a.role === "참가자" ? 0 : 1) - (b.role === "참가자" ? 0 : 1))[0];
  $("#wallet").innerHTML = main ? `${chipAmt(main.balance, "blue")}${chipAmt(main.pink, "pink")}` : "—";
  $("#wallet-label").textContent = !on ? "보유 칩 (로그인 필요)" : main ? `보유 칩 · ${main.name}` : "보유 칩 (연결된 캐릭터 없음)";
  // 독: 대표 캐릭터 이름 + 칩 (캐릭터가 없으면 표시 이름)
  if (on){
    $("#me-name").textContent = main?.name || p?.display_name || "내 계정";
    $("#me-bal").innerHTML = main ? `${chipAmt(main.balance, "blue")} ${chipAmt(main.pink, "pink")}` : "";
    $("#me-chip").className = `chip ${main?.chip || "green"} me-chip`;
  }
}

/* =========================================================
   전적 — 게임 화면(표 + 요약 + 승리 순위)과 홈 '최근 전적'
   ========================================================= */
const markOf = c => c.role === "직원"
  ? `<span class="mk${isRed(c.suit) ? " red" : ""}">${suitIcon(c.suit)}</span>`
  : `<span class="chip ${c.chip}" aria-hidden="true"></span>`;
const winName = c => c ? `<a class="win-name" href="#characters/${c.id}">${markOf(c)}${esc(c.name)}</a>` : `<span class="muted">—</span>`;
const chipText = n => n ? (n > 0 ? "+" : "") + n.toLocaleString("ko-KR") : "—";

export function winCounts(recs){
  const m = new Map();
  recs.forEach(r => { if (r.winner) m.set(r.winner.id, { c: r.winner, w: (m.get(r.winner.id)?.w || 0) + 1 }); });
  return [...m.values()].sort((a, b) => b.w - a.w);
}

/* 룰렛 전적 (update-10.sql roulette_stats): 판 수 · 우승 · 룰렛으로 늘거나 준 칩 */
const RLS = { rows: null, at: 0, busy: false, ok: true };
const RL_GAME = "러시안 룰렛";
async function loadRlStats(){
  if (!USE_DB || !RLS.ok || RLS.busy || Date.now() - RLS.at < 20000) return;
  RLS.busy = true;
  const { data, error } = await sb.rpc("roulette_stats");
  RLS.busy = false; RLS.at = Date.now();
  if (error){ RLS.ok = false; return; }
  RLS.rows = data || [];
  if (nav.current === "game") renderRecords();
}
export function refreshRlStats(){ RLS.at = 0; }

/* 분류 버튼은 종류가 바뀔 때만 다시 그림 — 누를 때마다 다시 그리면 키보드 포커스가 사라짐 */
let recGames = "";
export function renderRecords(){
  const all = DATA.records, games = [...new Set(all.map(r => r.game).filter(Boolean))];
  if (state.recFilter !== "전체" && !games.includes(state.recFilter)) state.recFilter = "전체";
  const seg = $("#rec-seg");
  if (recGames !== games.join("\n")){
    recGames = games.join("\n");
    seg.innerHTML = ["전체", ...games].map(g => `<button type="button" data-game="${esc(g)}">${esc(g)}</button>`).join("") + `<span class="seg-ink" aria-hidden="true"></span>`;
  }
  seg.hidden = games.length < 2;
  $$("button", seg).forEach(b => b.setAttribute("aria-pressed", b.dataset.game === state.recFilter));
  requestAnimationFrame(() => placeSegInk(seg));

  const recs = state.recFilter === "전체" ? all : all.filter(r => r.game === state.recFilter);
  const ranks = winCounts(recs), top = ranks[0], last = recs[0];
  $("#rec-stats").innerHTML = `
    <div class="stat"><small>진행한 게임</small><strong>${recs.length}판</strong></div>
    <div class="stat hot"><small>최다 승리</small><strong>${top ? esc(top.c.name) : "—"}</strong><span>${top ? top.w + "승" : ""}</span></div>
    <div class="stat"><small>최근 게임</small><strong>${last ? esc(last.game) : "—"}</strong><span>${last ? `${esc(last.date)} ${esc(last.time)}` : ""}</span></div>`;

  const empty = USE_DB && !RECORDS.ok ? "전적 기능이 아직 준비되지 않았습니다. (관리자: supabase/update-5.sql 실행 필요)" : "아직 기록된 게임이 없습니다.";
  $("#rec-body").innerHTML = recs.length ? recs.slice(0, state.recLimit).map(r => `<tr>
      <td class="when">${timeTag(r.date, r.iso)}<small>${esc(r.time)}</small></td>
      <td class="game">${esc(r.game)}</td>
      <td>${winName(r.winner)}</td>
      <td class="who">${esc(r.players.join(", ")) || "—"}</td>
      <td class="num${r.chips < 0 ? " minus" : ""}">${chipText(r.chips)}</td>
      <td class="note">${esc(r.note)}</td>
    </tr>`).join("") : `<tr><td colspan="6" class="empty-note">${empty}</td></tr>`;
  $("#rec-more").hidden = recs.length <= state.recLimit;

  // 룰렛만 볼 때: 판 수와 칩까지 보여 주는 순위
  const rl = state.recFilter === RL_GAME || (state.recFilter === "전체" && games.length === 1 && games[0] === RL_GAME);
  $("#h-rank").textContent = rl ? "룰렛 순위" : "승리 순위";
  if (rl){
    loadRlStats();
    if (RLS.rows){
      const byUuid = new Map(ALL().map(c => [c.uuid, c]));
      const list = RLS.rows.map(x => ({ x, c: byUuid.get(x.character_id) })).filter(v => v.c);
      const mx = Math.max(1, ...list.map(v => v.x.wins));
      $("#rec-rank").innerHTML = list.length ? list.slice(0, 8).map(({ x, c }, i) => `<li>
          <span class="no">${String(i + 1).padStart(2, "0")}</span>${winName(c)}<span class="w">${x.wins}승 <small>/ ${x.played}판</small></span>
          <span class="rl-net">${x.net ? chipAmt(x.net, "blue", true) : ""}${x.net_pink ? chipAmt(x.net_pink, "pink", true) : ""}${!x.net && !x.net_pink ? "칩 —" : ""} · 생존율 ${Math.round(x.wins / x.played * 100)}%</span>
          <span class="bar" aria-hidden="true"><i style="--p:${(x.wins / mx * 100).toFixed(1)}%"></i></span></li>`).join("")
        : `<li class="slot-note">기록이 쌓이면 순위가 보입니다.</li>`;
      return;
    }
  }
  const max = top?.w || 1;
  $("#rec-rank").innerHTML = ranks.length ? ranks.slice(0, 5).map((x, i) => `<li>
      <span class="no">${String(i + 1).padStart(2, "0")}</span>${winName(x.c)}<span class="w">${x.w}승</span>
      <span class="bar" aria-hidden="true"><i style="--p:${(x.w / max * 100).toFixed(1)}%"></i></span></li>`).join("")
    : `<li class="slot-note">기록이 쌓이면 순위가 보입니다.</li>`;
}
