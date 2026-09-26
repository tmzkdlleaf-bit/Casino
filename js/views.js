import { CONFIG, HERO_CHIPS, INVENTORY_SLOTS, SUITS } from "./config.js";
import { USE_DB } from "./data.js";
import { $, $$, esc, isRed, ph, setTitle, splitText } from "./dom.js";
import { moveNavInk } from "./effects.js";
import { renderMarkdown } from "./markdown.js";
import { DATA, nav, state } from "./state.js";

/* ---------- render ---------- */
export function renderHero(){
  $("#hero-chips").innerHTML = HERO_CHIPS.map(([l, t, s, c, r, tx, d, depth]) => `
    <span class="fall" style="left:${l}%;top:${t}%;animation-delay:${d}s">
      <span class="float" style="--d:${depth}">
        <span class="chip ${c}" style="--size:${s}rem;--tx:${tx}deg;--r1:${r}deg"></span>
      </span>
    </span>`).join("");
}

// 고정글 먼저(pin 순서) → 나머지는 기존 순서(최신순)
// pinOrder가 null(DB 기본값)이어도 정렬이 깨지지 않도록 ?? 0
export const sortedNotices = () => [...DATA.notices].sort((a, b) => (b.pinned - a.pinned) || (a.pinned && b.pinned ? (a.pinOrder ?? 0) - (b.pinOrder ?? 0) : 0));

export const timeTag = (label, iso) => `<time${iso ? ` datetime="${esc(iso)}"` : ""}>${esc(label)}</time>`;

export const noticeRow = (n, i) =>
  `<li class="${n.pinned ? "pinned" : ""}"><a href="#notices/${n.id}">${timeTag(n.date, n.iso)}<span>${n.pinned ? `<span class="tag pin">고정</span>` : ""}${n.category ? `<span class="tag">${esc(n.category)}</span>` : ""}${esc(n.title)}</span><span class="suit" aria-hidden="true">${SUITS[i % 4]}</span></a></li>`;

/* 분류 버튼은 한 번만 그림 — 클릭할 때마다 다시 그리면 키보드 포커스가 사라짐 (WCAG 2.4.3) */
export function renderNoticeSeg(){
  const cats = ["전체", ...DATA.categories];
  $("#notice-seg").innerHTML = cats.map(c => `<button type="button" data-cat="${esc(c)}" aria-pressed="${c === state.noticeFilter}">${esc(c)}</button>`).join("") + `<span class="seg-ink" aria-hidden="true"></span>`;
}

export function placeSegInk(seg){
  const a = $('button[aria-pressed="true"]', seg), ink = $(".seg-ink", seg);
  if (a && ink){ ink.style.left = a.offsetLeft + "px"; ink.style.width = a.offsetWidth + "px"; }
}

