/* =========================================================
   블랙잭 (supabase/update-13.sql)
   - 게임 화면 로비의 '블랙잭' 탭: 테이블 목록. 테이블은 관리자만 엶
   - #blackjack/테이블ID: 위에 딜러(컴퓨터), 아래 자리들, 오른쪽 채팅
   - 흐름: 앉기 → 베팅(첫 베팅 20초 뒤 또는 모두 걸면 바로) → 자리 순서대로 카드 받기/멈추기/두 배 → 딜러 → 정산
   - 카드 더미와 딜러의 엎은 카드는 서버만 앎. 화면은 받은 카드만 그림
   ========================================================= */
import { CURRENCY, USE_DB, publicUrl, sb } from "./data.js?v=20261027c";
import { $, $$, CUR, announce, chipAmt, curOf, esc, setTitle, toast } from "./dom.js?v=20261027c";
import { errMsg, showMsg, withBusy } from "./forms.js?v=20261027c";
import { nav, state } from "./state.js?v=20261027c";
import { ALL, balOf, myChars } from "./views.js?v=20261027c";
import { sfx, sfxVol, setSfxVol } from "./sfx.js?v=20261027c";

const BJ = {
  id: null, t: null, seats: [], avatars: new Map(), chan: null, live: false, poll: 0, tickT: 0, loading: null,
  lastChat: 0, seen: new Set(), wasMyTurn: false, skew: 0, actedAt: 0, tickTry: 0, myChar: null, missing: false, betAmt: null,
  vis: new Set(), queue: [], anim: false, animT: 0, held: [], soundRound: -1, results: null
};
const LOBBY = { chan: null, t: 0 };
const ROUNDS = { ok: true };  // bj_tables.max_rounds (update-15.sql)
const DUMMY = { ok: true };   // bj_seats.dummy_name (update-14.sql)
const TURN_SEC = 30;
const n = v => Number(v || 0).toLocaleString("ko-KR");
const missingTable = e => /42P01|PGRST205|PGRST202|bj_/.test(`${e?.code} ${e?.message}`);
const NEED_SQL = `<p class="form-note">블랙잭이 아직 준비되지 않았습니다. (관리자: Supabase에서 <strong>supabase/update-13.sql</strong> 실행 필요)</p>`;

/* ---------- 카드 ---------- */
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠", "♥", "♦", "♣"], SUIT_NAME = ["스페이드", "하트", "다이아", "클럽"];
const val = c => (c % 13 === 0 ? 11 : c % 13 >= 9 ? 10 : c % 13 + 1);
export function total(cards){
  let t = 0, a = 0;
  for (const c of cards || []){ t += val(c); if (c % 13 === 0) a++; }
  while (t > 21 && a){ t -= 10; a--; }
  return t;
}
const soft = cards => { let t = 0, a = 0; for (const c of cards){ t += val(c); if (c % 13 === 0) a++; } while (t > 21 && a){ t -= 10; a--; } return a > 0 && t <= 21; };
const isBJ = cards => cards?.length === 2 && total(cards) === 21;
const cardName = c => `${SUIT_NAME[Math.floor(c / 13)]} ${RANKS[c % 13]}`;
function cardHtml(c, key, back = false){
  const isNew = key && !BJ.seen.has(key);
  if (key) BJ.seen.add(key);
  if (back) return `<span class="pc back${isNew ? " in" : ""}" role="img" aria-label="엎어 둔 카드"></span>`;
  const r = RANKS[c % 13], s = SUITS[Math.floor(c / 13)], red = s === "♥" || s === "♦";
  return `<span class="pc${red ? " red" : ""}${isNew ? " in" : ""}" role="img" aria-label="${cardName(c)}"><b>${r}</b><i>${s}</i><b class="br">${r}</b></span>`;
}

/* ---------- 도우미 ---------- */
const charOf = uuid => ALL().find(c => c.uuid === uuid) || { uuid, name: "(알 수 없음)", role: "", chip: "green" };
// 자리의 주인: 캐릭터 또는 더미 (더미는 칩 없이 자동 진행)
const seatChar = s => s.character_id ? charOf(s.character_id) : { uuid: null, name: s.dummy_name || "더미", dummy: true };
const avatarOf = c => { const a = BJ.avatars.get(c.uuid); return a ? publicUrl("roulette", a.path) : (c.thumb || c.img || ""); };
const mineSet = () => new Set(state.mine.map(m => m.uuid));
const mySeat = () => { const m = mineSet(); return BJ.seats.find(s => m.has(s.character_id)) || null; };
const seatAt = i => BJ.seats.find(s => s.seat === i) || null;
const cur = () => curOf(BJ.t?.currency);
const isMyTurn = () => { const t = BJ.t, me = mySeat(); return !!(t && me && t.phase === "playing" && t.turn_seat === me.seat && me.state === "playing"); };
const RESULT = { win: "승", lose: "패", push: "무승부", blackjack: "블랙잭!" };

/* =========================================================
   로비 — 게임 화면의 '블랙잭' 탭
   ========================================================= */
