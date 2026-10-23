/* =========================================================
   러시안 룰렛 (supabase/update-8.sql)
   - 게임 화면: 방 목록(로비). 방은 관리자만 엶
   - #roulette/방ID: 둥근 테이블에 자리, 가운데 전기 충격기, 오른쪽 채팅, 아래 쏘기·넘기기·베팅하기
   - 탄 위치는 서버만 앎. 화면은 서버가 돌려준 결과(채팅의 'shot' 기록)를 보고 효과만 그림
   - 실시간 연결이 끊겨도 5초마다 다시 불러와 따라감
   ========================================================= */
import { USE_DB, publicUrl, sb } from "./data.js?v=20261024b";
import { $, $$, announce, esc, setTitle, toast } from "./dom.js?v=20261024b";
import { errMsg, showMsg, withBusy } from "./forms.js?v=20261024b";
import { motionOK, nav, state } from "./state.js?v=20261024b";
import { ALL, myChars } from "./views.js?v=20261024b";

const RL = {
  id: null, room: null, seats: [], bets: [], chat: [], avatars: new Map(),
  chan: null, live: false, poll: 0, reloadT: 0, loading: null,
  target: null, myChar: null, fxSeen: new Set(), lastChat: 0, wasMyTurn: false, missing: false,
  fxUntil: 0, renderT: 0
};
const LOBBY = { chan: null, t: 0 };
const n = v => Number(v || 0).toLocaleString("ko-KR");
const STATUS = { waiting: "대기 중", playing: "진행 중", finished: "끝남", cancelled: "취소됨" };
const missingTable = e => /42P01|PGRST205|PGRST202|roulette_/.test(`${e?.code} ${e?.message}`);
const NEED_SQL = `<p class="form-note">러시안 룰렛이 아직 준비되지 않았습니다. (관리자: Supabase에서 <strong>supabase/update-8.sql</strong> 실행 필요)</p>`;

/* 캐릭터 정보 (공개 데이터) */
const charOf = uuid => ALL().find(c => c.uuid === uuid) || { uuid, name: "(알 수 없음)", role: "", chip: "green" };
const seatChar = s => charOf(s.character_id);
const avatarOf = c => {
  const a = RL.avatars.get(c.uuid);
  return a ? publicUrl("roulette", a.path) : (c.thumb || c.img || "");
};
const mineUuids = () => new Set(state.mine.map(m => m.uuid));
const mySeat = () => { const mine = mineUuids(); return RL.seats.find(s => mine.has(s.character_id)) || null; };
const seatAt = i => RL.seats.find(s => s.seat === i) || null;
const isMyTurn = () => { const r = RL.room, me = mySeat(); return !!(r && me && r.status === "playing" && r.turn_seat === me.seat && me.alive); };
const betOpen = () => RL.room?.status === "playing" && RL.seats.every(s => s.alive);

/* =========================================================
   라우터에서 부름
   ========================================================= */
export function onRoute(view, param){
  if (view === "game"){ closeRoom(); openLobby(); }
  else if (view === "roulette"){ closeLobby(); openRoom(param); }
  else { closeRoom(); closeLobby(); }
}

/* ---------- 로비 ---------- */
async function openLobby(){
  $("#rl-new").hidden = !state.isAdmin;
  await loadLobby();
  if (!LOBBY.chan && USE_DB && !RL.missing){
    const kick = () => { clearTimeout(LOBBY.t); LOBBY.t = setTimeout(loadLobby, 400); };
    LOBBY.chan = sb.channel("rl-lobby")
      .on("postgres_changes", { event: "*", schema: "public", table: "roulette_rooms" }, kick)
      .on("postgres_changes", { event: "*", schema: "public", table: "roulette_seats" }, kick)
      .subscribe();
  }
}
function closeLobby(){ if (LOBBY.chan){ sb.removeChannel(LOBBY.chan); LOBBY.chan = null; } }

async function loadLobby(){
  const box = $("#rl-rooms");
  if (!USE_DB){ box.innerHTML = `<li class="slot-note">데이터베이스에 연결되면 방 목록이 보입니다.</li>`; return; }
  const { data, error } = await sb.from("roulette_rooms")
    .select("id, title, status, max_seats, entry_fee, pot, created_at, roulette_seats(count)")
    .order("created_at", { ascending: false }).limit(20);
  if (error){ RL.missing = missingTable(error); box.innerHTML = RL.missing ? `<li>${NEED_SQL}</li>` : `<li class="form-error" role="alert">${esc(errMsg(error))}</li>`; return; }
  RL.missing = false;
  const order = { playing: 0, waiting: 1, finished: 2, cancelled: 3 };
  const rows = (data || []).sort((a, b) => order[a.status] - order[b.status]);
  $("#rl-new").hidden = !state.isAdmin;
  box.innerHTML = rows.length ? rows.map(r => {
    const cnt = r.roulette_seats?.[0]?.count ?? 0;
    return `<li><a class="rl-room st-${r.status}" href="#roulette/${esc(r.id)}">
      <span class="rl-dot" aria-hidden="true"></span>
      <span class="t">${esc(r.title)}</span>
      <span class="m"><span class="st">${STATUS[r.status]}</span> · 자리 ${cnt}/${r.max_seats}${r.entry_fee ? ` · 참가비 ${n(r.entry_fee)}칩` : ""}${r.status === "playing" && r.pot ? ` · 판돈 ${n(r.pot)}` : ""}</span>
      <span class="go" aria-hidden="true">${r.status === "waiting" ? "앉으러 가기" : r.status === "playing" ? "구경하기" : "결과 보기"}</span></a></li>`;
  }).join("") : `<li class="slot-note">${state.isAdmin ? "아직 방이 없습니다. ‘방 만들기’로 열어 주세요." : "열린 방이 없습니다. 관리자가 방을 열면 여기에 보입니다."}</li>`;
}