export function renderNoticeList(){
  $$("#notice-seg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.cat === state.noticeFilter));
  const list = sortedNotices().filter(n => state.noticeFilter === "전체" || n.category === state.noticeFilter);
  $("#notice-all").innerHTML = list.length ? list.map(noticeRow).join("") : `<li class="empty-note">해당 분류의 공지가 없습니다.</li>`;
  requestAnimationFrame(() => placeSegInk($("#notice-seg")));
  return list.length;
}

export function renderHomeNotices(){
  $("#notice-list").innerHTML = DATA.notices.length
    ? sortedNotices().slice(0, 3).map(noticeRow).join("")
    : `<li class="slot-note" style="padding:.55rem 0">등록된 공지가 없습니다.</li>`;
}

export function renderHome(){
  const unit = `<span>사이트명</span><span><i>♠</i></span><span>문구 자리</span><span><i>♥</i></span><span>사이트명</span><span><i>♣</i></span><span>문구 자리</span><span><i>♦</i></span>`;
  $("#marquee").innerHTML = unit + unit;

  const mid = (DATA.dealers.length - 1) / 2;
  $("#fan").innerHTML = DATA.dealers.map((c, i) => {
    const off = i - mid;
    return `<a class="fan-card" href="#characters/${c.id}" style="--rot:${off * 7}deg;--lift:${Math.abs(off) * .35}rem;z-index:${i}" aria-label="${esc(c.name)} 프로필">
      <span class="pcard ${isRed(c.suit) ? "red-suit" : ""}" aria-hidden="true">
        <span class="pip tl">${c.suit}</span><span class="face">${c.img ? `<img src="${esc(c.thumb || c.img)}" alt="" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover">` : "이미지"}</span><span class="pip br">${c.suit}</span>
      </span></a>`;
  }).join("");

  $("#chip-row").innerHTML = DATA.players.map(c => `<span class="chip ${c.chip}"><span class="face"></span></span>`).join("");

  renderHomeNotices();

  const last = DATA.chapters[DATA.chapters.length - 1];
  $("#latest-card").innerHTML = last
    ? `<span class="ep">최근 이야기 / 제${last.number}화</span><h2 class="g-title">${esc(last.title)}</h2><p>${esc(last.summary)}</p>`
    : `<span class="ep">최근 이야기</span><h2 class="g-title">아직 기록이 없습니다</h2>`;
  $("#roster-meta").textContent = `딜러 ${DATA.dealers.length}명 / 참가자 ${DATA.players.length}명`;
}

/* 작은 이미지(thumb)가 있으면 srcset으로 화면 크기에 맞는 파일만 받음 */
export const imgSlot = (c, alt = "", lazy = true, sizes = "100vw") => {
  if (!c.img) return ph();
  const set = c.thumb ? ` srcset="${esc(c.thumb)} ${CONFIG.IMG.characterThumb}w, ${esc(c.img)} ${CONFIG.IMG.character}w" sizes="${sizes}"` : "";
  return `<img src="${esc(c.thumb || c.img)}"${set} alt="${esc(alt)}"${lazy ? ` loading="lazy"` : ` fetchpriority="high"`} decoding="async">`;
};

export const STRIP_SIZES = "(max-width: 760px) 50vw, 30vw";

export function renderCast(){
  $("#count-dealer").textContent = DATA.dealers.length + "명";
  $("#count-player").textContent = DATA.players.length + "명";
  const empty = `<p class="empty-note">등록된 캐릭터가 없습니다.</p>`;

  $("#cast-dealers").innerHTML = DATA.dealers.map((c, i) => `
    <a class="strip dealer ${isRed(c.suit) ? "red-suit" : ""}" href="#characters/${c.id}" data-id="${c.id}" style="--delay:${i * 80}ms">
      <span class="img">${imgSlot(c, "", true, STRIP_SIZES)}</span>
      <span class="pip" aria-hidden="true">${c.suit}</span>
      <span class="label"><span class="name">${esc(c.name)}</span><span class="sub">프로필 보기</span></span>
    </a>`).join("");

  $("#cast-players").innerHTML = DATA.players.map((c, i) => `
    <a class="strip player" href="#characters/${c.id}" data-id="${c.id}" style="--delay:${i * 80}ms;--band:${c.chip === "red" ? "var(--velvet)" : "var(--felt)"}">
      <span class="img">${imgSlot(c, "", true, STRIP_SIZES)}</span>
      <span class="chip ${c.chip} badge" aria-hidden="true"></span>
      <span class="label"><span class="name">${esc(c.name)}</span><span class="sub">프로필 보기</span></span>
    </a>`).join("");
  if (!DATA.dealers.length) $("#cast-dealers").innerHTML = empty;
  if (!DATA.players.length) $("#cast-players").innerHTML = empty;
}

export const ALL = () => [...DATA.dealers, ...DATA.players];

export function renderProfile(id){
  const list = ALL(), idx = list.findIndex(x => x.id === id);
  if (idx < 0) return false;
  const c = list[idx], dealer = c.role === "딜러";

  const v = $("#pf-visual");
  v.className = "pf-visual " + (dealer ? "dealer" : "player") + (dealer && isRed(c.suit) ? " red-suit" : "");
  v.style.setProperty("--band", c.chip === "red" ? "var(--velvet)" : "var(--felt)");
  v.innerHTML = `<span class="img">${imgSlot(c, `${c.name} 캐릭터 이미지`, false, "(max-width: 860px) 100vw, 55vw")}</span>` +
    (dealer ? `<span class="pip" aria-hidden="true">${c.suit}</span>` : `<span class="chip ${c.chip} badge" aria-hidden="true"></span>`);

  const role = $("#pf-role");
  role.textContent = c.role;
  role.className = "role " + (dealer ? "tag-d" : "tag-p");
  const name = $("#pf-name");
  name.dataset.text = c.name;
  splitText(name);

  $("#pf-dl").innerHTML = `<dt>이름</dt><dd>${esc(c.name)}</dd><dt>나이</dt><dd>${esc(c.age || "—")}</dd><dt>키</dt><dd>${esc(c.height || "—")}</dd>`;
  $("#pf-kw").innerHTML = c.keywords.map(k => `<li>${esc(k)}</li>`).join("");
  $("#pf-desc").textContent = c.description;
  renderInventory(c.inventory);

  const prev = list[(idx - 1 + list.length) % list.length], next = list[(idx + 1) % list.length];
  $("#pf-pager").innerHTML = `
    <a href="#characters/${prev.id}"><small>이전 캐릭터</small><strong>${esc(prev.name)}</strong></a>
    <a href="#characters/${next.id}"><small>다음 캐릭터</small><strong>${esc(next.name)}</strong></a>`;
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
  const empty = Array.from({ length: Math.max(0, INVENTORY_SLOTS - inv.length) }, () => `<span class="slot" aria-hidden="true"></span>`).join("");
  $("#pf-inv").innerHTML = filled + empty;

  const it = inv[selected];
  $("#pf-inv-detail").innerHTML = it
    ? `<div class="top"><strong>${esc(it.name)}</strong><span class="count">${it.quantity}개</span></div>
       <p>${esc(it.description)}</p>${it.note ? `<p class="note">${esc(it.note)}</p>` : ""}`
    : `<p>소지품이 없습니다.</p>`;
}

export function renderNotice(id){
  const list = sortedNotices(), idx = list.findIndex(n => n.id === id);
  if (idx < 0) return false;
  const n = list[idx], newer = list[idx - 1], older = list[idx + 1];
  $("#notice-article").innerHTML = `
    <a class="link-back" href="#notices">공지 목록으로</a>
    <div class="meta">${n.pinned ? `<span class="tag pin">고정</span>` : ""}${n.category ? `<span class="tag">${esc(n.category)}</span>` : ""}${timeTag(n.date, n.iso)}</div>
    <h1>${esc(n.title)}</h1>
    <div class="body" id="notice-body"><p>${esc(n.body)}</p></div>
    <nav class="pager" aria-label="다른 공지">
      ${older ? `<a href="#notices/${older.id}"><small>아래 공지</small><strong>${esc(older.title)}</strong></a>` : "<span></span>"}
      ${newer ? `<a href="#notices/${newer.id}"><small>위 공지</small><strong>${esc(newer.title)}</strong></a>` : "<span></span>"}
    </nav>`;
  setTitle(n.title);
  // 마크다운은 라이브러리를 처음 필요할 때 불러옴. 그 전까지는 일반 텍스트로 보임
  renderMarkdown(n.body).then(html => {
    const el = $("#notice-body");
    if (el && nav.key === "notice/" + id){ el.innerHTML = html; el.classList.add("md"); }
  }).catch(() => {});
  return true;
}

export function renderWorld(){
  $("#world-toc").innerHTML = DATA.world.map(w => `<li><a href="#world" data-jump="${w.id}">${esc(w.title)}</a></li>`).join("");
  $("#world-body").innerHTML = DATA.world.map(w => `
    <section id="${w.id}" class="reveal" aria-labelledby="${w.id}-h">
      <h2 class="h" id="${w.id}-h" tabindex="-1">${esc(w.title)}</h2>
      <p>본문 자리입니다.</p>
      <div class="figure">${ph("이미지 자리")}</div>
      <p>본문 자리입니다.</p>
    </section>`).join("");
}

export function renderStory(){
  const wrap = $("#timeline-wrap");
  if (!DATA.chapters.length){ wrap.innerHTML = `<p class="slot-note">아직 기록이 없습니다.</p>`; return; }
  wrap.innerHTML = `<span class="fill" aria-hidden="true"></span><ol class="timeline" id="timeline">` + DATA.chapters.map(c => `
    <li class="reveal" data-n="${esc(c.number)}">
      <span class="ep">제${c.number}화</span>
      <h2>${esc(c.title)}</h2>
      ${timeTag(c.date, c.iso)}
      <p>${esc(c.summary)}</p>
    </li>`).join("") + `</ol>`;
}

export function renderShop(){
  if (!DATA.items.length){ $("#shop").innerHTML = `<p class="empty-note" style="grid-column:1 / -1">판매 중인 아이템이 없습니다.</p>`; return; }
  $("#shop").innerHTML = DATA.items.map((it, i) => `
    <article class="item reveal ${i === 0 ? "wide" : ""}">
      <div class="thumb">${it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy" decoding="async">` : ph()}</div>
      <div class="row">
        <h3>${esc(it.name)}</h3>
        <span class="price"><span class="chip red" aria-hidden="true"></span>${esc(it.price)}<span class="sr">칩</span></span>
      </div>
      ${it.description ? `<p class="desc">${esc(it.description)}</p>` : ""}
      <button class="btn" type="button" disabled aria-describedby="buy-note">구매하기</button>
    </article>`).join("");
}

/* 내 소유 캐릭터 + 잔액 (공개 캐릭터 데이터와 합침) */
export const myChars = () => state.mine.map(m => ({ ...ALL().find(c => c.uuid === m.uuid), balance: m.balance })).filter(c => c.name);

/* 계정 영역(설정 페이지) + 상점 보유 칩 */
export function renderAccount(){
  const p = state.profile, on = !!state.session;
  $("#acct-guest").hidden = on;
  $("#acct-form").hidden = !on;
  $$("#nav [data-guest-only]").forEach(el => el.hidden = on || !USE_DB);
  $$("#nav [data-admin-only]").forEach(el => el.hidden = !state.isAdmin);
  if (on){
    const mine = myChars();
    $("#acct-email").textContent = state.session.user.email || "—";
    $("#acct-char").textContent = mine.length ? mine.map(c => `${c.name} (${c.role})`).join(", ") : "연결 안 됨";
    $("#acct-chips").textContent = mine.length ? mine.map(c => `${mine.length > 1 ? c.name + " " : ""}${c.balance.toLocaleString("ko-KR")}칩`).join(", ") : "—";
    if (document.activeElement !== $("#set-name")) $("#set-name").value = p?.display_name || "";
    $("#pw-user").value = state.session.user.email || "";
  }
  // 칩은 캐릭터별. 상점에는 대표 캐릭터(참가자 우선)의 잔액을 표시
  const main = myChars().sort((a, b) => (a.role === "참가자" ? 0 : 1) - (b.role === "참가자" ? 0 : 1))[0];
  $("#wallet").textContent = main ? main.balance.toLocaleString("ko-KR") : "—";
  $("#wallet-label").textContent = !on ? "보유 칩 (로그인 필요)" : main ? `보유 칩 · ${main.name}` : "보유 칩 (연결된 캐릭터 없음)";
  moveNavInk();
}