export function onRoute(view, param){
  if (view === "game"){ closeTable(); openLobby(); }
  else if (view === "blackjack"){ closeLobby(); openTable(param); }
  else { closeTable(); closeLobby(); }
}

/* 로비 탭 (룰렛 | 블랙잭) — 이 브라우저에 기억 */
function setLobbyTab(k){
  $$("#lobby-tabs [role=tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.lobby === k));
  $("#lobby-rl").hidden = k !== "rl"; $("#lobby-bj").hidden = k !== "bj";
  try { localStorage.setItem("comu-lobby", k); } catch (_) {}
}
$("#lobby-tabs").addEventListener("click", e => { const b = e.target.closest("[data-lobby]"); if (b) setLobbyTab(b.dataset.lobby); });
$("#lobby-tabs").addEventListener("keydown", e => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const tabs = $$("#lobby-tabs [role=tab]"), i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  const nx = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
  nx.focus(); setLobbyTab(nx.dataset.lobby);
});
try { if (localStorage.getItem("comu-lobby") === "bj") setLobbyTab("bj"); } catch (_) {}

async function openLobby(){
  $("#bj-new").hidden = !state.isAdmin;
  await loadLobby();
  if (!LOBBY.chan && USE_DB && !BJ.missing){
    const kick = () => { clearTimeout(LOBBY.t); LOBBY.t = setTimeout(loadLobby, 400); };
    LOBBY.chan = sb.channel("bj-lobby")
      .on("postgres_changes", { event: "*", schema: "public", table: "bj_tables" }, kick)
      .on("postgres_changes", { event: "*", schema: "public", table: "bj_seats" }, kick)
      .subscribe();
  }
}
function closeLobby(){ if (LOBBY.chan){ sb.removeChannel(LOBBY.chan); LOBBY.chan = null; } }

async function loadLobby(){
  const box = $("#bj-rooms");
  if (!USE_DB){ box.innerHTML = `<li class="slot-note">데이터베이스에 연결되면 테이블이 보입니다.</li>`; return; }
  const { data, error } = await sb.from("bj_tables")
    .select(`id, title, status, phase, currency, min_bet, max_bet, max_seats, round, created_at, bj_seats(count)${ROUNDS.ok ? ", max_rounds" : ""}`)
    .order("created_at", { ascending: false }).limit(20);
  if (error){ BJ.missing = missingTable(error); box.innerHTML = BJ.missing ? `<li>${NEED_SQL}</li>` : `<li class="form-error" role="alert">${esc(errMsg(error))}</li>`; return; }
  BJ.missing = false;
  $("#bj-new").hidden = !state.isAdmin;
  const rows = (data || []).sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1));
  box.innerHTML = rows.length ? rows.map(t => {
    const cnt = t.bj_seats?.[0]?.count ?? 0, open = t.status === "open";
    return `<li><a class="rl-room ${open ? (t.phase === "playing" ? "st-playing" : "st-waiting") : "st-finished"}" href="#blackjack/${esc(t.id)}">
      <span class="rl-dot" aria-hidden="true"></span>
      <span class="t">${esc(t.title)}</span>
      <span class="m"><span class="st">${open ? (t.phase === "playing" ? "진행 중" : "베팅 중") : "끝남"}</span> · 자리 ${cnt}/${t.max_seats}${t.max_rounds ? ` · ${t.round}/${t.max_rounds}판` : ""} · ${chipAmt(t.min_bet, t.currency)}~${n(t.max_bet)}</span>
      <span class="go" aria-hidden="true">${open ? (cnt < t.max_seats ? "앉으러 가기" : "구경하기") : "결과 보기"}</span></a></li>`;
  }).join("") : `<li class="slot-note">${state.isAdmin ? "아직 테이블이 없습니다. ‘테이블 만들기’로 열어 주세요." : "열린 테이블이 없습니다. 관리자가 열면 여기에 보입니다."}</li>`;
}

/* 테이블 만들기 (관리자) */
$("#bj-new").addEventListener("click", () => { showMsg($("#bj-new-err"), ""); $("#bj-new-dlg").showModal(); $("#bj-new-title").select(); });
$("#bj-new-form").addEventListener("submit", async e => {
  e.preventDefault();
  const min = parseInt($("#bj-new-min").value, 10), max = parseInt($("#bj-new-max").value, 10);
  if (!(min >= 1) || !(max >= min)){ showMsg($("#bj-new-err"), "최소 베팅은 1 이상, 최대 베팅은 최소 이상이어야 합니다."); return; }
  await withBusy($('button[type="submit"]', e.target), async () => {
    const { data, error } = await sb.rpc("admin_bj_create", {
      p_title: $("#bj-new-title").value.trim(), p_currency: $('input[name="bj-cur"]:checked').value,
      p_min: min, p_max: max, p_seats: +$("#bj-new-seats").value,
      ...(ROUNDS.ok ? { p_rounds: Math.min(100, Math.max(1, parseInt($("#bj-new-rounds").value, 10) || 10)) } : {})
    });
    if (error){ showMsg($("#bj-new-err"), missingTable(error) ? "supabase/update-13.sql을 먼저 실행해 주세요." : errMsg(error)); return; }
    $("#bj-new-dlg").close();
    location.hash = "#blackjack/" + data;
  });
});
$$("#bj-new-dlg [data-close]").forEach(b => b.addEventListener("click", () => $("#bj-new-dlg").close()));

