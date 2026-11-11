/* =========================================================
   비밀 탭 나누기·합치기 (update-20.sql 의 log_secrets 표)
   - 기록 파일(공개)에는 비밀 탭을 빼고 저장, 비밀 탭은 탭마다 한 줄씩 log_secrets 에
   - 볼 수 있는 사람이 열면 그 줄만 받아서 원래 자리에 끼워 넣음 (DB가 볼 수 없는 줄은 아예 안 줌)
   합쳐진 기록의 비밀 탭은 tabs[t] = [이름, "secret", [볼 수 있는 캐릭터 id…]]
   비밀 줄 data: { sk, tab:[이름, 형식], sp:[…], faces:[…], m:[[공개 대사 번호(이 앞에 끼움), 화자, 본문, 표정, 원래 순서]] }
   sk = 짝 열쇠: 공개 파일과 비밀 줄에 같은 값을 적어 둠. 열쇠가 다른 비밀 줄은 합치지 않음
        → 저장하다 끊겨서 예전 것과 새것이 섞여 남아도, 보는 화면에는 늘 한 벌로 맞는 것만 나옴
   ========================================================= */

const isSecret = tab => tab && tab[1] === "secret";

/* 화자·표정 번호를 새 목록 기준으로 다시 매김 */
function picker(log){
  const sp = [], faces = [], spMap = new Map(), fMap = new Map();
  const face = f => { if (f < 0 || f == null || !log.faces?.[f]) return -1; if (!fMap.has(f)){ fMap.set(f, faces.length); faces.push(log.faces[f]); } return fMap.get(f); };
  const speaker = s => {
    if (!spMap.has(s)){
      const [name, color, narr, def = -1, list = []] = log.sp[s];
      spMap.set(s, sp.length);
      sp.push([name, color, narr, face(def), list.map(face).filter(x => x >= 0)]);
    }
    return spMap.get(s);
  };
  return { sp, faces, face, speaker };
}

/* 합쳐진 기록 → { pub: 공개 파일에 넣을 기록, secrets: [{ tab_name, character_ids, data }] } */
const newKey = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export function splitLog(log){
  const sk = newKey();                                      // 저장할 때마다 새 열쇠
  if (!log.tabs.some(isSecret)) return { pub: { ...log, sk }, secrets: [] };
  const P = picker(log), pubTabs = [], tabMap = new Map(), rows = new Map(), pubIdx = [];
  const m = [];
  log.m.forEach(([t, s, text, f = -1, tm], i) => {
    pubIdx[i] = m.length;                                   // 이 대사 앞까지 공개 대사가 몇 개인지
    const tab = log.tabs[t];
    if (isSecret(tab)){
      if (!rows.has(t)) rows.set(t, { tab, P: picker(log), m: [] });
      const r = rows.get(t);
      r.m.push(tm ? [m.length, r.P.speaker(s), text, r.P.face(f), i, tm] : [m.length, r.P.speaker(s), text, r.P.face(f), i]);
      return;
    }
    if (!tabMap.has(t)){ tabMap.set(t, pubTabs.length); pubTabs.push([tab[0], tab[1]]); }
    m.push(tm ? [tabMap.get(t), P.speaker(s), text, P.face(f), tm] : [tabMap.get(t), P.speaker(s), text, P.face(f)]);
  });
  const at = i => i >= log.m.length ? m.length : pubIdx[i];
  const pub = {
    v: log.v || 3, sk, src: log.src || "", n: m.length, tabs: pubTabs, faces: P.faces, sp: P.sp, m,
    bgm: (log.bgm || []).map(b => ({ ...b, at: at(b.at) })),
    bg: (log.bg || []).map(b => ({ ...b, at: at(b.at) }))
  };
  const secrets = [...rows.values()].map(r => ({
    tab_name: r.tab[0],
    character_ids: Array.isArray(r.tab[2]) ? r.tab[2] : [],
    data: { sk, tab: [r.tab[0], r.tab[1]], sp: r.P.sp, faces: r.P.faces, m: r.m }
  }));
  return { pub, secrets };
}

