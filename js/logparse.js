/* =========================================================
   코코포리아 로그 → 사이트용 기록(JSON)  (관리 페이지에서만 불러옴)
   파서는 나비코코 로그 변환기(index.html)의 parseLog 규칙을 그대로 따름
     HTML: <p style="color:…"><span>[탭]</span><span>이름</span> : <span>본문<br>…</span></p>
     텍스트: [탭]이름：본문
   저장 형식 v2(작게):
     { v:2, src, n,
       tabs:[[이름, 형식]],
       faces:[이미지 주소 또는 logs 버킷 경로],
       sp:[[이름, 색, 나레이션(0/1), 기본 표정 번호(-1=없음), [쓸 수 있는 표정 번호…]]],
       m:[[탭번호, 화자번호, 본문, 표정 번호(-1=없음)]],
       bgm:[{ at:대사 번호, kind:"audio"|"youtube"|"stop", url, title, start }] }
   ========================================================= */

export function parseLog(source){
  const trimmed = source.trimStart();
  const looksHtml = /^<(!doctype|html|head|body|p)\b/i.test(trimmed) || /<p[\s>]/i.test(source);
  return looksHtml ? parseHtmlLog(source) : parseTextLog(source);
}

function parseHtmlLog(html){
  const doc = new DOMParser().parseFromString(html, "text/html");
  const messages = [];
  for (const p of doc.querySelectorAll("p")){
    const spans = p.querySelectorAll(":scope > span");
    if (spans.length < 3) continue;
    const tab = spans[0].textContent.trim().replace(/^\[(.*)\]$/, "$1").trim();
    const name = spans[1].textContent.trim();
    const text = htmlToText(spans[2]).trim();
    const color = normalizeColor(p.style.color) || "#888888";
    messages.push({ tab: tab || "main", name, text, color });
  }
  return messages;
}

function htmlToText(el){
  let out = "";
  for (const node of el.childNodes){
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent.replace(/\s*\n\s*/g, "");
    else if (node.nodeName === "BR") out += "\n";
    else out += htmlToText(node);
  }
  return out;
}

function parseTextLog(text){
  const messages = [];
  const re = /^\[([^\]]+)\]\s*(.+?)\s*[：:]\s?(.*)$/;
  for (const line of text.split(/\r?\n/)){
    const m = line.match(re);
    if (m) messages.push({ tab: m[1].trim(), name: m[2], text: m[3], color: "#888888" });
    else if (messages.length && line.trim() !== "") messages[messages.length - 1].text += "\n" + line;
  }
  return messages;
}