/* =========================================================
   테이블
   ========================================================= */
function closeTable(){
  if (BJ.chan){ sb.removeChannel(BJ.chan); BJ.chan = null; }
  clearInterval(BJ.poll); clearInterval(BJ.tickT); BJ.poll = BJ.tickT = 0; BJ.live = false;
  BJ.id = null;
}
async function openTable(id){
  if (BJ.id !== id){
    closeTable();
    clearTimeout(BJ.animT);
    Object.assign(BJ, { id, t: null, seats: [], avatars: new Map(), lastChat: 0, seen: new Set(), wasMyTurn: false, tickTry: 0, betAmt: null,
      vis: new Set(), queue: [], anim: false, held: [], soundRound: -1, results: null });
    $("#bj-chat").innerHTML = ""; $("#bj-seats").innerHTML = ""; $("#bj-dealer").innerHTML = ""; $("#bj-bar").innerHTML = ""; $("#bj-tools").innerHTML = "";
    $("#bj-status").textContent = "불러오는 중…"; $("#bj-meta").textContent = "";
  }
  await load(false);
  if (BJ.id !== id || !BJ.t) return;
  subscribe(id);
  BJ.poll = setInterval(() => { if (!BJ.live && !document.hidden) load(true); }, 4000);
  BJ.tickT = setInterval(tick, 1000);
}
function subscribe(id){
  const again = () => { clearTimeout(BJ.reloadT); BJ.reloadT = setTimeout(() => load(true), 120); };
  BJ.chan = sb.channel("bj:" + id)
    .on("postgres_changes", { event: "*", schema: "public", table: "bj_tables", filter: `id=eq.${id}` }, again)
    .on("postgres_changes", { event: "*", schema: "public", table: "bj_seats" }, again)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "bj_chat", filter: `table_id=eq.${id}` }, ({ new: row }) => { ingestChat([row], true); again(); })
    .subscribe(st => { BJ.live = st === "SUBSCRIBED"; });
}

async function load(quiet){
  if (BJ.loading) return BJ.loading;
  const id = BJ.id;
  BJ.loading = (async () => {
    const [t, s, c] = await Promise.all([
      sb.from("bj_tables").select(`id, title, status, phase, currency, min_bet, max_bet, max_seats, round, turn_seat, dealer_cards, bet_deadline, last_action_at${ROUNDS.ok ? ", max_rounds" : ""}`).eq("id", id).maybeSingle(),
      sb.from("bj_seats").select(`seat, character_id, bet, cards, state, doubled, result, payout${DUMMY.ok ? ", dummy_name" : ""}`).eq("table_id", id).order("seat"),
      sb.from("bj_chat").select("id, name, body, kind, data, created_at").eq("table_id", id).gt("id", BJ.lastChat).order("id", { ascending: false }).limit(120)
    ]);
    if (BJ.id !== id) return;
    if (DUMMY.ok && s.error && /dummy_name/.test(s.error.message || "")){ DUMMY.ok = false; BJ.loading = null; return load(quiet); }
    if (ROUNDS.ok && t.error && /max_rounds/.test(t.error.message || "")){ ROUNDS.ok = false; BJ.loading = null; return load(quiet); }
    const err = [t, s, c].find(x => x.error)?.error;
    if (err){ if (!quiet || missingTable(err)) tableError(missingTable(err) ? NEED_SQL : `<p class="form-error" role="alert">${esc(errMsg(err))}</p>`); return; }
    if (!t.data){ tableError(`<p class="empty-note">없는 테이블입니다. 지워졌을 수 있습니다.</p><p style="text-align:center"><a class="btn" href="#game">게임으로</a></p>`); return; }
    // 내 시계와 서버 시계 차이: 행동 직후 바로 받은 경우에만 잼
    const prev = BJ.t?.last_action_at, now = t.data.last_action_at;
    if (prev && now && prev !== now && (BJ.live || Date.now() - BJ.actedAt < 3000)){ const d = Date.now() - Date.parse(now); if (Math.abs(d) < 300000) BJ.skew = d; }
    const first = !BJ.t;
    BJ.t = t.data; BJ.seats = s.data || [];
    syncReveal(first);
    const ids = BJ.seats.map(x => x.character_id).concat(myChars().map(x => x.uuid));
    if (ids.length){
      const av = await sb.from("roulette_avatars").select("character_id, path").in("character_id", [...new Set(ids)]);
      if (!av.error) BJ.avatars = new Map(av.data.map(a => [a.character_id, a]));
    }
    ingestChat((c.data || []).reverse(), quiet);
    if (BJ.t.status === "closed" && !BJ.results) loadResults();
    render();
    if (!BJ.anim && !BJ.queue.length) flushHeld();
  })().finally(() => { BJ.loading = null; });
  return BJ.loading;
}
function tableError(html){
  BJ.t = null;
  $("#bj-status").textContent = "";
  $("#bj-seats").innerHTML = `<div class="rl-error">${html}</div>`;
  $("#bj-dealer").innerHTML = ""; $("#bj-bar").innerHTML = ""; $("#bj-tools").innerHTML = "";
}