/* 공개 기록 + 받은 비밀 줄 → 합쳐진 기록 (원래 순서대로) */
export function mergeLog(pub, rows){
  const log = { ...pub, tabs: pub.tabs.map(t => [...t]), faces: [...(pub.faces || [])], sp: pub.sp.map(s => [...s]), bgm: (pub.bgm || []).map(b => ({ ...b })), bg: (pub.bg || []).map(b => ({ ...b })) };
  rows = (rows || []).filter(r => (r.data?.sk || "") === (pub.sk || ""));   // 이 공개 파일과 한 벌로 저장된 비밀 줄만
  if (!rows.length){ log.m = pub.m.slice(); return log; }
  const extra = [];
  for (const row of rows){
    const d = row.data;
    if (!d?.m?.length) continue;
    const t = log.tabs.length;
    log.tabs.push([d.tab?.[0] || row.tab_name, "secret", row.character_ids || []]);
    const fOff = log.faces.length, sOff = log.sp.length;
    log.faces.push(...(d.faces || []));
    for (const [name, color, narr, def = -1, list = []] of d.sp || []) log.sp.push([name, color, narr, def >= 0 ? def + fOff : -1, list.map(f => f + fOff)]);
    for (const [at, s, text, f = -1, o = 0, tm] of d.m) extra.push({ at, o, row: tm ? [t, s + sOff, text, f >= 0 ? f + fOff : -1, tm] : [t, s + sOff, text, f >= 0 ? f + fOff : -1] });
  }
  extra.sort((a, b) => a.at - b.at || a.o - b.o);
  const m = [], pos = [];
  let e = 0;
  pub.m.forEach((x, k) => {
    while (e < extra.length && extra[e].at <= k) m.push(extra[e++].row);
    pos[k] = m.length;
    m.push(x);
  });
  while (e < extra.length) m.push(extra[e++].row);
  const at = k => k >= pub.m.length ? m.length : pos[k];
  log.bgm.forEach(b => { b.at = at(b.at); });
  log.bg.forEach(b => { b.at = at(b.at); });
  log.m = m; log.n = m.length;
  return log;
}

const noTable = e => /log_secrets|42P01|PGRST205/.test((e?.message || "") + (e?.code || ""));

/* 회차에 붙은 비밀 줄을 모두 지움 (기록을 삭제할 때) */
export async function clearSecrets(sb, chapterId){
  const { error } = await sb.from("log_secrets").delete().eq("chapter_id", chapterId);
  if (error && !noTable(error)) throw error;
}

/* 기록 저장 (새로 올리기·편집 저장이 같이 씀). 순서가 중요함:
   ① 새 공개 파일 올림 → ② 새 비밀 줄 넣음 → ③ 회차가 새 파일을 가리키게 함 → ④ 예전 파일·예전 비밀 줄 치움
   보는 사람에게는 ③ 한 번에 예전 것에서 새것으로 바뀜 (그 전에 끊기면 예전 기록 그대로, 그 뒤에 끊기면 새 기록 그대로).
   ①②에서 넣은 것은 열쇠(sk)가 달라서 ③ 전에는 누구에게도 합쳐지지 않음 */
export async function saveLog(sb, chapterId, log, { oldPath = "", onStatus = () => {} } = {}){
  const { pub, secrets } = splitLog(log);
  const old = await sb.from("log_secrets").select("id").eq("chapter_id", chapterId);
  if (old.error && (secrets.length || !noTable(old.error)))
    throw Object.assign(new Error(noTable(old.error) ? "비밀 탭을 저장할 표가 없습니다. supabase/update-20.sql 을 먼저 실행해 주세요." : "비밀 탭 저장 준비에 실패했습니다. 잠시 후 다시 해 주세요."), { cause: old.error });
  const blob = new Blob([JSON.stringify(pub)], { type: "application/json" });
  const path = `ch-${chapterId}-${Date.now()}.json`;
  onStatus(`저장 중… (${Math.ceil(blob.size / 1024).toLocaleString("ko-KR")}KB${secrets.length ? ` · 비밀 탭 ${secrets.length}개 따로` : ""})`);
  const files = sb.storage.from("logs");
  const up = await files.upload(path, blob, { contentType: "application/json", cacheControl: "31536000", upsert: false });   // ①
  if (up.error) throw up.error;
  let added = [];
  const undo = async () => {                                 // 되돌리기: 방금 넣은 것만 치움 (실패해도 화면에는 영향 없음)
    try { await files.remove([path]); } catch (_) {}
    try { if (added.length) await sb.from("log_secrets").delete().in("id", added); } catch (_) {}
  };
  try {
    if (secrets.length){                                     // ②
      const ins = await sb.from("log_secrets").insert(secrets.map(s => ({ ...s, chapter_id: chapterId }))).select("id");
      if (ins.error) throw ins.error;
      added = (ins.data || []).map(r => r.id);
    }
    const { error } = await sb.from("chapters").update({ log_path: path, updated_at: new Date().toISOString() }).eq("id", chapterId);   // ③
    if (error) throw error;
  } catch (err){ await undo(); throw err; }
  // ④ 여기부터는 이미 새 기록으로 바뀐 뒤 — 못 치운 것이 남아도 열쇠가 달라 화면에는 나오지 않음
  const stale = (old.data || []).map(r => r.id);
  try { if (stale.length) await sb.from("log_secrets").delete().in("id", stale); } catch (_) {}
  try { if (oldPath && oldPath !== path) await files.remove([oldPath]); } catch (_) {}
  return { path, pub, secrets: secrets.length, size: blob.size };
}

