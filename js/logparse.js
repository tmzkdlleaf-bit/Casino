/* =========================================================
   코코포리아 로그 → 사이트용 기록(JSON)  (관리 페이지에서만 불러옴)
   파서는 나비코코 로그 변환기(index.html)의 parseLog 규칙을 그대로 따름
     HTML: <p style="color:…"><span>[탭]</span><span>이름</span> : <span>본문<br>…</span></p>
     텍스트: [탭]이름：본문
   저장 형식(작게): { v, src, n, tabs:[[이름, 형식]], sp:[[이름, 색, 나레이션]], m:[[탭번호, 화자번호, 본문]] }
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

export function pack(messages, { include, narrators, stripTag, src }){
  const tabIdx = new Map(), spIdx = new Map(), tabs = [], sp = [], m = [];
  for (const x of messages){
    if (!include.has(x.tab)) continue;
    let text = stripTag ? x.text.replace(FACE_TAG, "").trim() : x.text;
    if (!text) continue;
    if (!tabIdx.has(x.tab)){ tabIdx.set(x.tab, tabs.length); tabs.push([x.tab, guessTabFormat(x.tab)]); }
    const key = x.name + "\u0000" + x.color;
    if (!spIdx.has(key)){ spIdx.set(key, sp.length); sp.push([x.name, x.color, narrators.has(x.name) ? 1 : 0]); }
    m.push([tabIdx.get(x.tab), spIdx.get(key), text]);
  }
  return { v: 1, src: src || "", n: m.length, tabs, sp, m };
}