/* =========================================================
   카드 한 장씩 보여 주기 — 서버는 결과를 한 번에 주지만, 화면은 실제 딜러처럼 순서대로 펼침
   순서: 첫 장(자리 순서) → 딜러 앞면 → 둘째 장 → 딜러 엎은 카드 → 추가로 받은 카드(자리 순서) → 딜러가 엎은 카드 뒤집기 → 딜러가 더 받는 카드
   ========================================================= */
const DK = (r, k) => `${r}:d:${k}`, SK = (r, seat, k) => `${r}:${seat}:${k}`;
function revealOrder(){
  const t = BJ.t, r = t.round, out = [], d = t.dealer_cards || [];
  const seats = BJ.seats.filter(x => x.cards.length).sort((a, b) => a.seat - b.seat);
  if (!d.length && !seats.length) return out;
  for (let k = 0; k < 2; k++){
    seats.forEach(x => { if (x.cards.length > k) out.push([SK(r, x.seat, k), 380]); });
    if (k === 0 && d.length) out.push([DK(r, 0), 380]);
    if (k === 1 && d.length) out.push([DK(r, "back"), 380]);
  }
  seats.forEach(x => { for (let k = 2; k < x.cards.length; k++) out.push([SK(r, x.seat, k), 520]); });
  for (let k = 1; k < d.length; k++) out.push([DK(r, k), k === 1 ? 800 : 900]);   // 딜러 쪽은 천천히
  return out;
}
function syncReveal(first){
  const order = revealOrder();
  if (first){ order.forEach(([k]) => BJ.vis.add(k)); return; }
  const queued = new Set(BJ.queue.map(q => q[0]));
  order.forEach(it => { if (!BJ.vis.has(it[0]) && !queued.has(it[0])) BJ.queue.push(it); });
  if (BJ.queue.length && !BJ.anim){ BJ.anim = true; BJ.animT = setTimeout(step, 120); }
}
function step(){
  const it = BJ.queue.shift();
  if (!it || !BJ.t){ BJ.anim = false; finishAnim(); return; }
  BJ.vis.add(it[0]);
  const m = it[0].match(/^\d+:(\d+):(\d+)$/), s = m && seatAt(+m[1]);
  const done = s && visCards(s).length === s.cards.length;
  sfx(done && total(s.cards) > 21 ? "out" : "card");
  renderDealer(); renderSeats();
  BJ.animT = setTimeout(step, it[1]);
}
function finishAnim(){
  flushHeld();
  if (!BJ.t) return;
  render();
  const t = BJ.t, me = mySeat();
  if (t.phase === "betting" && me?.result && me.cards.length && BJ.soundRound !== t.round){
    BJ.soundRound = t.round;
    sfx(/win|blackjack/.test(me.result) ? "win" : me.result === "lose" ? "out" : "card");
  }
}
const visCards = x => x.cards.filter((_, k) => BJ.vis.has(SK(BJ.t.round, x.seat, k)));
const dealerDone = () => { const t = BJ.t, d = t.dealer_cards || []; return d.every((_, k) => BJ.vis.has(DK(t.round, k))); };

/* ---------- 그리기 ---------- */
function render(){
  const t = BJ.t; if (!t) return;
  const me = mySeat();
  if (me) BJ.myChar = me.character_id;
  else if (!myChars().some(c => c.uuid === BJ.myChar)) BJ.myChar = myChars().sort((a, b) => (a.role === "참가자" ? 0 : 1) - (b.role === "참가자" ? 0 : 1))[0]?.uuid || null;
  if ($("#bj-title").textContent !== t.title) $("#bj-title").textContent = t.title;
  setTitle(t.title);
  $("#bj-meta").innerHTML = [CUR[cur()].name, `베팅 ${n(t.min_bet)}~${n(t.max_bet)}`, `자리 ${BJ.seats.length}/${t.max_seats}`, t.max_rounds ? `${t.round}/${t.max_rounds}판` : `${t.round}판째`, t.status === "closed" && !BJ.anim ? "끝남" : ""].filter(Boolean)
    .map(x => `<span>${x}</span>`).join("");
  renderDealer(); renderSeats(); renderStatus(); renderBar(); renderTools(); renderFinal(); tick();
  const my = isMyTurn() && !BJ.anim;
  if (my && !BJ.wasMyTurn){ toast("내 차례입니다"); announce("내 차례입니다. 카드를 더 받거나 멈추세요."); sfx("turn"); }
  BJ.wasMyTurn = my;
}