/* ---------- 방 만들기 (관리자) ---------- */
$("#rl-new").addEventListener("click", () => { showMsg($("#rl-new-err"), ""); $("#rl-new-dlg").showModal(); $("#rl-new-title").select(); });
$("#rl-new-form").addEventListener("submit", async e => {
  e.preventDefault();
  const fee = parseInt($("#rl-new-fee").value, 10);
  if (!(fee >= 0)){ showMsg($("#rl-new-err"), "참가비는 0 이상의 정수입니다."); return; }
  await withBusy($('button[type="submit"]', e.target), async () => {
    const { data, error } = await sb.rpc("admin_roulette_create", {
      p_title: $("#rl-new-title").value.trim(), p_max_seats: +$("#rl-new-seats").value, p_entry_fee: fee,
      p_pass_rule: $('input[name="rl-pass"]:checked').value
    });
    if (error){ showMsg($("#rl-new-err"), missingTable(error) ? "supabase/update-8.sql을 먼저 실행해 주세요." : errMsg(error)); return; }
    $("#rl-new-dlg").close();
    location.hash = "#roulette/" + data;
  });
});
$$(".rl-dlg [data-close]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));

/* =========================================================
   방
   ========================================================= */
function closeRoom(){
  if (RL.chan){ sb.removeChannel(RL.chan); RL.chan = null; }
  clearInterval(RL.poll); RL.poll = 0; RL.live = false;
  RL.id = null;
}

async function openRoom(id){
  if (RL.id !== id){
    closeRoom();
    Object.assign(RL, { id, room: null, seats: [], bets: [], chat: [], avatars: new Map(), target: null, fxSeen: new Set(), lastChat: 0, wasMyTurn: false });
    $("#rl-chat").innerHTML = ""; $("#rl-ring").innerHTML = ""; $("#rl-bar").innerHTML = ""; $("#rl-tools").innerHTML = "";
    $("#rl-status").textContent = "불러오는 중…"; $("#rl-meta").textContent = "";
  }
  await load(false);
  if (RL.id !== id || !RL.room) return;
  subscribe(id);
  RL.poll = setInterval(() => { if (!RL.live && !document.hidden) load(true); }, 5000);
}

function subscribe(id){
  const again = () => { clearTimeout(RL.reloadT); RL.reloadT = setTimeout(() => load(true), 150); };
  const f = { filter: `room_id=eq.${id}` };
  RL.chan = sb.channel("rl:" + id)
    .on("postgres_changes", { event: "*", schema: "public", table: "roulette_rooms", filter: `id=eq.${id}` }, again)
    .on("postgres_changes", { event: "*", schema: "public", table: "roulette_seats" }, again)        // 지우기는 걸러 받을 수 없어 전부 받음
    .on("postgres_changes", { event: "*", schema: "public", table: "roulette_bets", ...f }, again)
    .on("postgres_changes", { event: "*", schema: "public", table: "roulette_avatars" }, again)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "roulette_chat", ...f }, ({ new: row }) => { ingestChat([row], true); again(); })
    .subscribe(st => { RL.live = st === "SUBSCRIBED"; });
}