export function normalizeColor(css){
  if (!css) return null;
  const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return "#" + m.slice(1, 4).map(n => (+n).toString(16).padStart(2, "0")).join("");
  if (/^#[0-9a-f]{6}$/i.test(css)) return css.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(css)) return "#" + [...css.slice(1)].map(c => c + c).join("").toLowerCase();
  return null;
}

/* 탭 이름으로 형식 짐작: 메인 / 잡담 / 정보 / 비밀 */
export function guessTabFormat(tab){
  const t = String(tab).trim().toLowerCase();
  if (/^(main|메인|メイン|主要)$/.test(t)) return "main";
  if (/^(info|정보|情報|信息)$/.test(t)) return "info";
  if (/^(other|잡담|사담|雑談|闲聊)$/.test(t)) return "other";
  if (/^(secret|비밀|秘匿|秘密)/.test(t)) return "secret";
  return "main";
}

/* 올린 뒤 고를 수 있게: 탭별·화자별 개수 */
export function analyze(messages){
  const tabs = new Map(), sp = new Map();
  for (const m of messages){
    tabs.set(m.tab, (tabs.get(m.tab) || 0) + 1);
    const s = sp.get(m.name) || { name: m.name, color: m.color, count: 0 };
    s.count++; sp.set(m.name, s);
  }
  return {
    tabs: [...tabs].map(([name, count]) => ({ name, count, format: guessTabFormat(name) })),
    speakers: [...sp.values()].sort((a, b) => b.count - a.count)
  };
}

/* 줄 처음·끝의 @표정 태그 (예: "그래요 @웃음", "@놀람 뭐야?") */
const FACE_TAG = /^[ \t]*[@＠][^\s@＠]+[ \t]*|[ \t]*[@＠][^\s@＠]+[ \t]*$/gm;

export const isImageUrl = u => typeof u === "string" && /^(https?:|data:image\/)/i.test(u.trim());
const faceLabel = label => String(label || "").replace(/^[@＠]/, "").trim();

/* 대사 안의 @표정 태그를 그 캐릭터의 표정 이름과 맞춰 봄 (긴 이름부터) */
function findFaceTag(text, faces){
  const sorted = faces.filter(f => faceLabel(f.label)).sort((a, b) => faceLabel(b.label).length - faceLabel(a.label).length);
  for (const f of sorted){
    const re = new RegExp("[@＠]" + faceLabel(f.label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const m = text.match(re);
    if (m) return { face: f, tag: m[0] };
  }
  return null;
}

/* 표정 결정 순서 (변환기와 같음): @태그 > 룸 채팅에 실제로 쓴 표정 > 직전 표정 > 기본 이미지 */
export function pack(messages, { include, narrators, stripTag, src, library = [] }){
  const lib = new Map(library.map(c => [c.name.trim(), c]));
  const tabIdx = new Map(), spIdx = new Map(), faceIdx = new Map(), tabs = [], sp = [], faces = [], m = [];
  const face = url => { if (!isImageUrl(url)) return -1; if (!faceIdx.has(url)){ faceIdx.set(url, faces.length); faces.push(url); } return faceIdx.get(url); };
  const lastFace = {};
  for (const x of messages){
    if (!include.has(x.tab)) continue;
    const c = lib.get(x.name.trim());
    const cFaces = c ? [{ label: "", iconUrl: c.iconUrl }, ...c.faces].filter(f => isImageUrl(f.iconUrl)) : [];
    let text = x.text;
    const tagged = cFaces.length ? findFaceTag(text, cFaces) : null;
    if (tagged && stripTag) text = text.replace(tagged.tag, "");
    if (stripTag) text = text.replace(FACE_TAG, "");
    text = text.replace(/[ \t]{2,}/g, " ").trim();
    if (!text) continue;
    let f = -1;
    if (tagged) f = face(tagged.face.iconUrl);
    else if (isImageUrl(x.roomFace)) f = face(x.roomFace);
    else if (lastFace[x.name] >= 0) f = lastFace[x.name];
    else if (c) f = face(c.iconUrl || c.faces[0]?.iconUrl);
    lastFace[x.name] = f;
    if (!tabIdx.has(x.tab)){ tabIdx.set(x.tab, tabs.length); tabs.push([x.tab, guessTabFormat(x.tab)]); }
    const key = x.name + "\u0000" + x.color;
    if (!spIdx.has(key)){
      spIdx.set(key, sp.length);
      sp.push([x.name, x.color, narrators.has(x.name) ? 1 : 0, c ? face(c.iconUrl || c.faces[0]?.iconUrl) : -1, cFaces.map(ff => face(ff.iconUrl))]);
    }
    m.push([tabIdx.get(x.tab), spIdx.get(key), text, f]);
  }
  // 표정 목록 중복 제거
  for (const s of sp) s[4] = [...new Set(s[4])].filter(i => i >= 0);
  return { v: 2, src: src || "", n: m.length, tabs, faces, sp, m, bgm: [] };
}

/* ---------- 스탠딩 데이터: 북마클릿 결과·코코포리아에서 복사한 캐릭터 데이터·룸 데이터(JSON) ---------- */
function splitJsonValues(text){
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (inStr){ if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"' && depth > 0) inStr = true;
    else if (ch === "{" || ch === "["){ if (depth++ === 0) start = i; }
    else if ((ch === "}" || ch === "]") && depth > 0 && --depth === 0){ try { out.push(JSON.parse(text.slice(start, i + 1))); } catch (_) {} }
  }
  return out;
}

export function parseLibrary(text){
  let data;
  try { data = JSON.parse(text); } catch (_){
    data = splitJsonValues(text);
    if (!data.length) throw new Error("붙여넣은 내용을 읽지 못했습니다. 북마크 창이나 코코포리아에서 복사한 내용을 그대로 붙여넣어 주세요.");
  }
  const found = [], seen = new Set();
  (function walk(o){
    if (!o || typeof o !== "object" || seen.has(o)) return;
    seen.add(o);
    if (typeof o.name === "string" && (Array.isArray(o.faces) || isImageUrl(o.iconUrl))){
      found.push({
        name: o.name, color: normalizeColor(o.color || "") || "",
        iconUrl: isImageUrl(o.iconUrl) ? o.iconUrl : "",
        faces: (o.faces || []).filter(f => f && isImageUrl(f.iconUrl)).map(f => ({ label: String(f.label || ""), iconUrl: f.iconUrl }))
      });
      return;
    }
    for (const v of Array.isArray(o) ? o : Object.values(o)) walk(v);
  })(data);
  return found;
}

/* ---------- 코코포리아 룸 링크로 불러오기 (변환기와 같은 방식)
   코코포리아 웹앱에 공개로 들어 있는 Firebase 설정으로 익명 로그인한 뒤 Firestore REST API로 룸의 캐릭터와 채팅을 읽음.
   코코포리아 공식 기능이 아니라 언제든 막힐 수 있음 → 그때는 붙여넣기 방식 사용 ---------- */
const CCFOLIA = { apiKey: "AIzaSyAMlcPs4ekVSBdzpRdEloqQ8lIgP9lEnRI", docs: "https://firestore.googleapis.com/v1/projects/ccfolia-160aa/databases/(default)/documents" };
const AUTH_KEY = "comu-ccfolia-auth";
export const roomIdFrom = v => (String(v).match(/ccfolia\.com\/rooms\/([A-Za-z0-9_-]+)/) || String(v).trim().match(/^([A-Za-z0-9_-]{6,})$/) || [])[1];

class RoomError extends Error { constructor(message, status){ super(message); this.status = status; } }
function fsValue(v){
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return +v.integerValue;
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fsValue);
  if ("mapValue" in v) return fsFields(v.mapValue.fields);
  return null;
}
function fsFields(f){ const o = {}; for (const k in f || {}) o[k] = fsValue(f[k]); return o; }

async function ccfoliaToken(forceNew){
  let auth = null;
  try { auth = JSON.parse(localStorage.getItem(AUTH_KEY)); } catch (_) {}
  const save = a => { try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch (_) {} };
  const from = (idToken, refreshToken, expiresIn) => ({ idToken, refreshToken, expiresAt: Date.now() + (+expiresIn || 3600) * 1000 });
  if (!forceNew && auth?.idToken && auth.expiresAt > Date.now() + 60000) return auth.idToken;
  if (!forceNew && auth?.refreshToken){
    try {
      const r = await fetch("https://securetoken.googleapis.com/v1/token?key=" + CCFOLIA.apiKey, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(auth.refreshToken) });
      if (r.ok){ const j = await r.json(); auth = from(j.id_token, j.refresh_token, j.expires_in); save(auth); return auth.idToken; }
    } catch (_) {}
  }
  let r;
  try { r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + CCFOLIA.apiKey, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }) }); }
  catch (_){ throw new RoomError("코코포리아 서버에 연결하지 못했습니다."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.idToken) throw new RoomError("코코포리아 접속(익명 로그인)이 막혔습니다: " + (j.error?.message || r.status), r.status);
  auth = from(j.idToken, j.refreshToken, j.expiresIn); save(auth);
  return auth.idToken;
}
async function ccfoliaGet(path, token){
  let r;
  try { r = await fetch(CCFOLIA.docs + path, { headers: { Authorization: "Bearer " + token } }); }
  catch (_){ throw new RoomError("코코포리아 서버에 연결하지 못했습니다."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new RoomError(j.error?.message || "HTTP " + r.status, r.status);
  return j;
}
async function ccfoliaList(roomId, collection, token, onPage){
  const docs = [];
  let page = "";
  do {
    const j = await ccfoliaGet(`/rooms/${encodeURIComponent(roomId)}/${collection}?pageSize=300` + (page ? "&pageToken=" + encodeURIComponent(page) : ""), token);
    docs.push(...(j.documents || [])); page = j.nextPageToken; onPage?.(docs.length);
  } while (page);
  return docs;
}
const roomCharacter = doc => { const c = fsFields(doc.fields); return { name: c.name || "", color: normalizeColor(c.color || "") || "", iconUrl: isImageUrl(c.iconUrl) ? c.iconUrl : "", faces: (c.faces || []).filter(f => f && isImageUrl(f.iconUrl)).map(f => ({ label: String(f.label || ""), iconUrl: f.iconUrl })) }; };
const roomMessage = doc => { const f = fsFields(doc.fields); const roll = f.extend?.roll?.result || ""; return { name: f.name || "", text: [f.text || "", roll].filter(Boolean).join(" ").trim(), roomFace: isImageUrl(f.iconUrl) ? f.iconUrl : "", time: f.createdAt || doc.createTime || "" }; };

export async function loadRoom(roomId, { withLog = true, onStatus = () => {} } = {}){
  onStatus("코코포리아에 접속하는 중…");
  let token = await ccfoliaToken();
  let docs;
  try { docs = await ccfoliaList(roomId, "characters", token); }
  catch (err){ if (err.status !== 401 && err.status !== 403) throw err; token = await ccfoliaToken(true); docs = await ccfoliaList(roomId, "characters", token); }
  const characters = docs.map(roomCharacter).filter(c => c.name);
  let roomMsgs = [];
  if (withLog){
    onStatus("채팅 기록을 가져오는 중…");
    const md = await ccfoliaList(roomId, "messages", token, n => onStatus(`채팅 기록을 가져오는 중… ${n}개`));
    roomMsgs = md.map(roomMessage).filter(m => m.text).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  }
  onStatus("");
  return { characters, roomMsgs };
}

/* 로그의 대사와 룸 채팅을 순서대로 맞춰 대사마다 실제로 쓴 표정을 붙임 */
export function alignRoomFaces(messages, roomMsgs){
  const norm = s => s.replace(/\s+/g, "");
  let j = 0, matched = 0;
  for (const m of messages){
    const text = norm(m.text);
    for (let k = j; k < Math.min(roomMsgs.length, j + 300); k++){
      const r = roomMsgs[k];
      if (r.name === m.name && norm(r.text) === text){ m.roomFace = r.roomFace; j = k + 1; matched++; break; }
    }
  }
  return matched;
}

export function youtubeInfo(url, start){
  const m = String(url || "").match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (!m) return null;
  const t = +start || +((String(url).match(/[?&]t=(\d+)/) || [])[1]) || 0;
  return { id: m[1], start: t };
}

/* ---------- 비공개 룸용 북마클릿 (변환기의 것을 그대로 옮김)
   코코포리아 룸 화면에서 누르면, 로그인된 사용자 권한으로 이 룸의 캐릭터(이름·색·아이콘·표정)를 JSON으로 보여 줌 ---------- */
function ccfoliaStandingExporter() {
  const show = (title, message, text) => {
    const old = document.getElementById("__comulog");
    if (old) old.remove();
    const box = document.createElement("div");
    box.id = "__comulog";
    box.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font-family:sans-serif";
    box.innerHTML = '<div style="background:#fff;color:#222;padding:20px;border-radius:12px;width:min(520px,92vw);line-height:1.6">'
      + '<b style="font-size:16px"></b><p style="margin:8px 0;font-size:13px;white-space:pre-wrap"></p>'
      + (text ? '<textarea readonly style="width:100%;height:140px;font-size:12px"></textarea>' : "")
      + '<div style="margin-top:10px;text-align:right"><button style="padding:8px 14px;font-weight:bold;cursor:pointer"></button></div></div>';
    box.querySelector("b").textContent = title;
    box.querySelector("p").textContent = message;
    const btn = box.querySelector("button");
    btn.textContent = text ? "복사하고 닫기" : "닫기";
    const ta = box.querySelector("textarea");
    if (ta) ta.value = text;
    btn.onclick = async () => {
      if (ta) {
        ta.select();
        try { await navigator.clipboard.writeText(text); } catch (_) { document.execCommand("copy"); }
      }
      box.remove();
    };
    box.onclick = e => { if (e.target === box) box.remove(); };
    document.body.appendChild(box);
    if (ta) ta.select();
  };

  (async () => {
    const m = location.pathname.match(/\/rooms\/([^/?#]+)/);
    if (!/(^|\.)ccfolia\.com$/.test(location.hostname) || !m) {
      show("코코포리아 룸 화면에서 눌러주세요", "지금 페이지: " + location.href + "\n\n코코포리아 룸에 입장한 상태에서 북마크를 눌러야 해요.");
      return;
    }
    const roomId = m[1];
    show("불러오는 중…", "잠시만 기다려주세요.");

    // Firebase 로그인 정보 (localStorage 또는 IndexedDB에 저장됨)
    const users = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || "";
      if (k.indexOf("firebase:authUser:") !== 0) continue;
      try { users.push(Object.assign({ apiKey: k.split(":")[2] }, JSON.parse(localStorage.getItem(k)))); } catch (_) {}
    }
    await new Promise(res => {
      try {
        const rq = indexedDB.open("firebaseLocalStorageDb");
        // DB가 없을 때 빈 DB를 만들어 코코포리아 로그인 저장소를 망가뜨리지 않도록 생성을 취소한다
        rq.onupgradeneeded = e => e.target.transaction.abort();
        rq.onerror = () => res();
        rq.onsuccess = e => {
          try {
            const g = e.target.result.transaction("firebaseLocalStorage", "readonly").objectStore("firebaseLocalStorage").getAll();
            g.onsuccess = ev => {
              for (const x of ev.target.result || []) {
                if (x && x.value && x.value.stsTokenManager) users.push(Object.assign({ apiKey: String(x.fbase_key || "").split(":")[2] }, x.value));
              }
              res();
            };
            g.onerror = () => res();
          } catch (_) { res(); }
        };
      } catch (_) { res(); }
    });
    const user = users.find(u => u.stsTokenManager && u.stsTokenManager.accessToken);
    if (!user) {
      show("로그인 정보를 찾지 못했어요", "룸에 완전히 입장한 뒤(이름을 정하고 들어간 상태) 다시 눌러주세요.\n그래도 안 되면 사이트 관리 화면의 붙여넣기 방법을 써 주세요.");
      return;
    }
    const stm = user.stsTokenManager;
    let token = stm.accessToken;
    let refreshed = false;
    // 저장된 토큰은 1시간이면 만료되므로 필요하면 새로 받는다
    const refresh = async () => {
      refreshed = true;
      if (!stm.refreshToken || !user.apiKey) return;
      try {
        const r = await fetch("https://securetoken.googleapis.com/v1/token?key=" + encodeURIComponent(user.apiKey), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(stm.refreshToken),
        });
        const j = await r.json();
        if (j.id_token || j.access_token) token = j.id_token || j.access_token;
      } catch (_) {}
    };
    if (!stm.expirationTime || stm.expirationTime < Date.now() + 60000) await refresh();

    const val = v => v == null ? null
      : "stringValue" in v ? v.stringValue
      : "integerValue" in v ? +v.integerValue
      : "doubleValue" in v ? v.doubleValue
      : "booleanValue" in v ? v.booleanValue
      : "arrayValue" in v ? (v.arrayValue.values || []).map(val)
      : "mapValue" in v ? obj(v.mapValue.fields) : null;
    const obj = f => { const o = {}; for (const k in f || {}) o[k] = val(f[k]); return o; };
    const base = "https://firestore.googleapis.com/v1/projects/ccfolia-160aa/databases/(default)/documents/rooms/" + roomId + "/characters?pageSize=300";
    const get = async url => {
      let r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
      if ((r.status === 401 || r.status === 403) && !refreshed) {
        await refresh();
        r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
      }
      return r;
    };

    const characters = [];
    let page = "";
    do {
      const r = await get(base + (page ? "&pageToken=" + encodeURIComponent(page) : ""));
      let j = {};
      try { j = await r.json(); } catch (_) {}
      if (!r.ok || j.error) {
        show("불러오기 실패 (" + r.status + ")",
          (j.error && j.error.message || "") + "\n\n· 룸에 입장한 상태인지 확인해주세요.\n· 페이지를 새로고침한 뒤 다시 눌러보세요.\n· 그래도 안 되면 사이트 관리 화면의 붙여넣기 방법을 써 주세요.");
        return;
      }
      for (const d of j.documents || []) {
        const c = obj(d.fields);
        characters.push({
          name: c.name || "", color: c.color || "", iconUrl: c.iconUrl || "",
          faces: (c.faces || []).filter(f => f && f.iconUrl).map(f => ({ label: f.label || "", iconUrl: f.iconUrl })),
        });
      }
      page = j.nextPageToken;
    } while (page);

    if (!characters.length) {
      show("이 룸에 캐릭터가 없어요", "룸 ID: " + roomId + "\n캐릭터(말)가 있는 룸에서 다시 눌러주세요.");
      return;
    }
    const faceCount = characters.reduce((n, c) => n + c.faces.length, 0);
    show("캐릭터 " + characters.length + "명 · 표정 " + faceCount + "개를 불러왔어요",
      "'복사하고 닫기'를 누른 뒤 사이트 관리 화면의 붙여넣기 칸에 넣고 '적용'을 눌러주세요.",
      JSON.stringify({ kind: "nabicoco-standing", roomId, characters }));
  })().catch(err => show("오류가 났어요", String(err && err.message || err) + "\n\n사이트 관리 화면의 붙여넣기 방법을 써 주세요."));
}
export const BOOKMARKLET = "javascript:" + encodeURIComponent("(" + ccfoliaStandingExporter.toString() + ")()");