function renderDealer(){
  const t = BJ.t, r = t.round, cards = t.dealer_cards || [];
  const vis = cards.filter((_, k) => BJ.vis.has(DK(r, k)));
  const showBack = BJ.vis.has(DK(r, "back")) && !BJ.vis.has(DK(r, 1));
  const shown = vis.map((c, i) => cardHtml(c, DK(r, i))).join("") + (showBack ? cardHtml(0, DK(r, "hole"), true) : "");
  const full = vis.length === cards.length && cards.length > 1;   // 엎은 카드까지 다 펼침
  const tot = vis.length ? (full ? total(vis) : `${total(vis)}${showBack ? "+?" : ""}`) : "";
  const bust = full && total(vis) > 21, bj = full && isBJ(vis);
  $("#bj-dealer").innerHTML = `<div class="bj-hand dealer">
      <span class="bj-who">딜러${tot !== "" ? ` <b class="bj-tot${bust ? " bust" : bj ? " bj" : ""}">${bj ? "블랙잭" : bust ? `${tot} 버스트` : tot}</b>` : ""}</span>
      <div class="bj-cards">${shown || `<span class="bj-empty">17 이상에서 멈춤</span>`}</div>
    </div>`;
}

function renderSeats(){
  const t = BJ.t, me = mySeat(), N = t.max_seats, admin = state.isAdmin;
  $("#bj-seats").style.setProperty("--n", N);
  $("#bj-seats").innerHTML = Array.from({ length: N }, (_, i) => {
    const s = seatAt(i), off = i - (N - 1) / 2, arc = `style="--dy:${(-Math.pow(Math.abs(off), 1.6) * 14).toFixed(1)}px"`;   // 양 끝이 살짝 올라가 둥글게
    if (!s) return `<div class="bj-seat empty" ${arc}><span class="av"></span><span class="nm">빈 자리</span></div>`;
    const c = seatChar(s), src = c.dummy ? "" : avatarOf(c), isMe = me && me.seat === i;
    const vc = visCards(s), complete = vc.length === s.cards.length, settled = complete && dealerDone() && !BJ.anim;
    const turn = t.phase === "playing" && t.turn_seat === i && !BJ.anim, tot = total(vc);
    const tag = !complete ? ""
      : s.state === "bust" || (s.result && tot > 21 && !settled) ? `<span class="bj-tag bust">버스트</span>`
      : s.state === "blackjack" || (s.result && isBJ(s.cards) && !settled) ? `<span class="bj-tag bj">블랙잭</span>`
      : s.state === "stood" ? `<span class="bj-tag">멈춤</span>`
      : s.state === "bet" ? `<span class="bj-tag ready">베팅 완료</span>`
      : s.result && s.cards.length && settled ? `<span class="bj-tag res-${s.result}">${RESULT[s.result]}${s.character_id ? (s.payout > s.bet ? ` +${n(s.payout - s.bet)}` : s.result === "lose" ? ` -${n(s.bet)}` : "") : ""}</span>` : "";
    const label = `${c.name}${isMe ? " (나)" : ""}${vc.length ? `, 카드 ${vc.map(cardName).join(", ")}, 합 ${tot}` : ""}${s.bet ? `, 베팅 ${s.bet}` : ""}${turn ? ", 지금 차례" : ""}`;
    return `<div ${arc} class="bj-seat${isMe ? " mine" : ""}${turn ? " turn" : ""}${complete && (s.state === "bust" || (settled && s.result === "lose")) ? " lost" : ""}${settled && (s.result === "win" || s.result === "blackjack") ? " won" : ""}" data-seat="${i}" aria-label="${esc(label)}">
      <div class="bj-cards">${vc.map((cd, k) => cardHtml(cd, SK(t.round, i, k))).join("")}</div>
      ${vc.length ? `<span class="bj-tot">${tot}${soft(vc) && tot < 21 && s.state === "playing" ? `<small>/${tot - 10}</small>` : ""}</span>` : ""}
      ${tag}
      <span class="av">${src ? `<img src="${esc(src)}" alt="" decoding="async" draggable="false">` : `<span class="ph">${esc(c.name.slice(0, 1))}</span>`}${turn ? `<span class="tm" aria-hidden="true"></span>` : ""}</span>
      <span class="nm">${esc(c.name)}${isMe ? `<small>나</small>` : ""}${c.dummy ? `<small class="dm">더미</small>` : ""}</span>
      ${s.bet && s.state !== "idle" && !c.dummy ? `<span class="bj-bet">${chipAmt(s.bet, t.currency)}${s.doubled ? `<small>×2</small>` : ""}</span>` : ""}
      ${admin && !isMe ? `<button class="bj-kick" type="button" data-kick="${i}" aria-label="${esc(c.name)} 자리 비우기">비우기</button>` : ""}
    </div>`;
  }).join("");
}