/* 다시 올릴 때: 예전 기록에 넣어 둔 배경·BGM 표시를 새 기록의 같은 대사 자리로 옮김.
   표시가 붙어 있던 대사(화자+본문)를 새 기록에서 찾음. 같은 대사가 여러 번 나오면 앞뒤 세 줄이 가장 많이 맞는 곳,
   그 대사가 고쳐졌거나 빠졌으면 앞뒤 5줄까지 살펴 자리를 잡음. 끝내 못 찾은 표시는 빼고, 몇 개를 옮겼는지 알려 줌 */
export function carryMarks(oldLog, newLog){
  const key = (log, i) => { const x = log.m[i]; return x ? (log.sp[x[1]]?.[0] || "") + "\u0000" + x[2] : null; };
  const where = new Map();                                   // 대사 → 새 기록에서의 번호들
  newLog.m.forEach((_, j) => { const k = key(newLog, j); if (!where.has(k)) where.set(k, []); where.get(k).push(j); });
  const around = (i, j) => { let n = 0; for (let o = -3; o <= 3; o++){ const k = o && key(oldLog, i + o); if (k && k === key(newLog, j + o)) n++; } return n; };
  const pick = (list, i, want) => {                          // 앞뒤가 가장 많이 맞는 곳, 같으면 밀린 만큼 옮긴 자리에서 가까운 곳
    let best = list[0], bs = -1;
    for (const j of list){ const sc = around(i, j); if (sc > bs || (sc === bs && Math.abs(j - want) < Math.abs(best - want))){ best = j; bs = sc; } }
    return best;
  };
  const move = marks => {
    let shift = 0;                                           // 바로 앞 표시가 얼마나 밀렸는지
    return (marks || []).slice().sort((a, b) => a.at - b.at).map(b => {
      let to = -1;
      if (b.at >= oldLog.m.length) to = newLog.m.length;     // 맨 끝에 붙은 표시
      else find: for (let d = 0; d <= 5; d++) for (const o of d ? [-d, d] : [0]){
        const list = where.get(key(oldLog, b.at + o));
        if (!list) continue;
        const j = pick(list, b.at + o, b.at + o + shift) - o;
        if (j >= 0 && j <= newLog.m.length){ to = j; break find; }
      }
      if (to < 0) return null;
      shift = to - b.at;
      return { ...b, at: to };
    }).filter(Boolean);
  };
  const bg = move(oldLog.bg), bgm = move(oldLog.bgm);
  return { bg, bgm, total: (oldLog.bg || []).length + (oldLog.bgm || []).length, kept: bg.length + bgm.length };
}

/* 이 사람이 볼 수 있는 비밀 줄 (DB 규칙이 거름). ok=false면 받지 못한 것 — 이때 관리자가 편집 저장하면 비밀 탭이 지워지므로 저장을 막음 */
export async function loadSecrets(sb, chapterId){
  const { data, error } = await sb.from("log_secrets").select("tab_name, character_ids, data").eq("chapter_id", chapterId).order("created_at");
  if (error) return { rows: [], ok: noTable(error) };   // 표가 아직 없으면(update-20 전) 비밀 탭도 없는 것
  return { rows: data || [], ok: true };
}

/* 비밀 탭 화자 이름 ↔ 사이트 캐릭터 이름 맞추기: 같거나, 한쪽이 다른 쪽을 품으면(두 글자 이상) */
const norm = s => String(s || "").replace(/\s*[(（\[【].*?[)）\]】]\s*/g, "").replace(/\s+/g, "").toLowerCase();
export function matchCharacters(names, chars){
  const ns = [...new Set(names.map(norm).filter(n => n.length >= 2))];
  return chars.filter(c => { const cn = norm(c.name); return cn.length >= 2 && ns.some(n => n === cn || n.includes(cn) || cn.includes(n)); }).map(c => c.uuid);
}
