/* =========================================================
   러시안 룰렛 (supabase/update-8.sql)
   - 게임 화면: 방 목록(로비). 방은 관리자만 엶
   - #roulette/방ID: 둥근 테이블에 자리, 가운데 전기 충격기, 오른쪽 채팅, 아래 쏘기·넘기기·베팅하기
   - 탄 위치는 서버만 앎. 화면은 서버가 돌려준 결과(채팅의 'shot' 기록)를 보고 효과만 그림
   - 실시간 연결이 끊겨도 5초마다 다시 불러와 따라감
   ========================================================= */
import { CURRENCY, USE_DB, publicUrl, sb } from "./data.js?v=20261031c";
import { $, $$, CUR, announce, chipAmt, curOf, esc, setTitle, toast } from "./dom.js?v=20261031c";
import { errMsg, showMsg, withBusy } from "./forms.js?v=20261031c";
import { motionOK, nav, state } from "./state.js?v=20261031c";
import { ALL, balOf, myChars } from "./views.js?v=20261031c";
import { sfx, setSfxVol } from "./sfx.js?v=20261031c";
import { hotkeys, kbd, toolsFrame, toolsMenu } from "./gametools.js?v=20261031c";

/* ---------- 전기 충격기 (도트 그림) — 오른쪽을 향함, 한 칸 = 1 ---------- */
const GUN = ["........................................", "....KKKKKKKKKKKKKKKKKKKKKKKKK...........", "...KSSSSSSSSSSSSSSSSSSSSSSSSSK..........", "..KLLLLLLLLLLLLLLLLLLLLLLLLLLLKKKKKKKK..", "..KLBBYYBYYBYYBBBBBBBBBBBBBBBKPPPPPPPK..", "..KLBBBBBBBBBBBBBBBBBBBBBBBBBKPQQQQQPKWW", "..KDBBBBBBBBBBBBBBBBBBBBBBBBBKPPPPPPPK..", "..KDDDDDDDDDDDDDDDDDDDDDDDDDDKPQQQQQPKWW", "..KKKKKKDDDDDDDKKKKKKKKKKKKKKKPPPPPPPK..", ".......KGGGGGKDK....K.......KKKKKKKKK...", "......KGgGGGKKDK...K....................", "......KGGGGGK.KMK..K....................", ".....KGgGGGK...KMKK.....................", ".....KGGGGGK....KK......................", "....KGgGGGK.............................", "....KGGGGGK.............................", "....KKKKKKK............................."];
const GUN_COL = { K: "#05081A", S: "#ADCFEA", L: "#3B63C4", B: "#1D367B", D: "#0E1B45", P: "#EF1A72", Q: "#8F0D45", Y: "#7FD4FF", W: "#EEF3FA", G: "#0B1233", g: "#1A2550", M: "#5A6788" };
(function drawGun(){
  let rects = "";
  GUN.forEach((row, y) => { let x = 0; while (x < row.length){ const c = row[x]; let w = 1; while (row[x + w] === c) w++; if (c !== "."){ rects += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${GUN_COL[c]}"${c === "Y" ? ` class="g-led"` : c === "W" ? ` class="g-prong"` : ""}/>`; } x += w; } });
  $("#rl-lobby-gun").innerHTML = `<svg viewBox="0 0 42 18" shape-rendering="crispEdges">${rects}</svg>`;   // 게임 목록의 룰렛 표시
  $("#rl-gun").innerHTML = `<svg class="rl-gun-svg" viewBox="-2 -4 46 26" shape-rendering="crispEdges">${rects}
    <polyline class="g-arc" points="40,5.5 41.2,6.2 40.4,6.6 41.4,7.4" shape-rendering="auto"/>
    <polyline class="g-arc g-arc2" points="40,5.5 40.6,6.4 41.6,6.8 40.2,7.5" shape-rendering="auto"/></svg>`;
})();

const RL = {
  id: null, room: null, seats: [], bets: [], chat: [], avatars: new Map(),
  chan: null, live: false, poll: 0, reloadT: 0, loading: null,
  target: null, myChar: null, autoDummy: false, autoT: 0, fxSeen: new Set(), lastChat: 0, wasMyTurn: false, missing: false,
  fxUntil: 0, renderT: 0, actedAt: 0, skew: 0, tickT: 0, timeoutTry: 0
};
const LOBBY = { chan: null, t: 0 };
const DUMMY = { ok: true };
const TURN = { ok: true }, TURN_SEC = 60;   // 차례 시간 제한 (update-10.sql 없으면 꺼짐)   // roulette_seats.dummy_name (update-9.sql)
const n = v => Number(v || 0).toLocaleString("ko-KR");
const STATUS = { waiting: "대기 중", playing: "진행 중", finished: "끝남", cancelled: "취소됨" };
const missingTable = e => /42P01|PGRST205|PGRST202|roulette_/.test(`${e?.code} ${e?.message}`);
const NEED_SQL = `<p class="form-note">러시안 룰렛이 아직 준비되지 않았습니다. (관리자: Supabase에서 <strong>supabase/update-8.sql</strong> 실행 필요)</p>`;

/* 캐릭터 정보 (공개 데이터) */
const charOf = uuid => ALL().find(c => c.uuid === uuid) || { uuid, name: "(알 수 없음)", role: "", chip: "green" };
// 더미 자리 (update-9.sql): 캐릭터 없이 이름만. 차례가 오면 관리자가 대신 진행
const seatChar = s => s.character_id ? charOf(s.character_id) : { uuid: null, name: s.dummy_name || "더미", role: "더미", chip: "green", dummy: true };
const avatarOf = c => {
  const a = RL.avatars.get(c.uuid);
  return a ? publicUrl("roulette", a.path) : (c.thumb || c.img || "");
};
const mineUuids = () => new Set(state.mine.map(m => m.uuid));
const mySeat = () => { const mine = mineUuids(); return RL.seats.find(s => mine.has(s.character_id)) || null; };
const seatAt = i => RL.seats.find(s => s.seat === i) || null;
/* 지금 내가 움직일 수 있는 자리: 내 캐릭터 차례, 또는 (관리자) 더미 차례 */
const ctlSeat = () => {
  const r = RL.room; if (!r || r.status !== "playing") return null;
  const s = seatAt(r.turn_seat); if (!s || !s.alive) return null;
  return (s.character_id ? mineUuids().has(s.character_id) : state.isAdmin) ? s : null;
};
const canAct = () => !!ctlSeat();
const isMyTurn = () => { const r = RL.room, me = mySeat(); return !!(r && me && r.status === "playing" && r.turn_seat === me.seat && me.alive); };
// '나에게 쏜 뒤' 방: 차례의 첫 발은 나에게만
const selfFirst = () => { const r = RL.room; return !!(r && r.status === "playing" && r.pass_rule !== "free" && !r.self_survived); };
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
    .select(`id, title, status, max_seats, entry_fee, pot, created_at, roulette_seats(count)${CURRENCY.ok ? ", currency" : ""}`)
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
      <span class="m"><span class="st">${STATUS[r.status]}</span> · 자리 ${cnt}/${r.max_seats}${r.entry_fee ? ` · 참가비 ${chipAmt(r.entry_fee, r.currency)}` : ` · ${CUR[curOf(r.currency)].name}`}${r.status === "playing" && r.pot ? ` · 판돈 ${chipAmt(r.pot, r.currency)}` : ""}</span>
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
      p_pass_rule: $('input[name="rl-pass"]:checked').value,
      ...(CURRENCY.ok ? { p_currency: $('input[name="rl-cur"]:checked').value } : {})
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
  clearInterval(RL.tickT); RL.tickT = 0;
  RL.id = null;
}

async function openRoom(id){
  if (RL.id !== id){
    closeRoom();
    let auto = false; try { auto = sessionStorage.getItem("rl-auto:" + id) === "1"; } catch (_) {}   // 더미 자동 진행은 새로 고침해도 유지
    Object.assign(RL, { id, timeoutTry: 0, autoDummy: auto, room: null, seats: [], bets: [], chat: [], avatars: new Map(), target: null, fxSeen: new Set(), lastChat: 0, wasMyTurn: false });
    $("#rl-chat").innerHTML = ""; $("#rl-ring").innerHTML = ""; $("#rl-bar").innerHTML = ""; $("#rl-tools").innerHTML = "";
    $("#rl-status").textContent = "불러오는 중…"; $("#rl-meta").textContent = "";
  }
  await load(false);
  if (RL.id !== id || !RL.room) return;
  subscribe(id);
  RL.poll = setInterval(() => { if (!RL.live && !document.hidden) load(true); }, 5000);
  RL.tickT = setInterval(tick, 1000);
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
      sb.from("roulette_rooms").select(`id, title, status, max_seats, entry_fee, pass_rule, pot, turn_seat, shots, round, self_survived, winner_seat, started_at, ended_at, last_action_at${CURRENCY.ok ? ", currency" : ""}`).eq("id", id).maybeSingle(),
      sb.from("roulette_seats").select(`seat, character_id, alive, out_at${DUMMY.ok ? ", dummy_name" : ""}`).eq("room_id", id).order("seat"),
      sb.from("roulette_bets").select("id, seat, character_id, amount, payout").eq("room_id", id),
      sb.from("roulette_chat").select("id, name, body, kind, data, created_at").eq("room_id", id).gt("id", RL.lastChat).order("id", { ascending: false }).limit(120)
    ]);
    if (RL.id !== id) return;
    if (DUMMY.ok && s.error && /dummy_name/.test(s.error.message || "")){ DUMMY.ok = false; RL.loading = null; return load(quiet); }
    const err = [r, s, b, c].find(x => x.error)?.error;
    if (err){
      if (!quiet || missingTable(err)) roomError(missingTable(err) ? NEED_SQL : `<p class="form-error" role="alert">${esc(errMsg(err))}</p>`);
      return;
    }
    if (!r.data){ roomError(`<p class="empty-note">없는 방입니다. 지워졌을 수 있습니다.</p><p style="text-align:center"><a class="btn" href="#game">방 목록으로</a></p>`); return; }
    // 내 시계와 서버 시계 차이: 행동 직후 바로 받은 경우에만 잼 (실시간 연결 또는 내가 방금 한 행동)
    const prev = RL.room?.last_action_at, nowAct = r.data.last_action_at;
    if (prev && nowAct && prev !== nowAct && (RL.live || Date.now() - RL.actedAt < 3000)){
      const d = Date.now() - Date.parse(nowAct);
      if (Math.abs(d) < 300000) RL.skew = d;
    }
    RL.room = r.data; RL.seats = s.data || []; RL.bets = b.data || [];
    const ids = RL.seats.map(x => x.character_id).filter(Boolean).concat(myChars().map(x => x.uuid));
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
  // 움직일 차례가 아니면 겨냥 초기화, 내 차례(또는 관리자의 더미 차례)면 기본은 그 자리 자신
  const ctl = ctlSeat();
  if (!ctl){ RL.target = null; RL.ctlSeat = null; }
  else if (RL.ctlSeat !== ctl.seat || RL.target == null || !seatAt(RL.target)?.alive || selfFirst()){ RL.target = ctl.seat; RL.ctlSeat = ctl.seat; }

  const t = $("#rl-title");
  if (t.textContent !== r.title) t.textContent = r.title;
  setTitle(r.title);
  $("#rl-meta").innerHTML = "";
  $("#rl-table").classList.toggle("playing", r.status === "playing");
  renderFelt();
  renderStatus(); renderRing(); renderCyl(); renderBar(); renderTools(); renderPool(); tick();
  aimGun(RL.target ?? r.turn_seat);

  const my = isMyTurn();
  if (my && !RL.wasMyTurn){ toast("내 차례입니다"); announce("내 차례입니다. 쏠 사람을 고르세요."); sfx("turn"); }
  RL.wasMyTurn = my;
  autoDummy();
}

/* 더미 자동 진행 (관리자 화면에서 켰을 때만): 1.4초 뒤 나에게 쏘거나(60%) 다른 사람에게, 살았으면 가끔 넘김 */
function autoDummy(){
  clearTimeout(RL.autoT);
  const ctl = ctlSeat();
  if (!RL.autoDummy || !ctl || ctl.character_id) return;
  RL.autoT = setTimeout(async () => {
    const now = ctlSeat(); if (!now || now.seat !== ctl.seat || now.character_id) return;
    const r = RL.room;
    if (r.self_survived && Math.random() < .35){ await call("roulette_pass", { p_room: RL.id }); load(true); return; }
    const others = RL.seats.filter(x => x.alive && x.seat !== ctl.seat);
    const t = selfFirst() || Math.random() < .6 || !others.length ? ctl.seat : others[Math.floor(Math.random() * others.length)].seat;
    const res = await call("roulette_shoot", { p_room: RL.id, p_target: t });
    if (res && typeof res === "object"){ const key = `${res.round}:${res.shot_no}`; if (!RL.fxSeen.has(key)){ RL.fxSeen.add(key); fx(res); } }
    load(true);
  }, 1400);
}

function renderStatus(){
  const r = RL.room, el = $("#rl-status");
  const turn = r.turn_seat != null ? seatAt(r.turn_seat) : null;
  let html = "";
  if (r.status === "waiting") html = `<b>대기 중</b>`;
  else if (r.status === "playing") html = canAct() && !ctlSeat().character_id ? `<b class="mine">${esc(seatChar(turn).name)} 차례</b>`
    : isMyTurn() ? `<b class="mine">내 차례</b>` : "";   // 남의 차례는 자리의 시간 고리로 충분
  else if (r.status === "finished"){ const w = seatAt(r.winner_seat); html = `<b class="win">${esc(w ? seatChar(w).name : "—")} 우승</b>${r.pot ? ` · 판돈 ${chipAmt(r.pot, r.currency)}` : ""}`; }
  else html = `<b>취소됨</b>`;
  el.innerHTML = html;
  el.classList.toggle("blank", !html);
}

/* 자리: 내 자리를 맨 아래에 두고 둥글게 */
function renderRing(){
  const r = RL.room, me = mySeat(), N = r.max_seats, base = me ? me.seat : 0;
  const my = canAct(), ctl = ctlSeat(), admin = state.isAdmin && r.status === "waiting";
  const joinAt = state.session && r.status === "waiting" && !me && myChars().length ? Array.from({ length: N }, (_, i) => i).find(i => !seatAt(i)) ?? -1 : -1;   // 앉으면 들어갈 자리
  const betBy = {}; RL.bets.forEach(b => { betBy[b.seat] = (betBy[b.seat] || 0) + b.amount; });
  $("#rl-ring").style.setProperty("--n", N);
  // 자리와 자리 사이의 작은 화살표: 차례가 도는 방향(시계 방향)을 늘 보여 줌
  const nextSeat = r.status === "playing" && r.turn_seat != null ? nextAlive(r.turn_seat) : null;
  const arrows = RL.seats.length > 1 ? Array.from({ length: N }, (_, i) => {
    const ang = 90 + (i + .5 - base) * 360 / N, rad = ang * Math.PI / 180;
    return `<span class="rl-dir" style="left:${(50 + 37 * Math.cos(rad)).toFixed(2)}%;top:${(48 + 30 * Math.sin(rad)).toFixed(2)}%;--r:${(ang + 90).toFixed(1)}deg" aria-hidden="true"></span>`;
  }).join("") : "";
  $("#rl-ring").innerHTML = arrows + Array.from({ length: N }, (_, i) => {
    const ang = 90 + (i - base) * 360 / N, rad = ang * Math.PI / 180;
    const x = 50 + 40 * Math.cos(rad), y = 48 + 33 * Math.sin(rad);
    const s = seatAt(i), pos = `left:${x.toFixed(2)}%;top:${y.toFixed(2)}%`, up = y < 40 ? " up" : "";   // 위쪽 자리는 이름을 머리 위로 (가운데 총과 겹치지 않게)
    if (!s) return i === joinAt
      ? `<button type="button" class="rl-seat empty join${up}" style="${pos}" data-act="join" data-seat="${i}" data-ang="${ang}" aria-label="이 자리에 앉기"><span class="av"><span class="plus" aria-hidden="true"></span></span><span class="nm">앉기</span></button>`
      : `<div class="rl-seat empty${up}" style="${pos}" data-seat="${i}" data-ang="${ang}" aria-label="빈 자리"><span class="av"></span></div>`;
    const c = seatChar(s), src = avatarOf(c), isMe = me && me.seat === i;
    const turn = r.status === "playing" && r.turn_seat === i, win = r.status === "finished" && r.winner_seat === i;
    const can = (my && s.alive && (!selfFirst() || i === ctl.seat)) || (admin && !isMe);
    const label = `${c.name}${c.dummy ? " (더미)" : ""}${isMe ? " (나)" : ""}${!s.alive ? ", 탈락" : ""}${turn ? ", 지금 차례" : ""}${win ? ", 우승" : ""}${my && s.alive ? (i === ctl.seat ? " — 자기 자신에게 겨누기" : selfFirst() ? "" : " — 이 자리에 겨누기") : admin && !isMe ? " — 자리 비우기" : ""}`;
    return `<button type="button" class="rl-seat${up}${c.dummy ? " dummy" : ""}${s.alive ? "" : " dead"}${turn ? " turn" : ""}${isMe ? " me" : ""}${win ? " win" : ""}${RL.target === i ? " aimed" : ""}"
      style="${pos}" data-seat="${i}" data-ang="${ang}" ${can ? "" : `aria-disabled="true"`} aria-pressed="${RL.target === i}" aria-label="${esc(label)}">
      <span class="av">${src ? `<img src="${esc(src)}" alt="" decoding="async" draggable="false">` : `<span class="ph">${esc(c.name.slice(0, 1))}</span>`}<span class="x" aria-hidden="true"></span>${turn && TURN.ok ? `<span class="tm" aria-hidden="true"></span>` : ""}</span>
      <span class="nm">${c.role === "직원" ? "" : `<span class="chip ${c.chip}" aria-hidden="true"></span>`}${esc(c.name)}${isMe ? `<small>나</small>` : ""}</span>
      ${betBy[i] ? `<span class="bet" aria-hidden="true">${n(betBy[i])}</span>` : ""}
      ${nextSeat === i && nextSeat !== r.turn_seat ? `<span class="nx" aria-hidden="true">다음</span>` : ""}
    </button>`;
  }).join("");
}

/* 다음 차례가 될 자리 (서버 rl_next_seat 와 같은 규칙: 자리 번호가 커지는 쪽 = 시계 방향) */
function nextAlive(from){
  const alive = RL.seats.filter(s => s.alive).map(s => s.seat).sort((a, b) => a - b);
  return alive.find(x => x > from) ?? alive[0] ?? null;
}

/* ---------- 차례 60초 제한 (update-10.sql) ----------
   서버가 마지막 행동 시각을 기준으로 판단. 화면은 1초마다 남은 시간만 고쳐 그림.
   시간이 다 되면 보고 있던 사람 아무나 roulette_timeout 을 불러 다음 차례로 넘김 (서버가 60초를 다시 확인) */
function leftSec(){
  const r = RL.room;
  if (!r || r.status !== "playing" || !r.last_action_at) return null;
  return Math.max(0, Math.ceil(TURN_SEC - (Date.now() - RL.skew - Date.parse(r.last_action_at)) / 1000));
}
function tick(){
  const left = leftSec(), on = left != null && TURN.ok;
  const lab = $("#rl-left"), tm = $("#rl-ring .rl-seat.turn .tm");
  if (lab) { lab.textContent = on ? `${left}초` : ""; lab.classList.toggle("low", on && left <= 10); }
  if (tm) { tm.textContent = on ? left : ""; tm.classList.toggle("low", on && left <= 10); tm.parentElement.style.setProperty("--p", on ? (left / TURN_SEC).toFixed(3) : 1); }
  if (on && left === 0 && state.session && Date.now() > RL.timeoutTry && !(RL.fxUntil > Date.now())){
    RL.timeoutTry = Date.now() + 4000;
    sb.rpc("roulette_timeout", { p_room: RL.id }).then(({ data, error }) => {
      if (error){ if (/PGRST202|roulette_timeout/.test(`${error.code} ${error.message}`)) { TURN.ok = false; render(); } return; }
      if (data) load(true);
    });
  }
}

/* 탄창 6칸: 쏜 칸은 비어 보임. 남은 칸 중 어디에 있는지는 아무도 모름 */
function renderCyl(){
  const r = RL.room, el = $("#rl-cyl"), n = $("#rl-cyl-n");
  $("#rl-mag").hidden = r.status !== "playing";
  if (r.status !== "playing"){ el.innerHTML = ""; n.textContent = ""; return; }
  // 6칸 원형 탄창: 쏜 칸은 빈 구멍, 다음에 쏠 칸은 테두리 강조
  el.innerHTML = Array.from({ length: 6 }, (_, i) => `<li class="${i < r.shots ? "used" : ""}${i === r.shots ? " next" : ""}" style="--i:${i}"></li>`).join("");
  n.innerHTML = `<b>${6 - r.shots}</b>/6`;   // 남은 칸 수
  n.setAttribute("aria-label", `6칸 중 ${6 - r.shots}칸 남음`);
}

function renderPool(){
  const total = RL.bets.reduce((s, b) => s + b.amount, 0), r = RL.room;
  $("#rl-pool").innerHTML = [r.pot ? `판돈 ${chipAmt(r.pot, r.currency)}` : "", total ? `베팅 ${chipAmt(total, r.currency)}` : ""].filter(Boolean).join(" · ");
}

/* 아래 버튼 */
function renderBar(){
  const r = RL.room, bar = $("#rl-bar"), me = mySeat(), chars = myChars();
  const keep = document.activeElement?.closest?.("#rl-bar")?.dataset?.act;   // 다시 그려도 포커스 유지
  let html = "";
  if (!state.session){
    html = `<a class="btn" href="#login">로그인</a>`;
  } else if (r.status === "waiting"){
    if (me) html = `<button class="btn" type="button" data-act="leave">일어나기</button>`;
    else if (!chars.length) html = "";
    else html = `${chars.length > 1 ? `<label class="sr" for="rl-join-char">앉을 캐릭터</label><select class="input rl-sel" id="rl-join-char">${chars.map(c =>
      `<option value="${esc(c.uuid)}"${c.uuid === RL.myChar ? " selected" : ""}>${esc(c.name)} — ${CUR[curOf(r.currency)].short} ${n(balOf(c, r.currency))}</option>`).join("")}</select>` : ""}
      <button class="btn primary rl-act" type="button" data-act="join"${RL.seats.length >= r.max_seats ? " disabled" : ""}>앉기${chars.length === 1 ? `<small>${esc(chars[0].name)}</small>` : ""}</button>
`;
  } else if (r.status === "playing"){
    const ctl = ctlSeat(), my = !!ctl, dummyTurn = my && !ctl.character_id, tg = RL.target != null ? seatAt(RL.target) : null;
    const canPass = my && (r.pass_rule === "free" || r.self_survived);
    const shootLabel = !my ? "쏘기" : tg && tg.seat === ctl.seat ? (dummyTurn ? `${esc(seatChar(ctl).name)} 자신에게 쏘기` : "나에게 쏘기") : `${esc(seatChar(tg).name)}에게 쏘기`;
    html = `
      <button class="btn rl-act shoot" type="button" data-act="shoot" data-key="f"${my ? "" : " disabled"}><span class="k" aria-hidden="true">⚡</span>${shootLabel}${kbd("f")}</button>
      <button class="btn rl-act" type="button" data-act="pass" data-key="p"${canPass ? "" : " disabled"} ${my && !canPass ? `title="나에게 한 번 쏘고 살아남아야 넘길 수 있습니다"` : ""}>${my && !canPass ? `<span class="lock" aria-hidden="true"></span>` : ""}넘기기${kbd("p")}</button>
      <button class="btn rl-act" type="button" data-act="bet" data-key="b"${betOpen() && chars.length ? "" : " disabled"}>베팅${kbd("b")}</button>
`;
  } else {
    const myBets = RL.bets.filter(b => mineUuids().has(b.character_id));
    const got = myBets.reduce((s, b) => s + (b.payout || 0), 0), put = myBets.reduce((s, b) => s + b.amount, 0);
    html = `${put ? `<p class="rl-note bet-res">${chipAmt(put, r.currency)} → ${chipAmt(got, r.currency)}</p>` : ""}<a class="btn" href="#game">방 목록으로</a>`;
  }
  // 방장: 시작은 아래 버튼 줄에 (나머지는 메뉴)
  // 자리가 다 차면 불이 들어옴 (2명 이상이면 누를 수는 있음)
  if (state.isAdmin && r.status === "waiting") html += `<button class="btn rl-act ${RL.seats.length >= r.max_seats ? "shoot" : "host"}" type="button" data-act="start" data-key="n"${RL.seats.length < 2 ? " disabled" : ""}>게임 시작${kbd("n")}</button>`;
  bar.innerHTML = html;
  if (keep) $(`[data-act="${keep}"]`, bar)?.focus();
}

/* 위쪽 도구: 자리 이미지 · 관리자 버튼 */
function renderTools(){
  const r = RL.room, a = state.isAdmin;
  const canAva = state.session && (myChars().length || (a && RL.seats.length));
  const tools = $("#rl-tools");
  toolsFrame(tools, "rl-vol");
  toolsMenu(tools, [
    canAva ? `<button type="button" role="menuitem" data-act="avatar">자리 이미지</button>` : "",
    a && DUMMY.ok && r.status === "waiting" ? `<button type="button" role="menuitem" data-act="dummy"${RL.seats.length >= r.max_seats ? " disabled" : ""}>더미 앉히기</button>` : "",
    a && r.status === "playing" && RL.seats.some(s => !s.character_id) ? `<button type="button" role="menuitemcheckbox" data-act="auto" aria-checked="${RL.autoDummy}">더미 자동 진행</button>` : "",
    a && r.status === "playing" ? `<button type="button" role="menuitem" data-act="skip">차례 넘기기</button>` : "",
    a && (r.status === "waiting" || r.status === "playing") ? `<button type="button" role="menuitem" class="danger" data-act="cancel">게임 취소</button>` : "",
    a && (r.status === "finished" || r.status === "cancelled") ? `<button type="button" role="menuitem" class="danger" data-act="delete">방 지우기</button>` : ""
  ].join(""));
}

/* 테이블 바닥에 새긴 규칙 (설명 문구 대신) */
function renderFelt(){
  const r = RL.room, c = curOf(r.currency), el = $("#rl-felt");
  const h = `${c}|${r.entry_fee}|${r.pass_rule}`;
  if (el.dataset.h === h) return;
  el.dataset.h = h;
  el.innerHTML = `<span class="cur amt-${c}"><i class="chip ${CUR[c].chip}" aria-hidden="true"></i>${CUR[c].name}${r.entry_fee ? `<i>·</i>참가비 ${n(r.entry_fee)}` : ""}</span>
    <span class="rule">${r.pass_rule === "free" ? "넘기기 자유" : "나에게 쏜 뒤 넘기기"}</span>`;
  el.setAttribute("aria-label", `${CUR[c].name}${r.entry_fee ? `, 참가비 ${r.entry_fee}` : ""}, ${r.pass_rule === "free" ? "넘기기 자유" : "나에게 한 번 쏘고 살아남아야 넘길 수 있음"}`);
}

/* ---------- 채팅 ---------- */
// 채팅 얼굴: 말한 캐릭터 (update-18 뒤엔 data.char, 그 전 채팅은 이름으로 찾음)
function chatFace(m){
  const c = (m.data?.char && ALL().find(x => x.uuid === m.data.char)) || ALL().find(x => x.name === m.name);
  const src = c ? avatarOf(c) : "";
  return `<span class="cf" aria-hidden="true">${src ? `<img src="${esc(src)}" alt="" decoding="async" loading="lazy">` : `<span>${esc((m.name || "?").slice(0, 1))}</span>`}</span>`;
}
const hhmm = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
function chatLi(m){
  if (m.kind === "chat") return `<li class="c">${chatFace(m)}<div class="bub"><b>${esc(m.name)}<time datetime="${esc(m.created_at)}">${hhmm(m.created_at)}</time></b><span>${esc(m.body)}</span></div></li>`;
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
    const recent = animate && Date.now() - Date.parse(m.created_at) < 10000;
    if (recent && m.kind === "system" && m.data){
      const ev = m.data.event;
      if (ev === "reload") setTimeout(() => { sfx("spin"); const c = $("#rl-mag"); c.classList.remove("spin"); void c.offsetWidth; c.classList.add("spin"); }, 1400);
      else if (ev === "finish") setTimeout(() => sfx("win"), 1500);
      else if (ev === "bet") sfx("bet");
      else if (ev === "start") sfx("spin");
    }
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
  if (!el){ gun.style.setProperty("--aim", "-18deg"); gun.style.setProperty("--flip", 1); return; }   // 쉬는 중엔 테이블에 비스듬히 눕힘
  const ang = +el.dataset.ang;
  gun.style.setProperty("--aim", ang + "deg");
  // 왼쪽을 겨눌 때 손잡이가 위로 뒤집히지 않게 상하 반전
  gun.style.setProperty("--flip", Math.cos(ang * Math.PI / 180) < -0.01 ? -1 : 1);
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

/* 총구 끝(화면 좌표): 총 그림의 오른쪽 끝을 지금 겨눈 방향으로 */
function muzzle(box){
  const gun = $("#rl-gun"), r = gun.getBoundingClientRect(), cx = r.left + r.width / 2 - box.left, cy = r.top + r.height / 2 - box.top;
  const deg = parseFloat(gun.style.getPropertyValue("--aim")) || -90, a = deg * Math.PI / 180, len = r.width * .44;
  return [cx + Math.cos(a) * len, cy + Math.sin(a) * len, a];
}
function sparks(x, y, n, spread){
  const box = $("#rl-sparks");
  box.insertAdjacentHTML("beforeend", Array.from({ length: n }, () => {
    const a = Math.random() * Math.PI * 2, d = spread * (.4 + Math.random() * .8);
    return `<i style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;--dx:${(Math.cos(a) * d).toFixed(1)}px;--dy:${(Math.sin(a) * d).toFixed(1)}px;--c:${Math.random() < .5 ? "#EF1A72" : Math.random() < .5 ? "#5D97D9" : "#EEF3FA"};--t:${(380 + Math.random() * 380) | 0}ms"></i>`;
  }).join(""));
  setTimeout(() => { box.innerHTML = ""; }, 900);
}

function fx(d){
  const table = $("#rl-table"), svg = $("#rl-fx"), seat = $(`#rl-ring [data-seat="${d.target}"]`), gun = $("#rl-gun");
  if (!seat || nav.current !== "roulette") return;
  const anim = motionOK(), CH = anim ? 320 : 0;   // 충전 시간
  RL.fxUntil = Date.now() + (d.live ? 1350 + CH : 950);
  aimGun(d.target);
  const box = table.getBoundingClientRect();
  if (!d.live){
    // 빈 칸: 철컥 + 총구에서 작은 불티
    sfx("click");
    gun.classList.remove("kick"); void gun.offsetWidth; gun.classList.add("kick");
    seat.classList.remove("clack"); void seat.offsetWidth; seat.classList.add("clack");
    seat.dataset.say = "철컥";
    setTimeout(() => { const [mx, my] = muzzle(box); if (anim) sparks(mx, my, 5, 16); }, 120);
    setTimeout(() => seat.classList.remove("clack"), 880);
    return;
  }
  // 1) 충전: 전극 사이 불꽃이 커지며 웅 — 2) 발사: 번개 + 섬광 + 흔들림 + 불티 — 3) 탈락
  gun.classList.add("charging"); sfx("charge");
  setTimeout(() => {
    gun.classList.remove("charging");
    gun.classList.remove("kick"); void gun.offsetWidth; gun.classList.add("kick");
    sfx("zap");
    const [ax, ay] = muzzle(box), av = $(".av", seat).getBoundingClientRect();
    const tx = av.left + av.width / 2 - box.left, ty = av.top + av.height / 2 - box.top;
    svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
    const dist = Math.hypot(tx - ax, ty - ay), jag = Math.max(12, dist * .09);
    const fork = (pts, k, s2) => { const p = pts[Math.min(pts.length - 2, k)]; return bolt(p[0], p[1], p[0] + (tx - p[0]) * .6 + (Math.random() - .5) * s2, p[1] + (ty - p[1]) * .6 + (Math.random() - .5) * s2, jag * .5); };
    const draw = () => {
      const m = bolt(ax, ay, tx, ty, jag), m2 = bolt(ax, ay, tx, ty, jag * .7);
      const f1 = fork(m, 2 + (Math.random() * 3 | 0), 140), f2 = fork(m2, m2.length - 4, 110), f3 = fork(m, 1, 90);
      const halo = Array.from({ length: 6 }, (_, i) => { const a = i / 6 * Math.PI * 2 + Math.random(); const r = 26 + Math.random() * 20; return `<polyline class="b-mag" points="${ptsAttr(bolt(tx, ty, tx + Math.cos(a) * r, ty + Math.sin(a) * r, 5))}"/>`; }).join("");
      svg.innerHTML = `<defs><radialGradient id="rl-hitg"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".95"/><stop offset=".35" stop-color="#ADCFEA" stop-opacity=".6"/><stop offset=".7" stop-color="#EF1A72" stop-opacity=".25"/><stop offset="1" stop-color="#EF1A72" stop-opacity="0"/></radialGradient></defs>
        <circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="${(54 + Math.random() * 16).toFixed(1)}" fill="url(#rl-hitg)"/>
        <polyline class="b-glow-m" points="${ptsAttr(m)}"/><polyline class="b-glow-b" points="${ptsAttr(m2)}"/>
        <polyline class="b-mag" points="${ptsAttr(f1)}"/><polyline class="b-blue" points="${ptsAttr(f2)}"/><polyline class="b-mag thin" points="${ptsAttr(f3)}"/>
        <polyline class="b-mag" points="${ptsAttr(m2)}"/><polyline class="b-blue" points="${ptsAttr(m)}"/><polyline class="b-core" points="${ptsAttr(m)}"/>
        ${halo}
        <circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="${(8 + Math.random() * 6).toFixed(1)}" fill="url(#rl-hitg)"/>`;
    };
    table.classList.remove("rl-flash", "rl-shake"); void table.offsetWidth; table.classList.add("rl-flash");
    if (anim) table.classList.add("rl-shake");
    seat.classList.add("zap");
    draw();
    if (anim){ sparks(tx, ty, 22, 90); const iv = setInterval(draw, 50); setTimeout(() => { clearInterval(iv); svg.classList.add("fade"); }, 700); }
    setTimeout(() => sfx("out"), 520);
    setTimeout(() => { svg.innerHTML = ""; svg.classList.remove("fade"); seat.classList.remove("zap"); table.classList.remove("rl-flash", "rl-shake"); }, anim ? 1020 : 900);
  }, CH);
}

/* =========================================================
   조작
   ========================================================= */
async function call(fn, args, ok){
  const { data, error } = await sb.rpc(fn, args);
  if (error){ toast(missingTable(error) ? "supabase/update-8.sql을 먼저 실행해 주세요" : errMsg(error)); return null; }
  RL.actedAt = Date.now();
  if (ok) toast(ok);
  return data ?? true;
}

$("#rl-ring").addEventListener("click", async e => {
  const j = e.target.closest('[data-act="join"]'); if (j) return act(j);
  const b = e.target.closest("button.rl-seat");
  if (!b || b.getAttribute("aria-disabled") === "true") return;
  const i = +b.dataset.seat, r = RL.room;
  if (canAct()){
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
  if (a === "auto"){ RL.autoDummy = !RL.autoDummy; try { sessionStorage.setItem("rl-auto:" + RL.id, RL.autoDummy ? "1" : ""); } catch (_) {} renderTools(); renderBar(); autoDummy(); toast(RL.autoDummy ? "더미 차례를 자동으로 진행합니다" : "더미 자동 진행을 껐습니다"); return; }
  if (a === "avatar") return openAvatar();
  if (a === "cancel" && !confirm("게임을 취소할까요? 참가비와 베팅은 모두 돌려줍니다.")) return;
  if (a === "delete" && !confirm("이 방을 지울까요? 채팅과 베팅 기록도 함께 지워집니다. (코인 기록과 전적은 남습니다)")) return;
  if (a === "start" && r.entry_fee && !confirm(`시작하면 자리마다 참가비 ${CUR[curOf(r.currency)].name} ${n(r.entry_fee)}을 걷습니다. 시작할까요?`)) return;
  await withBusy(btn, async () => {
    let res = null;
    if (a === "join"){
      const ch = $("#rl-join-char")?.value || myChars()[0]?.uuid;
      res = await call("roulette_join", { p_room: id, p_character: ch }, "자리에 앉았습니다");
      if (res !== null) RL.myChar = ch;
    }
    else if (a === "dummy") res = await call("admin_roulette_add_dummy", { p_room: id, p_name: null }, "더미를 앉혔습니다");
    else if (a === "leave") res = await call("roulette_leave", { p_room: id }, "자리에서 일어났습니다");
    else if (a === "shoot"){
      const t = RL.target ?? ctlSeat()?.seat;
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
    `지금 그대로 끝나면 맞혔을 때 약 ${n(Math.floor(amt * (total + amt) / (on + amt)))}을 받습니다.${c ? ` (보유 ${CUR[curOf(RL.room?.currency)].name} ${n(balOf(c, RL.room?.currency))})` : ""}`;
}
function openBet(){
  if (!betOpen()){ toast("베팅이 마감되었습니다"); return; }
  const chars = myChars(), total = RL.bets.reduce((s, b) => s + b.amount, 0);
  showMsg($("#rl-bet-err"), "");
  $("#rl-bet-seats").innerHTML = RL.seats.filter(s => s.alive).map((s, k) => {
    const on = RL.bets.filter(b => b.seat === s.seat).reduce((x, b) => x + b.amount, 0);
    return `<label class="check"><input type="radio" name="rl-bet-seat" value="${s.seat}"${k === 0 ? " checked" : ""}>${esc(seatChar(s).name)} <span class="hint" style="display:inline; margin:0">— ${n(on)}코인 걸림${total ? ` (${Math.round(on / total * 100)}%)` : ""}</span></label>`;
  }).join("");
  $("#rl-bet-char").innerHTML = chars.map(c => `<option value="${esc(c.uuid)}"${c.uuid === RL.myChar ? " selected" : ""}>${esc(c.name)} — ${CUR[curOf(RL.room?.currency)].short} ${n(balOf(c, RL.room?.currency))}</option>`).join("");
  betEstimate();
  $("#rl-bet-dlg").showModal();
}
$("#rl-bet-form").addEventListener("input", betEstimate);
$("#rl-bet-form").addEventListener("submit", async e => {
  e.preventDefault();
  const seat = $('input[name="rl-bet-seat"]:checked'), amt = parseInt($("#rl-bet-amt").value, 10);
  if (!seat){ showMsg($("#rl-bet-err"), "걸 사람을 골라 주세요."); return; }
  if (!(amt >= 1)){ showMsg($("#rl-bet-err"), "1코인 이상 걸어 주세요."); $("#rl-bet-amt").focus(); return; }
  await withBusy($('button[type="submit"]', e.target), async () => {
    const { error } = await sb.rpc("roulette_bet", { p_room: RL.id, p_seat: +seat.value, p_character: $("#rl-bet-char").value, p_amount: amt });
    if (error){ showMsg($("#rl-bet-err"), errMsg(error)); return; }
    $("#rl-bet-dlg").close();
    toast(`${n(amt)}코인을 걸었습니다`);
    load(true);
  });
});

/* ---------- 자리 이미지 ---------- */
let avaFile = null;
function avaChoices(){
  const mine = myChars().map(c => ({ uuid: c.uuid, name: c.name }));
  if (state.isAdmin) RL.seats.forEach(s => { if (s.character_id && !mine.some(m => m.uuid === s.character_id)) mine.push({ uuid: s.character_id, name: seatChar(s).name }); });
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
      const { toWebP, extOf } = await import("./img.js?v=20261031c");
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

/* 로그인·로그아웃, 코인 변화, 창 크기 */
document.addEventListener("comu:auth", () => { if (nav.current === "roulette" && RL.room) render(); if (nav.current === "game") loadLobby(); });
addEventListener("resize", () => { if (nav.current === "roulette" && RL.room) aimGun(RL.target ?? RL.room.turn_seat); });

/* 효과음 크기: 움직이는 동안 숫자만 바꾸고, 놓으면 들려줌 */
$("#rl-tools").addEventListener("input", e => {
  if (e.target.id !== "rl-vol") return;
  const v = +e.target.value;
  setSfxVol(v / 100);
  e.target.nextElementSibling.textContent = v || "끔";
});
$("#rl-tools").addEventListener("change", e => { if (e.target.id === "rl-vol" && +e.target.value) sfx("turn"); });
hotkeys("roulette", "#rl-bar");