function leftSec(){
  const t = BJ.t; if (!t || t.status !== "open") return null;
  if (t.phase === "playing" && t.turn_seat != null) return Math.max(0, Math.ceil(TURN_SEC - (Date.now() - BJ.skew - Date.parse(t.last_action_at)) / 1000));
  if (t.phase === "betting" && t.bet_deadline) return Math.max(0, Math.ceil((Date.parse(t.bet_deadline) - (Date.now() - BJ.skew)) / 1000));
  return null;
}
function renderStatus(){
  const t = BJ.t, el = $("#bj-status");
  let html;
  const last = t.max_rounds && ((t.phase === "playing" && t.round >= t.max_rounds) || (t.phase === "betting" && t.round + 1 >= t.max_rounds));
  if (BJ.anim) html = t.phase === "playing" && !(t.dealer_cards || []).length ? `<b>카드를 나누는 중…</b>` : t.phase === "playing" ? `<b>카드를 받는 중…</b>` : `<b>딜러 차례</b>`;
  else if (t.status === "closed") html = `<b>게임 끝</b> · ${t.round}판`;
  else if (t.phase === "betting") html = t.bet_deadline ? `<b>베팅 중</b> · 카드 배분까지 <span class="left" id="bj-left"></span>` : `<b>베팅을 기다리는 중</b>`;
  else {
    const s = seatAt(t.turn_seat);
    html = isMyTurn() ? `<b class="mine">내 차례</b> · <span class="left" id="bj-left"></span>` : `<b>${esc(s ? seatChar(s).name : "—")}</b> 차례 · <span class="left" id="bj-left"></span>`;
  }
  if (last && t.status !== "closed" && !BJ.anim) html = `<b class="mine">마지막 판</b> · ` + html;
  el.innerHTML = html;
}

/* 게임이 끝나면 테이블 위에 최종 결과 */
async function loadResults(){
  const { data, error } = await sb.rpc("bj_results", { p_table: BJ.id });
  BJ.results = !error && Array.isArray(data) ? data : [];
  renderFinal();
}
function renderFinal(){
  const box = $("#bj-final"), t = BJ.t;
  const on = t && t.status === "closed" && BJ.results && !BJ.anim;
  box.hidden = !on;
  if (!on) return;
  box.innerHTML = `<h2>최종 결과</h2><p class="sub">${esc(t.title)} · ${t.round}판</p>
    ${BJ.results.length ? `<ol>${BJ.results.map((r, i) => `<li><span class="no">${i + 1}</span><span class="nm">${esc(r.name)}</span>${chipAmt(r.net, t.currency, true)}</li>`).join("")}</ol>` : `<p class="sub">참가자가 없었습니다.</p>`}
    <a class="btn small" href="#game">게임으로</a>`;
}

function renderBar(){
  const t = BJ.t, bar = $("#bj-bar"), me = mySeat(), chars = myChars(), c = cur();
  const keep = document.activeElement?.closest?.("#bj-bar")?.dataset?.act;
  if (document.activeElement?.id === "bj-amt") return;   // 금액 입력 중엔 다시 그리지 않음
  if (BJ.anim){ bar.innerHTML = `<p class="rl-note">…</p>`; return; }
  let html = "";
  if (!state.session) html = `<p class="rl-note">구경 중입니다. 참여하려면 <a href="#login">로그인</a>해 주세요.</p>`;
  else if (t.status === "closed") html = `<p class="rl-note">닫힌 테이블입니다.</p><a class="btn" href="#game">게임으로</a>`;
  else if (!me){
    if (!chars.length) html = `<p class="rl-note">연결된 캐릭터가 없어 구경만 할 수 있습니다.</p>`;
    else html = `${chars.length > 1 ? `<label class="sr" for="bj-join-char">앉을 캐릭터</label><select class="input rl-sel" id="bj-join-char">${chars.map(x =>
      `<option value="${esc(x.uuid)}"${x.uuid === BJ.myChar ? " selected" : ""}>${esc(x.name)} — ${CUR[c].short} ${n(balOf(x, c))}</option>`).join("")}</select>` : ""}
      <button class="btn primary" type="button" data-act="join"${BJ.seats.length >= t.max_seats ? " disabled" : ""}>${chars.length > 1 ? "" : esc(chars[0].name) + "(으)로 "}자리에 앉기</button>`;
  } else if (isMyTurn()){
    const canDouble = me.cards.length === 2 && balOf(chars.find(x => x.uuid === me.character_id), c) >= me.bet;
    html = `<button class="btn rl-act shoot" type="button" data-act="hit">카드 더 받기</button>
      <button class="btn rl-act" type="button" data-act="stand">멈추기</button>
      <button class="btn rl-act" type="button" data-act="double"${canDouble ? "" : " disabled"}>두 배 걸기 <small>+${n(me.bet)}</small></button>
      <p class="rl-note">지금 ${total(me.cards)} · 21을 넘으면 집니다.</p>`;
  } else if (t.phase === "betting" && me.state === "idle"){
    const mc = chars.find(x => x.uuid === me.character_id), have = balOf(mc, c);
    const amt = Math.min(t.max_bet, Math.max(t.min_bet, BJ.betAmt ?? t.min_bet));
    html = `<div class="bj-betbox">
        <label class="sr" for="bj-amt">베팅 (${CUR[c].name})</label>
        <button class="btn small" type="button" data-amt="min">최소</button>
        <input class="input bj-amt" id="bj-amt" type="number" inputmode="numeric" min="${t.min_bet}" max="${t.max_bet}" step="1" value="${amt}">
        <button class="btn small" type="button" data-amt="x2">×2</button>
        <button class="btn small" type="button" data-amt="max">최대</button>
      </div>
      <button class="btn rl-act shoot" type="button" data-act="bet"${have < t.min_bet ? " disabled" : ""}>베팅</button>
      <button class="btn" type="button" data-act="leave">일어나기</button>
      <p class="rl-note">보유 ${chipAmt(have, c)} · ${n(t.min_bet)}~${n(t.max_bet)}</p>`;
  } else if (t.phase === "betting" && me.state === "bet"){
    html = `<p class="rl-note">${chipAmt(me.bet, c)} 걸었습니다. 다른 자리를 기다리는 중…</p><button class="btn" type="button" data-act="leave">취소하고 일어나기</button>`;
  } else {
    html = `<p class="rl-note">${me.state === "idle" ? "이번 판은 구경 중입니다. 판이 끝나면 걸 수 있습니다." : "다른 자리를 기다리는 중…"}</p>`;
  }
  bar.innerHTML = html;
  if (keep) $(`[data-act="${keep}"]`, bar)?.focus();
}