/* 방 전체를 다시 불러옴 (quiet: 효과용 — 이미 그린 화면은 유지) */
async function load(quiet){
  if (RL.loading) return RL.loading;
  const id = RL.id;
  RL.loading = (async () => {
    const [r, s, b, c] = await Promise.all([
      sb.from("roulette_rooms").select("id, title, status, max_seats, entry_fee, pass_rule, pot, turn_seat, shots, round, self_survived, winner_seat, started_at, ended_at").eq("id", id).maybeSingle(),
      sb.from("roulette_seats").select("seat, character_id, alive, out_at").eq("room_id", id).order("seat"),
      sb.from("roulette_bets").select("id, seat, character_id, amount, payout").eq("room_id", id),
      sb.from("roulette_chat").select("id, name, body, kind, data, created_at").eq("room_id", id).gt("id", RL.lastChat).order("id", { ascending: false }).limit(120)
    ]);
    if (RL.id !== id) return;
    const err = [r, s, b, c].find(x => x.error)?.error;
    if (err){
      if (!quiet || missingTable(err)) roomError(missingTable(err) ? NEED_SQL : `<p class="form-error" role="alert">${esc(errMsg(err))}</p>`);
      return;
    }
    if (!r.data){ roomError(`<p class="empty-note">없는 방입니다. 지워졌을 수 있습니다.</p><p style="text-align:center"><a class="btn" href="#game">방 목록으로</a></p>`); return; }
    RL.room = r.data; RL.seats = s.data || []; RL.bets = b.data || [];
    const ids = RL.seats.map(x => x.character_id).concat(myChars().map(x => x.uuid));
    if (ids.length){
      const av = await sb.from("roulette_avatars").select("character_id, path").in("character_id", [...new Set(ids)]);
      if (!av.error) RL.avatars = new Map(av.data.map(a => [a.character_id, a]));
    }
    // 처음 불러올 때는 지난 효과를 다시 틀지 않음. 그 뒤로는 최근 10초 안의 것만
    ingestChat((c.data || []).reverse(), quiet);
    render();
  })().finally(() => { RL.loading = null; });
  return RL.loading;
}

function roomError(html){
  RL.room = null;
  $("#rl-status").textContent = "";
  $("#rl-ring").innerHTML = `<div class="rl-error">${html}</div>`;
  $("#rl-bar").innerHTML = ""; $("#rl-tools").innerHTML = ""; $("#rl-cyl").innerHTML = "";
}

/* =========================================================
   그리기
   ========================================================= */
function render(){
  const r = RL.room;
  if (!r) return;
  // 효과가 나오는 동안에는 자리를 다시 그리지 않음 (끝난 뒤 한 번에 — 탈락 표시도 번개 뒤에)
  const wait = RL.fxUntil - Date.now();
  if (wait > 0){ clearTimeout(RL.renderT); RL.renderT = setTimeout(render, wait + 20); return; }
  const me = mySeat();
  if (me) RL.myChar = me.character_id;
  else if (!myChars().some(c => c.uuid === RL.myChar)) RL.myChar = myChars().sort((a, b) => (a.role === "참가자" ? 0 : 1) - (b.role === "참가자" ? 0 : 1))[0]?.uuid || null;
  // 내 차례가 아니면 겨냥 초기화, 내 차례면 기본은 나
  if (!isMyTurn()) RL.target = null;
  else if (RL.target == null || !seatAt(RL.target)?.alive) RL.target = me.seat;

  const t = $("#rl-title");
  if (t.textContent !== r.title) t.textContent = r.title;
  setTitle(r.title);
  $("#rl-meta").textContent = [STATUS[r.status], `자리 ${RL.seats.length}/${r.max_seats}`, r.entry_fee ? `참가비 ${n(r.entry_fee)}칩` : "참가비 없음",
    r.pass_rule === "free" ? "넘기기 자유" : "넘기기: 나에게 쏘고 살아남은 뒤"].join(" · ");
  renderStatus(); renderRing(); renderCyl(); renderBar(); renderTools(); renderPool();
  aimGun(RL.target ?? r.turn_seat);

  const my = isMyTurn();
  if (my && !RL.wasMyTurn){ toast("내 차례입니다"); announce("내 차례입니다. 쏠 사람을 고르세요."); }
  RL.wasMyTurn = my;
}

function renderStatus(){
  const r = RL.room, el = $("#rl-status");
  const turn = r.turn_seat != null ? seatAt(r.turn_seat) : null;
  let html = "";
  if (r.status === "waiting") html = `<b>대기 중</b> — ${RL.seats.length < 2 ? "두 명 이상 앉으면" : "관리자가 시작하면"} 게임이 열립니다`;
  else if (r.status === "playing") html = isMyTurn()
    ? `<b class="mine">내 차례</b> — 쏠 사람을 고르세요 · ${r.round}번째 탄창`
    : `<b>${esc(turn ? seatChar(turn).name : "—")}</b>의 차례 · ${r.round}번째 탄창`;
  else if (r.status === "finished"){ const w = seatAt(r.winner_seat); html = `<b class="win">${esc(w ? seatChar(w).name : "—")} 우승</b>${r.pot ? ` · 판돈 ${n(r.pot)}칩` : ""}`; }
  else html = `<b>취소된 게임</b> — 참가비와 베팅은 돌려드렸습니다`;
  el.innerHTML = html;
}

