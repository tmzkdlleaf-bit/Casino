/* =========================================================
   비밀 탭 나누기·합치기 (update-20.sql 의 log_secrets 표)
   - 기록 파일(공개)에는 비밀 탭을 빼고 저장, 비밀 탭은 탭마다 한 줄씩 log_secrets 에
   - 볼 수 있는 사람이 열면 그 줄만 받아서 원래 자리에 끼워 넣음 (DB가 볼 수 없는 줄은 아예 안 줌)
   합쳐진 기록의 비밀 탭은 tabs[t] = [이름, "secret", [볼 수 있는 캐릭터 id…]]
   비밀 줄 data: { tab:[이름, 형식], sp:[…], faces:[…], m:[[공개 대사 번호(이 앞에 끼움), 화자, 본문, 표정, 원래 순서]] }
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
export function splitLog(log){
  if (!log.tabs.some(isSecret)) return { pub: log, secrets: [] };
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
    v: log.v || 3, src: log.src || "", n: m.length, tabs: pubTabs, faces: P.faces, sp: P.sp, m,
    bgm: (log.bgm || []).map(b => ({ ...b, at: at(b.at) })),
    bg: (log.bg || []).map(b => ({ ...b, at: at(b.at) }))
  };
  const secrets = [...rows.values()].map(r => ({
    tab_name: r.tab[0],
    character_ids: Array.isArray(r.tab[2]) ? r.tab[2] : [],
    data: { tab: [r.tab[0], r.tab[1]], sp: r.P.sp, faces: r.P.faces, m: r.m }
  }));
  return { pub, secrets };
}

/* 공개 기록 + 받은 비밀 줄 → 합쳐진 기록 (원래 순서대로) */
export function mergeLog(pub, rows){
  const log = { ...pub, tabs: pub.tabs.map(t => [...t]), faces: [...(pub.faces || [])], sp: pub.sp.map(s => [...s]), bgm: (pub.bgm || []).map(b => ({ ...b })), bg: (pub.bg || []).map(b => ({ ...b })) };
  if (!rows?.length){ log.m = pub.m.slice(); return log; }
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

/* 회차의 비밀 줄 다시 쓰기: 새 줄을 먼저 넣고 성공하면 예전 줄을 지움 */
export async function saveSecrets(sb, chapterId, secrets){
  const old = await sb.from("log_secrets").select("id").eq("chapter_id", chapterId);
  if (old.error){
    if (!secrets.length && /log_secrets|42P01|PGRST205/.test(old.error.message + old.error.code)) return;   // 표가 없어도 비밀 탭이 없으면 그대로
    throw Object.assign(new Error("비밀 탭을 저장할 표가 없습니다. supabase/update-20.sql 을 먼저 실행해 주세요."), { cause: old.error });
  }
  if (secrets.length){
    const ins = await sb.from("log_secrets").insert(secrets.map(s => ({ ...s, chapter_id: chapterId })));
    if (ins.error) throw ins.error;
  }
  const ids = (old.data || []).map(r => r.id);
  if (ids.length){ const del = await sb.from("log_secrets").delete().in("id", ids); if (del.error) throw del.error; }
}

/* 이 사람이 볼 수 있는 비밀 줄 (DB 규칙이 거름). ok=false면 받지 못한 것 — 이때 관리자가 편집 저장하면 비밀 탭이 지워지므로 저장을 막음 */
export async function loadSecrets(sb, chapterId){
  const { data, error } = await sb.from("log_secrets").select("tab_name, character_ids, data").eq("chapter_id", chapterId).order("created_at");
  if (error) return { rows: [], ok: /log_secrets|42P01|PGRST205/.test((error.message || "") + (error.code || "")) };   // 표가 아직 없으면(update-20 전) 비밀 탭도 없는 것
  return { rows: data || [], ok: true };
}

/* 비밀 탭 화자 이름 ↔ 사이트 캐릭터 이름 맞추기: 같거나, 한쪽이 다른 쪽을 품으면(두 글자 이상) */
const norm = s => String(s || "").replace(/\s*[(（\[【].*?[)）\]】]\s*/g, "").replace(/\s+/g, "").toLowerCase();
export function matchCharacters(names, chars){
  const ns = [...new Set(names.map(norm).filter(n => n.length >= 2))];
  return chars.filter(c => { const cn = norm(c.name); return cn.length >= 2 && ns.some(n => n === cn || n.includes(cn) || cn.includes(n)); }).map(c => c.uuid);
}