function renderTools(){
  const t = BJ.t, tools = $("#bj-tools"), a = state.isAdmin;
  if (!$(".bj-btns", tools)) tools.innerHTML = `<label class="rl-vol" title="효과음 크기"><span>소리</span><input type="range" id="bj-vol" min="0" max="100" step="10" value="${Math.round(sfxVol() * 100)}" aria-label="효과음 크기"><output>${Math.round(sfxVol() * 100) || "끔"}</output></label><span class="rl-btns bj-btns"></span>`;
  const html = [
    a && DUMMY.ok && t.status === "open" ? `<button class="btn small" type="button" data-act="dummy"${BJ.seats.length >= t.max_seats ? " disabled" : ""}>더미 추가</button>` : "",
    a && t.status === "open" && t.phase === "betting" ? `<button class="btn small primary" type="button" data-act="dealnow"${BJ.seats.some(x => x.state === "bet" || !x.character_id) ? "" : " disabled"}>카드 나누기</button>` : "",
    a && t.status === "open" ? `<button class="btn small danger" type="button" data-act="close">테이블 닫기</button>` : "",
    a && t.status === "closed" ? `<button class="btn small danger" type="button" data-act="delete">테이블 지우기</button>` : ""
  ].join("");
  const box = $(".bj-btns", tools);
  if (box.dataset.h !== html){ box.innerHTML = html; box.dataset.h = html; }
}

/* 1초마다: 남은 시간 + 시간이 다 되면 아무나 bj_tick 을 불러 진행 */
function tick(){
  const left = leftSec(), lab = $("#bj-left"), tm = $("#bj-seats .bj-seat.turn .tm");
  if (lab) { lab.textContent = left != null ? `${left}초` : ""; lab.classList.toggle("low", left != null && left <= 5); }
  if (tm) { tm.textContent = left ?? ""; tm.classList.toggle("low", left != null && left <= 5); }
  if (left === 0 && state.session && Date.now() > BJ.tickTry){
    BJ.tickTry = Date.now() + 3000;
    sb.rpc("bj_tick", { p_table: BJ.id }).then(({ data }) => { if (data) load(true); });
  }
}

/* ---------- 채팅 ---------- */
const hhmm = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
function chatLi(m){
  if (m.kind === "chat") return `<li class="c"><b>${esc(m.name)}<time datetime="${esc(m.created_at)}">${hhmm(m.created_at)}</time></b><span>${esc(m.body)}</span></li>`;
  if (m.kind === "result") return `<li class="s res">${esc(m.body)}</li>`;
  return `<li class="s">${esc(m.body)}</li>`;
}
function ingestChat(rows, animate){
  const fresh = rows.filter(m => m.id > BJ.lastChat).sort((a, b) => a.id - b.id);
  if (!fresh.length) return;
  BJ.lastChat = fresh.at(-1).id;
  const now = [], later = [];
  for (const m of fresh){
    // 카드가 다 펼쳐지기 전에 결과가 먼저 보이지 않게, 진행 기록은 잠시 붙잡아 둠
    if (animate && m.kind !== "chat") later.push(m); else now.push(m);
    if (animate && m.data?.event === "bet" && Date.now() - Date.parse(m.created_at) < 10000) sfx("bet");
  }
  appendChat(now, animate === false);
  BJ.held.push(...later);
}
function flushHeld(){ if (BJ.held.length){ const h = BJ.held; BJ.held = []; appendChat(h, false); } }
function appendChat(list, toEnd){
  if (!list.length) return;
  const box = $("#bj-chat"), atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  let ul = $("ul", box);
  if (!ul){ box.innerHTML = `<ul class="rl-log"></ul>`; ul = $("ul", box); }
  ul.insertAdjacentHTML("beforeend", list.map(chatLi).join(""));
  while (ul.children.length > 200) ul.firstElementChild.remove();
  if (atEnd || toEnd) box.scrollTop = box.scrollHeight;
}
$("#bj-say").addEventListener("submit", async e => {
  e.preventDefault();
  const inp = $("#bj-say-in"), body = inp.value.trim();
  if (!body || !BJ.id) return;
  if (!state.session){ toast("채팅하려면 로그인해 주세요"); return; }
  inp.value = "";
  const { error } = await sb.rpc("bj_say", { p_table: BJ.id, p_body: body, p_character: BJ.myChar });
  if (error){ inp.value = body; toast(errMsg(error)); return; }
  if (!BJ.live) load(true);
});