/* 자리: 내 자리를 맨 아래에 두고 둥글게 */
function renderRing(){
  const r = RL.room, me = mySeat(), N = r.max_seats, base = me ? me.seat : 0;
  const my = isMyTurn(), admin = state.isAdmin && r.status === "waiting";
  const betBy = {}; RL.bets.forEach(b => { betBy[b.seat] = (betBy[b.seat] || 0) + b.amount; });
  $("#rl-ring").style.setProperty("--n", N);
  $("#rl-ring").innerHTML = Array.from({ length: N }, (_, i) => {
    const ang = 90 + (i - base) * 360 / N, rad = ang * Math.PI / 180;
    const x = 50 + 40 * Math.cos(rad), y = 48 + 33 * Math.sin(rad);
    const s = seatAt(i), pos = `left:${x.toFixed(2)}%;top:${y.toFixed(2)}%`;
    if (!s) return `<div class="rl-seat empty" style="${pos}" data-seat="${i}" data-ang="${ang}"><span class="av"></span><span class="nm">빈 자리</span></div>`;
    const c = seatChar(s), src = avatarOf(c), isMe = me && me.seat === i;
    const turn = r.status === "playing" && r.turn_seat === i, win = r.status === "finished" && r.winner_seat === i;
    const can = (my && s.alive) || (admin && !isMe);
    const label = `${c.name}${isMe ? " (나)" : ""}${!s.alive ? ", 탈락" : ""}${turn ? ", 지금 차례" : ""}${win ? ", 우승" : ""}${my && s.alive ? (i === me.seat ? " — 나에게 겨누기" : " — 이 사람에게 겨누기") : admin && !isMe ? " — 자리 비우기" : ""}`;
    return `<button type="button" class="rl-seat${s.alive ? "" : " dead"}${turn ? " turn" : ""}${isMe ? " me" : ""}${win ? " win" : ""}${RL.target === i ? " aimed" : ""}"
      style="${pos}" data-seat="${i}" data-ang="${ang}" ${can ? "" : `aria-disabled="true"`} aria-pressed="${RL.target === i}" aria-label="${esc(label)}">
      <span class="av">${src ? `<img src="${esc(src)}" alt="" decoding="async" draggable="false">` : `<span class="ph">${esc(c.name.slice(0, 1))}</span>`}<span class="x" aria-hidden="true"></span></span>
      <span class="nm">${c.role === "딜러" ? "" : `<span class="chip ${c.chip}" aria-hidden="true"></span>`}${esc(c.name)}${isMe ? `<small>나</small>` : ""}</span>
      ${betBy[i] ? `<span class="bet" aria-hidden="true">${n(betBy[i])}</span>` : ""}
    </button>`;
  }).join("");
}

/* 탄창 6칸: 쏜 칸은 비어 보임. 남은 칸 중 어디에 있는지는 아무도 모름 */
function renderCyl(){
  const r = RL.room, el = $("#rl-cyl");
  if (r.status !== "playing"){ el.innerHTML = ""; return; }
  el.innerHTML = Array.from({ length: 6 }, (_, i) => `<li class="${i < r.shots ? "used" : ""}" style="--i:${i}"></li>`).join("");
  el.setAttribute("aria-label", `탄창 6칸 중 ${r.shots}칸 쏨, 남은 칸 ${6 - r.shots}`);
}

function renderPool(){
  const total = RL.bets.reduce((s, b) => s + b.amount, 0), r = RL.room;
  $("#rl-pool").textContent = [r.pot ? `판돈 ${n(r.pot)}` : "", total ? `베팅 ${n(total)}` : ""].filter(Boolean).join(" · ");
}

/* 아래 버튼 */
function renderBar(){
  const r = RL.room, bar = $("#rl-bar"), me = mySeat(), chars = myChars();
  const keep = document.activeElement?.closest?.("#rl-bar")?.dataset?.act;   // 다시 그려도 포커스 유지
  let html = "";
  if (!state.session){
    html = `<p class="rl-note">구경 중입니다. 참여하려면 <a href="#login">로그인</a>해 주세요.</p>`;
  } else if (r.status === "waiting"){
    if (me) html = `<p class="rl-note">${esc(seatChar(me).name)}(으)로 앉았습니다. 시작을 기다리는 중…</p><button class="btn" type="button" data-act="leave">일어나기</button>`;
    else if (!chars.length) html = `<p class="rl-note">연결된 캐릭터가 없어 구경만 할 수 있습니다.</p>`;
    else html = `${chars.length > 1 ? `<label class="sr" for="rl-join-char">앉을 캐릭터</label><select class="input rl-sel" id="rl-join-char">${chars.map(c =>
      `<option value="${esc(c.uuid)}"${c.uuid === RL.myChar ? " selected" : ""}>${esc(c.name)} — ${n(c.balance)}칩</option>`).join("")}</select>` : ""}
      <button class="btn primary" type="button" data-act="join"${RL.seats.length >= r.max_seats ? " disabled" : ""}>${chars.length > 1 ? "" : esc(chars[0].name) + "(으)로 "}자리에 앉기</button>
      ${r.entry_fee ? `<p class="rl-note">참가비 ${n(r.entry_fee)}칩은 시작할 때 빠집니다.</p>` : ""}`;
  } else if (r.status === "playing"){
    const my = isMyTurn(), tg = RL.target != null ? seatAt(RL.target) : null;
    const canPass = my && (r.pass_rule === "free" || r.self_survived);
    const shootLabel = !my ? "쏘기" : tg && tg.seat === me.seat ? "나에게 쏘기" : `${esc(seatChar(tg).name)}에게 쏘기`;
    html = `
      <button class="btn rl-act shoot" type="button" data-act="shoot"${my ? "" : " disabled"}><span class="k" aria-hidden="true">⚡</span>${shootLabel}</button>
      <button class="btn rl-act" type="button" data-act="pass"${canPass ? "" : " disabled"} ${my && !canPass ? `title="나에게 한 번 쏘고 살아남아야 넘길 수 있습니다"` : ""}>넘기기</button>
      <button class="btn rl-act" type="button" data-act="bet"${betOpen() && chars.length ? "" : " disabled"}>베팅하기</button>
      <p class="rl-note">${my ? (r.self_survived ? "살았습니다! 한 번 더 쏘거나 넘길 수 있습니다." : "자리를 눌러 겨눌 사람을 바꿀 수 있습니다.") : me && !me.alive ? "탈락했습니다. 구경하며 채팅할 수 있습니다." : betOpen() ? "첫 탈락자가 나오기 전까지 베팅할 수 있습니다." : "베팅이 마감되었습니다."}</p>`;
  } else {
    const myBets = RL.bets.filter(b => mineUuids().has(b.character_id));
    const got = myBets.reduce((s, b) => s + (b.payout || 0), 0), put = myBets.reduce((s, b) => s + b.amount, 0);
    html = `<p class="rl-note">${r.status === "finished" ? "게임이 끝났습니다." : "취소된 게임입니다."}${put ? ` 내 베팅 ${n(put)}칩 → ${n(got)}칩` : ""}</p><a class="btn" href="#game">방 목록으로</a>`;
  }
  bar.innerHTML = html;
  if (keep) $(`[data-act="${keep}"]`, bar)?.focus();
}

/* 위쪽 도구: 자리 이미지 · 관리자 버튼 */
function renderTools(){
  const r = RL.room, a = state.isAdmin;
  const canAva = state.session && (myChars().length || (a && RL.seats.length));
  $("#rl-tools").innerHTML = [
    canAva ? `<button class="btn small" type="button" data-act="avatar">자리 이미지</button>` : "",
    a && r.status === "waiting" ? `<button class="btn small primary" type="button" data-act="start"${RL.seats.length < 2 ? " disabled" : ""}>게임 시작</button>` : "",
    a && r.status === "playing" ? `<button class="btn small" type="button" data-act="skip">차례 넘기기</button>` : "",
    a && (r.status === "waiting" || r.status === "playing") ? `<button class="btn small danger" type="button" data-act="cancel">게임 취소</button>` : "",
    a && (r.status === "finished" || r.status === "cancelled") ? `<button class="btn small danger" type="button" data-act="delete">방 지우기</button>` : ""
  ].join("");
}

/* ---------- 채팅 ---------- */
const hhmm = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
function chatLi(m){
  if (m.kind === "chat") return `<li class="c"><b>${esc(m.name)}</b><span>${esc(m.body)}</span><time datetime="${esc(m.created_at)}">${hhmm(m.created_at)}</time></li>`;
  if (m.kind === "shot") return `<li class="sh ${m.data?.live ? "live" : "blank"}">${m.data?.live ? `<span class="k" aria-hidden="true">⚡</span>` : ""}${esc(m.body)}</li>`;
  return `<li class="s">${esc(m.body)}</li>`;
}
function ingestChat(rows, animate){
  const fresh = rows.filter(m => m.id > RL.lastChat).sort((a, b) => a.id - b.id);
  if (!fresh.length) return;
  RL.lastChat = fresh.at(-1).id;
  const box = $("#rl-chat");
  const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  let ul = $("ul", box);
  if (!ul){ box.innerHTML = `<ul class="rl-log"></ul>`; ul = $("ul", box); }
  ul.insertAdjacentHTML("beforeend", fresh.map(chatLi).join(""));
  while (ul.children.length > 200) ul.firstElementChild.remove();
  if (atEnd || animate === false) box.scrollTop = box.scrollHeight;
  for (const m of fresh){
    if (m.kind !== "shot" || !m.data) continue;
    const key = `${m.data.round}:${m.data.shot_no}`;
    if (RL.fxSeen.has(key)) continue;
    RL.fxSeen.add(key);
    if (animate && Date.now() - Date.parse(m.created_at) < 10000) fx(m.data);
  }
}

$("#rl-say").addEventListener("submit", async e => {
  e.preventDefault();
  const inp = $("#rl-say-in"), body = inp.value.trim();
  if (!body || !RL.id) return;
  if (!state.session){ toast("채팅하려면 로그인해 주세요"); return; }
  inp.value = "";
  const { error } = await sb.rpc("roulette_say", { p_room: RL.id, p_body: body, p_character: RL.myChar });
  if (error){ inp.value = body; toast(errMsg(error)); return; }
  if (!RL.live) load(true);
});