/* ---------- 조작 ---------- */
async function call(fn, args, ok){
  const { data, error } = await sb.rpc(fn, args);
  if (error){ toast(missingTable(error) ? "supabase/update-13.sql을 먼저 실행해 주세요" : errMsg(error)); return null; }
  BJ.actedAt = Date.now();
  if (ok) toast(ok);
  return data ?? true;
}
async function act(btn){
  const a = btn.dataset.act, t = BJ.t, me = mySeat();
  if (!t) return;
  if (a === "close" && !confirm("테이블을 닫을까요? 진행 중인 판의 베팅은 모두 돌려줍니다.")) return;
  if (a === "delete" && !confirm("이 테이블을 지울까요? 채팅 기록도 함께 지워집니다. (칩 기록은 남습니다)")) return;
  await withBusy(btn, async () => {
    if (a === "join"){
      const cid = $("#bj-join-char")?.value || myChars()[0]?.uuid;
      if (await call("bj_join", { p_table: BJ.id, p_character: cid })) BJ.myChar = cid;
    } else if (a === "leave") await call("bj_leave", { p_table: BJ.id, p_character: me.character_id });
    else if (a === "bet"){
      const amt = parseInt($("#bj-amt").value, 10);
      if (!(amt >= t.min_bet && amt <= t.max_bet)){ toast(`베팅은 ${n(t.min_bet)}~${n(t.max_bet)}입니다`); $("#bj-amt").focus(); return; }
      BJ.betAmt = amt;
      if (await call("bj_bet", { p_table: BJ.id, p_character: me.character_id, p_amount: amt })){
        const { loadMine } = await import("./auth.js?v=20261027c"); loadMine();
      }
    }
    else if (a === "hit"){ sfx("card"); await call("bj_hit", { p_table: BJ.id }); }
    else if (a === "stand") await call("bj_stand", { p_table: BJ.id });
    else if (a === "double"){ sfx("bet"); await call("bj_double", { p_table: BJ.id }); }
    else if (a === "close") await call("admin_bj_close", { p_table: BJ.id }, "테이블을 닫았습니다");
    else if (a === "dummy") await call("admin_bj_add_dummy", { p_table: BJ.id, p_name: null }, "더미를 앉혔습니다");
    else if (a === "dealnow") await call("admin_bj_deal_now", { p_table: BJ.id });
    else if (a === "delete"){
      const { error } = await sb.from("bj_tables").delete().eq("id", BJ.id);
      if (error){ toast(errMsg(error)); return; }
      toast("테이블을 지웠습니다"); location.hash = "#game"; return;
    }
    load(true);
  });
}
$("#bj-bar").addEventListener("click", e => {
  const q = e.target.closest("[data-amt]");
  if (q){
    const t = BJ.t, inp = $("#bj-amt"), v = parseInt(inp.value, 10) || t.min_bet;
    inp.value = q.dataset.amt === "min" ? t.min_bet : q.dataset.amt === "max" ? t.max_bet : Math.min(t.max_bet, v * 2);
    BJ.betAmt = +inp.value; return;
  }
  const b = e.target.closest("[data-act]"); if (b) act(b);
});
$("#bj-bar").addEventListener("input", e => { if (e.target.id === "bj-amt") BJ.betAmt = parseInt(e.target.value, 10) || null; });
$("#bj-bar").addEventListener("keydown", e => { if (e.target.id === "bj-amt" && e.key === "Enter"){ e.preventDefault(); const b = $('[data-act="bet"]', $("#bj-bar")); if (b && !b.disabled) act(b); } });
$("#bj-bar").addEventListener("focusout", e => { if (e.target.id === "bj-amt") setTimeout(() => { if (document.activeElement?.id !== "bj-amt" && BJ.t) renderBar(); }, 0); });
$("#bj-tools").addEventListener("click", e => { const b = e.target.closest("[data-act]"); if (b) act(b); });
$("#bj-seats").addEventListener("click", async e => {
  const b = e.target.closest("[data-kick]"); if (!b) return;
  if (!confirm("이 자리를 비울까요? 이번 판에 건 칩은 돌려줍니다.")) return;
  await withBusy(b, async () => { await call("admin_bj_kick", { p_table: BJ.id, p_seat: +b.dataset.kick }); load(true); });
});
$("#bj-tools").addEventListener("input", e => {
  if (e.target.id !== "bj-vol") return;
  const v = +e.target.value; setSfxVol(v / 100); e.target.nextElementSibling.textContent = v || "끔";
});
$("#bj-tools").addEventListener("change", e => { if (e.target.id === "bj-vol" && +e.target.value) sfx("card"); });

document.addEventListener("comu:auth", () => { if (nav.current === "blackjack" && BJ.t) render(); if (nav.current === "game") loadLobby(); });