/* =========================================================
   효과 — 총구를 돌리고, 맞으면 파란·분홍 번개
   ========================================================= */
function center(el, box){ const r = el.getBoundingClientRect(); return [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top]; }

function aimGun(seat){
  const el = seat != null && $(`#rl-ring [data-seat="${seat}"]`);
  const gun = $("#rl-gun");
  if (!el){ gun.style.setProperty("--aim", "-90deg"); return; }
  gun.style.setProperty("--aim", el.dataset.ang + "deg");
}

function bolt(x1, y1, x2, y2, jag){
  const len = Math.hypot(x2 - x1, y2 - y1), seg = Math.max(6, Math.round(len / 22));
  const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
  const pts = [[x1, y1]];
  for (let i = 1; i < seg; i++){
    const t = i / seg, off = (Math.random() - .5) * 2 * jag * Math.sin(Math.PI * t);
    pts.push([x1 + (x2 - x1) * t + nx * off, y1 + (y2 - y1) * t + ny * off]);
  }
  pts.push([x2, y2]);
  return pts;
}
const ptsAttr = p => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

function fx(d){
  const table = $("#rl-table"), svg = $("#rl-fx"), seat = $(`#rl-ring [data-seat="${d.target}"]`), gun = $("#rl-gun");
  if (!seat || nav.current !== "roulette") return;
  RL.fxUntil = Date.now() + (d.live ? 1100 : 900);
  aimGun(d.target);
  gun.classList.remove("kick"); void gun.offsetWidth; gun.classList.add("kick");
  const anim = motionOK();
  if (!d.live){
    seat.classList.remove("clack"); void seat.offsetWidth; seat.classList.add("clack");
    seat.dataset.say = "철컥";
    setTimeout(() => seat.classList.remove("clack"), 880);
    return;
  }
  const box = table.getBoundingClientRect();
  const [sx, sy] = center($(".rl-gun-svg", gun), box), [tx, ty] = center($(".av", seat), box);
  // 총구 끝에서 시작
  const ang = Math.atan2(ty - sy, tx - sx), tip = Math.min(48, box.width * .06);
  const ax = sx + Math.cos(ang) * tip, ay = sy + Math.sin(ang) * tip;
  svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
  const jag = Math.max(14, Math.hypot(tx - ax, ty - ay) * .1);
  const draw = () => {
    const main = bolt(ax, ay, tx, ty, jag);
    const k = 2 + Math.floor(Math.random() * 3), from = main[k], br = bolt(from[0], from[1], tx + (Math.random() - .5) * 120, ty + (Math.random() - .5) * 120, jag * .6);
    const k2 = main.length - 3, from2 = main[Math.max(1, k2)], br2 = bolt(from2[0], from2[1], tx + (Math.random() - .5) * 90, ty + (Math.random() - .5) * 90, jag * .5);
    svg.innerHTML = `
      <polyline class="b-glow-m" points="${ptsAttr(main)}"/><polyline class="b-glow-b" points="${ptsAttr(main)}"/>
      <polyline class="b-mag" points="${ptsAttr(br)}"/><polyline class="b-blue" points="${ptsAttr(br2)}"/>
      <polyline class="b-blue" points="${ptsAttr(main)}"/><polyline class="b-core" points="${ptsAttr(main)}"/>
      <circle class="b-hit" cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="${(28 + Math.random() * 14).toFixed(1)}"/>`;
  };
  table.classList.remove("rl-flash"); void table.offsetWidth; table.classList.add("rl-flash");
  seat.classList.add("zap");
  if (anim){
    draw();
    const iv = setInterval(draw, 55);
    setTimeout(() => { clearInterval(iv); svg.classList.add("fade"); }, 720);
    setTimeout(() => { svg.innerHTML = ""; svg.classList.remove("fade"); seat.classList.remove("zap"); table.classList.remove("rl-flash"); }, 1050);
  } else {
    draw();
    setTimeout(() => { svg.innerHTML = ""; seat.classList.remove("zap"); table.classList.remove("rl-flash"); }, 900);
  }
}

/* =========================================================
   조작
   ========================================================= */
async function call(fn, args, ok){
  const { data, error } = await sb.rpc(fn, args);
  if (error){ toast(missingTable(error) ? "supabase/update-8.sql을 먼저 실행해 주세요" : errMsg(error)); return null; }
  if (ok) toast(ok);
  return data ?? true;
}

$("#rl-ring").addEventListener("click", async e => {
  const b = e.target.closest("button.rl-seat");
  if (!b || b.getAttribute("aria-disabled") === "true") return;
  const i = +b.dataset.seat, r = RL.room;
  if (isMyTurn()){
    RL.target = i;
    $$("#rl-ring .rl-seat").forEach(x => { const on = +x.dataset.seat === i; x.classList.toggle("aimed", on); x.setAttribute("aria-pressed", on); });
    aimGun(i); renderBar();
    return;
  }
  if (state.isAdmin && r.status === "waiting"){
    const s = seatAt(i);
    if (s && confirm(`${seatChar(s).name}의 자리를 비울까요?`)) { await call("admin_roulette_kick", { p_room: RL.id, p_seat: i }); load(true); }
  }
});

async function act(btn){
  const a = btn.dataset.act, r = RL.room, id = RL.id;
  if (!r || btn.disabled) return;
  if (a === "bet") return openBet();
  if (a === "avatar") return openAvatar();
  if (a === "cancel" && !confirm("게임을 취소할까요? 참가비와 베팅은 모두 돌려줍니다.")) return;
  if (a === "delete" && !confirm("이 방을 지울까요? 채팅과 베팅 기록도 함께 지워집니다. (칩 기록과 전적은 남습니다)")) return;
  if (a === "start" && r.entry_fee && !confirm(`시작하면 자리마다 참가비 ${n(r.entry_fee)}칩을 걷습니다. 시작할까요?`)) return;
  await withBusy(btn, async () => {
    let res = null;
    if (a === "join"){
      const ch = $("#rl-join-char")?.value || myChars()[0]?.uuid;
      res = await call("roulette_join", { p_room: id, p_character: ch }, "자리에 앉았습니다");
      if (res !== null) RL.myChar = ch;
    }
    else if (a === "leave") res = await call("roulette_leave", { p_room: id }, "자리에서 일어났습니다");
    else if (a === "shoot"){
      const me = mySeat(), t = RL.target ?? me?.seat;
      res = await call("roulette_shoot", { p_room: id, p_target: t });
      if (res && typeof res === "object"){
        const key = `${res.round}:${res.shot_no}`;
        if (!RL.fxSeen.has(key)){ RL.fxSeen.add(key); fx(res); }   // 실시간이 늦어도 내 화면은 바로
      }
    }
    else if (a === "pass") res = await call("roulette_pass", { p_room: id });
    else if (a === "start") res = await call("admin_roulette_start", { p_room: id }, "게임을 시작했습니다");
    else if (a === "skip") res = await call("admin_roulette_skip", { p_room: id });
    else if (a === "cancel") res = await call("admin_roulette_cancel", { p_room: id }, "게임을 취소했습니다");
    else if (a === "delete"){
      const { error } = await sb.from("roulette_rooms").delete().eq("id", id);
      if (error){ toast(errMsg(error)); return; }
      toast("방을 지웠습니다"); location.hash = "#game"; return;
    }
    if (res !== null) await load(true);
  });
}
$("#rl-bar").addEventListener("click", e => { const b = e.target.closest("[data-act]"); if (b) act(b); });
$("#rl-tools").addEventListener("click", e => { const b = e.target.closest("[data-act]"); if (b) act(b); });
$("#rl-bar").addEventListener("change", e => { if (e.target.id === "rl-join-char") RL.myChar = e.target.value; });

/* ---------- 베팅 ---------- */
function betEstimate(){
  const seat = +($('input[name="rl-bet-seat"]:checked')?.value ?? -1), amt = parseInt($("#rl-bet-amt").value, 10) || 0;
  const total = RL.bets.reduce((s, b) => s + b.amount, 0), on = RL.bets.filter(b => b.seat === seat).reduce((s, b) => s + b.amount, 0);
  const c = myChars().find(x => x.uuid === $("#rl-bet-char").value);
  $("#rl-bet-est").textContent = seat < 0 || amt < 1 ? "" :
    `지금 그대로 끝나면 맞혔을 때 약 ${n(Math.floor(amt * (total + amt) / (on + amt)))}칩을 받습니다.${c ? ` (보유 ${n(c.balance)}칩)` : ""}`;
}
function openBet(){
  if (!betOpen()){ toast("베팅이 마감되었습니다"); return; }
  const chars = myChars(), total = RL.bets.reduce((s, b) => s + b.amount, 0);
  showMsg($("#rl-bet-err"), "");
  $("#rl-bet-seats").innerHTML = RL.seats.filter(s => s.alive).map((s, k) => {
    const on = RL.bets.filter(b => b.seat === s.seat).reduce((x, b) => x + b.amount, 0);
    return `<label class="check"><input type="radio" name="rl-bet-seat" value="${s.seat}"${k === 0 ? " checked" : ""}>${esc(seatChar(s).name)} <span class="hint" style="display:inline; margin:0">— ${n(on)}칩 걸림${total ? ` (${Math.round(on / total * 100)}%)` : ""}</span></label>`;
  }).join("");
  $("#rl-bet-char").innerHTML = chars.map(c => `<option value="${esc(c.uuid)}"${c.uuid === RL.myChar ? " selected" : ""}>${esc(c.name)} — ${n(c.balance)}칩</option>`).join("");
  betEstimate();
  $("#rl-bet-dlg").showModal();
}
$("#rl-bet-form").addEventListener("input", betEstimate);
$("#rl-bet-form").addEventListener("submit", async e => {
  e.preventDefault();
  const seat = $('input[name="rl-bet-seat"]:checked'), amt = parseInt($("#rl-bet-amt").value, 10);
  if (!seat){ showMsg($("#rl-bet-err"), "걸 사람을 골라 주세요."); return; }
  if (!(amt >= 1)){ showMsg($("#rl-bet-err"), "1칩 이상 걸어 주세요."); $("#rl-bet-amt").focus(); return; }
  await withBusy($('button[type="submit"]', e.target), async () => {
    const { error } = await sb.rpc("roulette_bet", { p_room: RL.id, p_seat: +seat.value, p_character: $("#rl-bet-char").value, p_amount: amt });
    if (error){ showMsg($("#rl-bet-err"), errMsg(error)); return; }
    $("#rl-bet-dlg").close();
    toast(`${n(amt)}칩을 걸었습니다`);
    load(true);
  });
});

/* ---------- 자리 이미지 ---------- */
let avaFile = null;
function avaChoices(){
  const mine = myChars().map(c => ({ uuid: c.uuid, name: c.name }));
  if (state.isAdmin) RL.seats.forEach(s => { if (!mine.some(m => m.uuid === s.character_id)) mine.push({ uuid: s.character_id, name: seatChar(s).name }); });
  return mine;
}
function avaPreview(){
  const c = charOf($("#rl-ava-char").value), src = avaFile ? URL.createObjectURL(avaFile) : avatarOf(c);
  $("#rl-ava-prev").innerHTML = src ? `<img src="${esc(src)}" alt="">` : `<span aria-hidden="true">없음</span>`;
  $("#rl-ava-del").disabled = !RL.avatars.get(c.uuid);
}
function openAvatar(){
  const list = avaChoices();
  if (!list.length) return;
  avaFile = null; $("#rl-ava-file").value = ""; showMsg($("#rl-ava-err"), "");
  const pick = list.find(c => c.uuid === RL.myChar) || list[0];
  $("#rl-ava-char").innerHTML = list.map(c => `<option value="${esc(c.uuid)}"${c.uuid === pick.uuid ? " selected" : ""}>${esc(c.name)}</option>`).join("");
  avaPreview();
  $("#rl-ava-dlg").showModal();
}
$("#rl-ava-char").addEventListener("change", () => { avaFile = null; $("#rl-ava-file").value = ""; avaPreview(); });
$("#rl-ava-file").addEventListener("change", e => {
  const f = e.target.files[0];
  if (f && !/^image\//.test(f.type)){ showMsg($("#rl-ava-err"), "이미지 파일만 올릴 수 있습니다."); e.target.value = ""; return; }
  showMsg($("#rl-ava-err"), ""); avaFile = f || null; avaPreview();
});
$("#rl-ava-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (!avaFile){ showMsg($("#rl-ava-err"), "새 이미지를 골라 주세요."); return; }
  const cid = $("#rl-ava-char").value, old = RL.avatars.get(cid)?.path;
  await withBusy($('button[type="submit"]', e.target), async () => {
    try {
      const { toWebP, extOf } = await import("./img.js?v=20261024b");
      const blob = await toWebP(avaFile, 512), path = `${cid}/${Date.now()}.${extOf(blob)}`;
      const up = await sb.storage.from("roulette").upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
      if (up.error) throw up.error;
      const { error } = await sb.rpc("roulette_set_avatar", { p_character: cid, p_path: path });
      if (error){ sb.storage.from("roulette").remove([path]); throw error; }
      if (old) sb.storage.from("roulette").remove([old]);   // 이전 파일 정리 (실패해도 무시)
      $("#rl-ava-dlg").close(); toast("자리 이미지를 바꿨습니다"); load(true);
    } catch (err){ showMsg($("#rl-ava-err"), errMsg(err)); }
  });
});
$("#rl-ava-del").addEventListener("click", async e => {
  const cid = $("#rl-ava-char").value, old = RL.avatars.get(cid)?.path;
  if (!old) return;
  await withBusy(e.currentTarget, async () => {
    const { error } = await sb.rpc("roulette_set_avatar", { p_character: cid, p_path: null });
    if (error){ showMsg($("#rl-ava-err"), errMsg(error)); return; }
    sb.storage.from("roulette").remove([old]);
    $("#rl-ava-dlg").close(); toast("기본 이미지로 바꿨습니다"); load(true);
  });
});

/* 로그인·로그아웃, 칩 변화, 창 크기 */
document.addEventListener("comu:auth", () => { if (nav.current === "roulette" && RL.room) render(); if (nav.current === "game") loadLobby(); });
addEventListener("resize", () => { if (nav.current === "roulette" && RL.room) aimGun(RL.target ?? RL.room.turn_seat); });
