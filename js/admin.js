import { loadMine } from "./auth.js?v=20261031f";
import { CONFIG, idOf } from "./config.js?v=20261031f";
import { CAT, CURRENCY, FOCUS, LOGS, ROLE, USE_DB, fmtDate, fmtTime, parseFocus, publicUrl, refreshPublic, sb } from "./data.js?v=20261031f";
import { $, $$, CUR, announce, chipAmt, esc, toast } from "./dom.js?v=20261031f";
import { checkField, errMsg, fieldError, showMsg, validateForm, withBusy } from "./forms.js?v=20261031f";
import { renderMarkdown } from "./markdown.js?v=20261031f";
import { extOf, toWebP } from "./img.js?v=20261031f";   // 이미지 변환 (룰렛 자리 이미지와 같이 씀)
import { state } from "./state.js?v=20261031f";
import { ALL, renderAccount } from "./views.js?v=20261031f";

/* =========================================================
   ADMIN — 관리 페이지. 화면만 관리자에게 보이고, 실제 차단은 RLS + RPC가 담당
   ========================================================= */
export const ADM = { tab: "characters", rows: {}, sel: null, dirty: false, tabsDrawn: false };

/* 탭은 묶음별로: 승인 대기 · 내용 · 게임 · 멤버 (묶음 사이는 간격으로만 나눔) */
export const ADMIN_GROUPS = [
  [["shop", "구매 요청"], ["chipreq", "코인 정산"]],
  [["characters", "캐릭터"], ["items", "아이템"], ["chapters", "지난 이야기"]],
  [["game_slots", "게임 일정"], ["game_records", "전적"]],
  [["members", "멤버"], ["backup", "백업"]]
];
export const ADMIN_TABS = ADMIN_GROUPS.flat();
ADM.badge = { shop: 0, chipreq: 0 };

export const OPT = {
  kind: [["dealer", "직원"], ["player", "참가자"]],
  suit: [["spade", "♠ 스페이드"], ["heart", "♥ 하트"], ["club", "♣ 클럽"], ["diamond", "♦ 다이아"]],
  chip: [["green", "남색"], ["red", "분홍"]],
  currency: [["blue", "블루 코인"], ["pink", "핑크 코인"]]
};

/* 캐릭터 입력 칸 — 이미지 초점(image_focus)은 update-4.sql을 실행한 DB에서만 보임 */
const CHAR_FIELDS = [
  { row: [
    { k: "name", label: "이름", type: "text", required: true, max: 40 },
    { k: "slug", label: "주소", type: "text", required: true, max: 40, pattern: "[a-z0-9\\-]+", patternMsg: "영문 소문자, 숫자, 하이픈(-)만 쓸 수 있습니다.", prefix: "#characters/", ph: "lune" }
  ] },
  { row: [
    { k: "kind", label: "구분", type: "select", required: true, options: () => OPT.kind },
    { k: "role_title", label: "역할", type: "text", max: 20, ph: "바텐더" }
  ] },
  { row: [
    { k: "sort_order", label: "표시 순서", type: "number", min: 0 }
  ] },
  { row: [
    { k: "suit", label: "카드 무늬 (직원)", type: "select", options: () => [["", "없음"], ...OPT.suit] },
    { k: "chip_color", label: "표시 색 (참가자)", type: "select", options: () => [["", "없음"], ...OPT.chip] }
  ] },
  { row: [
    { k: "age", label: "나이", type: "text", max: 20 },
    { k: "height", label: "키", type: "text", max: 20 }
  ] },
  { k: "keywords", label: "성격", type: "tags", ph: "침착, 계산적" },
  { k: "description", label: "설명", type: "textarea" },
  { k: "image_path", thumbKey: "thumb_path", label: "캐릭터 이미지", type: "image", bucket: "characters", max: CONFIG.IMG.character, thumb: CONFIG.IMG.characterThumb, tall: true },
  { k: "image_focus", label: "보이는 위치", type: "focus", img: "image_path", thumbKey: "thumb_path", bucket: "characters" }
];

export const SCHEMAS = {
  characters: {
    label: "캐릭터", key: "id", touch: true, needs: ["items"],
    get select(){ return `id, slug, name, kind${ROLE.ok ? ", role_title" : ""}, suit, chip_color, image_path, thumb_path${FOCUS.ok ? ", image_focus" : ""}, age, height, keywords, description, sort_order`; },
    order: [["sort_order"]],
    title: r => r.name, meta: r => `${r.role_title || (r.kind === "dealer" ? "직원" : "참가자")} · ${r.slug}`,
    get fields(){ return CHAR_FIELDS.map(f => f.row ? { row: f.row.filter(x => x.k !== "role_title" || ROLE.ok) } : f).filter(f => (f.k !== "image_focus" || FOCUS.ok) && (!f.row || f.row.length)); },
    after: row => `
      <section class="card sub-editor" aria-labelledby="inv-h">
        <h3 id="inv-h">소지품</h3>
        <div class="inv-rows" id="inv-rows"><p class="adm-status">불러오는 중…</p></div>
        <div class="form-actions">
          <button class="btn small" type="button" data-inv-add>+ 칸</button>
          <button class="btn primary" type="button" data-inv-save data-char="${esc(row.id)}">소지품 저장</button>
        </div>
        <p class="adm-status" id="inv-status" role="status"></p>
      </section>`
  },
  items: {
    label: "아이템", key: "id", touch: true, get select(){ return `id, name, description, image_path, price, stock, is_for_sale, sort_order${CURRENCY.ok ? ", currency" : ""}${CAT.ok ? ", category" : ""}`; }, order: [["sort_order"]],
    title: r => r.name, meta: r => [r.category, r.is_for_sale ? `판매 ${r.currency === "pink" ? "핑크" : "블루"} ${r.price ?? 0}` : "비매품", r.stock != null ? `재고 ${r.stock}` : ""].filter(Boolean).join(" · "),
    fields: [
      { row: [
        { k: "name", label: "이름", type: "text", required: true, max: 40 },
        { k: "category", label: "분류", type: "text", max: 20, ph: "예: 파츠" }
      ] },
      { k: "description", label: "설명", type: "textarea" },
      { row: [
        { k: "price", label: "가격", type: "number", min: 0, nullable: true, ph: "코인", suffix: "코인" },
        { k: "currency", label: "코인 종류", type: "select", required: true, options: () => OPT.currency }
      ] },
      { k: "stock", label: "재고", type: "number", min: 0, nullable: true, ph: "무제한" },
      { row: [
        { k: "is_for_sale", label: "상점에 표시", type: "check" },
        { k: "sort_order", label: "표시 순서", type: "number", min: 0 }
      ] },
      { k: "image_path", label: "아이템 이미지", type: "image", bucket: "items", max: CONFIG.IMG.item }
    ]
  },
  game_slots: {
    label: "게임 일정", key: "id", needs: ["characters"],
    select: "id, game, dealer_character_id, starts_at, ends_at, memo", order: [["starts_at", { ascending: false }]],
    title: r => r.game || "(게임 이름 없음)",
    meta: r => [(ADM.rows.characters || []).find(c => c.id === r.dealer_character_id)?.name, fmtDate(r.starts_at)].filter(Boolean).join(" · "),
    fields: [
      { row: [
        { k: "game", label: "게임", type: "text", required: true, max: 40 },
        { k: "dealer_character_id", label: "딜러", type: "select", options: () => [["", "정하지 않음"], ...(ADM.rows.characters || []).filter(c => c.kind === "dealer").map(c => [c.id, c.name])] }
      ] },
      { row: [
        { k: "starts_at", label: "시작", type: "datetime", required: true },
        { k: "ends_at", label: "끝", type: "datetime" }
      ] },
      { k: "memo", label: "메모", type: "textarea", ph: "공개 칸 — 비밀 내용은 적지 마세요" }
    ]
  },
  game_records: {
    label: "전적", key: "id", needs: ["characters"],
    select: "id, played_at, game_name, winner_id, participant_ids, chips, note", order: [["played_at", { ascending: false }]],
    title: r => `${r.game_name || "게임"} · ${(ADM.rows.characters || []).find(c => c.id === r.winner_id)?.name || "승자 없음"}`,
    meta: r => r.played_at ? `${fmtDate(r.played_at)} ${fmtTime(r.played_at)}` : "",
    fields: [
      { row: [
        { k: "game_name", label: "게임", type: "text", required: true, max: 40, ph: "블랙잭" },
        { k: "played_at", label: "일시", type: "datetime" }
      ] },
      { row: [
        { k: "winner_id", label: "승자", type: "select", options: () => [["", "없음 (무승부 등)"], ...(ADM.rows.characters || []).map(c => [c.id, `${c.name} (${c.kind === "dealer" ? "직원" : "참가자"})`])] },
        { k: "chips", label: "코인 (표시용)", type: "number" }
      ] },
      { k: "participant_ids", label: "참가한 캐릭터", type: "multi", options: () => (ADM.rows.characters || []).map(c => [c.id, c.name]) },
      { k: "note", label: "메모", type: "text", max: 120 }
    ]
  },
  chapters: {
    label: "지난 이야기", key: "id", touch: true, order: [["number", { ascending: false }]],
    get select(){ return `id, number, title, summary, body, played_on${LOGS.ok ? ", log_path" : ""}`; },
    title: r => `제${r.number}화 ${r.title || ""}`, meta: r => [fmtDate(r.played_on), r.log_path ? "기록 있음" : ""].filter(Boolean).join(" · "),
    fields: [
      { row: [
        { k: "number", label: "회차", type: "number", required: true, min: 1 },
        { k: "played_on", label: "진행일", type: "date" }
      ] },
      { k: "title", label: "제목", type: "text", required: true, max: 80 },
      { k: "summary", label: "요약", type: "textarea" },
      { k: "body", label: "본문 (화면 미표시)", type: "textarea" }
    ],
    after: row => LOGS.ok ? `
      <section class="card sub-editor" aria-labelledby="log-h">
        <h3 id="log-h">진행 기록</h3>
        <p class="adm-status" id="log-now">${row.log_path ? `저장된 기록이 있습니다 — <a href="#story/${esc(String(row.number))}">보기</a>` : "아직 저장된 기록이 없습니다."}</p>
        <div class="field"><label class="file-btn btn" for="log-file">코코포리아 로그 파일 고르기 (.html · .txt)</label><input class="sr" type="file" id="log-file" accept=".html,.htm,.txt" aria-describedby="log-file-err"><span class="field-error" id="log-file-err" hidden></span></div>
        <div id="log-opts"></div>
        <div class="form-actions">
          <button class="btn primary" type="button" data-log-save data-id="${esc(row.id)}" disabled>기록 저장</button>
          ${row.log_path ? `<button class="btn danger" type="button" data-log-del data-id="${esc(row.id)}">기록 삭제</button>` : ""}
        </div>
        <p class="adm-status" id="log-status" role="status"></p>
      </section>` : `<section class="card sub-editor"><p class="hint">진행 기록을 붙이려면 Supabase에서 supabase/update-3.sql을 먼저 실행해 주세요.</p></section>`
  }
};

export const flatFields = s => s.fields.flatMap(f => f.row || [f]);

export const admPanel = () => $("#admin-panel");

export const admStatus = msg => { const el = $("#adm-status"); if (el) el.textContent = msg; };

export function admDrawTabs(){
  $("#admin-tabs").innerHTML = ADMIN_GROUPS.map(g => g.map(([id, label]) => {
    const n = ADM.badge[id] || 0;
    return `<button type="button" role="tab" id="tab-${id}" data-tab="${id}" aria-controls="admin-panel" aria-selected="${id === ADM.tab}" tabindex="${id === ADM.tab ? 0 : -1}">${label}${n ? `<span class="badge-n"><span class="sr"> 대기 </span>${n}</span>` : ""}</button>`;
  }).join("")).join(`<span class="tab-gap" aria-hidden="true"></span>`);
  admPanel().setAttribute("aria-labelledby", "tab-" + ADM.tab);
}

export async function admLoad(table){
  const s = SCHEMAS[table];
  let q = sb.from(table).select(s.select);
  for (const [col, opt] of s.order) q = q.order(col, opt || {});
  const { data, error } = await q;
  if (error) throw error;
  ADM.rows[table] = data;
}

/* 관리 전용 스타일은 여기서 한 번만 붙임 */
function ensureAdminCss(){
  if (document.getElementById("admin-css")) return;
  const l = document.createElement("link");
  l.id = "admin-css"; l.rel = "stylesheet"; l.href = "css/admin.css?v=20261031f";
  document.head.append(l);
}

/* 승인 대기 개수 (탭의 숫자) */
async function admCounts(){
  const [a, b] = await Promise.all([
    sb.from("shop_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    sb.from("chip_requests").select("id", { count: "exact", head: true }).eq("status", "pending")
  ]);
  ADM.badge = { shop: a.error ? 0 : a.count || 0, chipreq: b.error ? 0 : b.count || 0 };
}

export async function admOpen(){
  if (!USE_DB || !state.isAdmin) return;
  ensureAdminCss();
  await admCounts();
  if (ADM.first !== false){ ADM.first = false; if (ADM.badge.shop) ADM.tab = "shop"; else if (ADM.badge.chipreq) ADM.tab = "chipreq"; }   // 처음 열 때 대기 중인 요청이 있으면 그쪽부터
  admDrawTabs();
  await admShow(ADM.tab);
}

export async function admShow(tab){
  ADM.tab = tab;
  admDrawTabs();
  const panel = admPanel();
  panel.innerHTML = `<p class="adm-status" role="status">불러오는 중…</p>`;
  try {
    if (tab === "members"){ await admMembers(); return; }
    if (tab === "backup"){ admBackup(); return; }
    if (tab === "shop"){ await admShop(); return; }
    if (tab === "chipreq"){ await admChipReq(); return; }
    const s = SCHEMAS[tab];
    await Promise.all([admLoad(tab), ...(s.needs || []).map(admLoad)]);
    admRenderCrud(tab);
  } catch (err){
    const sqlFor = { game_records: "update-5.sql", shop: "update-7.sql", chipreq: "update-9.sql" }[tab];
    const missing = sqlFor && /42P01|PGRST205|game_records|shop_requests|chip_requests/.test(`${err?.code} ${err?.message}`);
    panel.innerHTML = missing
      ? `<p class="form-note">이 기능의 표가 아직 없습니다. Supabase → SQL Editor에서 <strong>supabase/${sqlFor}</strong>을 한 번 실행한 뒤 이 화면을 새로 고침해 주세요.</p>`
      : `<p class="form-error" role="alert">${esc(errMsg(err))}</p>`;
  }
}

export function admRenderCrud(table){
  const s = SCHEMAS[table], rows = ADM.rows[table] || [];
  const sel = ADM.sel == null ? null : String(ADM.sel);
  admPanel().innerHTML = `
    <div class="adm">
      <div class="adm-list">
        <div class="adm-new-row"><button class="btn primary" type="button" data-adm-new>새 ${s.label} 추가</button>${table === "items" ? `<button class="btn" type="button" data-adm-bulk>여러 장</button>` : ""}</div>
        <ul aria-label="${s.label} 목록">
          ${rows.length ? rows.map(r => `<li><button type="button" data-adm-sel="${esc(String(r[s.key]))}" aria-current="${sel === String(r[s.key])}">
            <span class="t">${esc(s.title(r) || "(제목 없음)")}</span>${s.meta ? `<span class="m">${esc(s.meta(r) || "")}</span>` : ""}</button></li>`).join("")
            : `<li class="empty">아직 없습니다.</li>`}
        </ul>
      </div>
      <div class="adm-editor" id="adm-editor"></div>
    </div>`;
  admRenderEditor(table);
}

export const toLocalInput = iso => {
  if (!iso) return "";
  const d = new Date(iso), z = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
};

export function admField(table, f, v){
  const id = `f-${table}-${f.k}`, val = v[f.k];
  const hint = f.hint ? `<span class="hint" id="${id}-hint">${esc(f.hint)}</span>` : "";
  const ph = f.ph ? ` placeholder="${esc(f.ph)}"` : "";
  const err = `<span class="field-error" id="${id}-err" hidden></span>`;
  const desc = `aria-describedby="${f.hint ? id + "-hint " : ""}${id}-err"`;
  const req = f.required ? " required" : "";
  const label = `<label for="${id}">${esc(f.label)}${f.required ? ` <span aria-hidden="true">*</span>` : ""}</label>`;
  switch (f.type){
    case "check":
      return `<div class="field"><label class="check"><input type="checkbox" name="${f.k}" id="${id}"${val ? " checked" : ""}>${esc(f.label)}</label>${hint}</div>`;
    case "select":
      return `<div class="field">${label}<select class="input" name="${f.k}" id="${id}"${req} ${desc}>${f.options().map(([ov, ol]) =>
        `<option value="${esc(ov)}"${String(val ?? "") === String(ov) ? " selected" : ""}>${esc(ol)}</option>`).join("")}</select>${hint}${err}</div>`;
    case "textarea":
      return `<div class="field">${label}<textarea class="input" name="${f.k}" id="${id}" rows="5"${ph}${req} ${desc}>${esc(val ?? "")}</textarea>${hint}${err}</div>`;
    case "markdown":
      return `<div class="field">${label}
        <div class="md-tools"><button class="btn small" type="button" data-md-preview="${id}" aria-pressed="false" aria-controls="${id} ${id}-prev">미리보기</button></div>
        <textarea class="input" name="${f.k}" id="${id}" rows="12"${req} ${desc}>${esc(val ?? "")}</textarea>
        <div class="md-preview md" id="${id}-prev" hidden tabindex="0" aria-label="미리보기"></div>${hint}${err}</div>`;
    case "number":
      return `<div class="field">${label}<input class="input" type="number" inputmode="numeric" step="1" name="${f.k}" id="${id}" value="${val ?? ""}"${f.min != null ? ` min="${f.min}"` : ""}${ph}${req} ${desc}>${hint}${err}</div>`;
    case "datetime":
      return `<div class="field">${label}<input class="input" type="datetime-local" name="${f.k}" id="${id}" value="${toLocalInput(val)}"${req} ${desc}>${hint}${err}</div>`;
    case "date":
      return `<div class="field">${label}<input class="input" type="date" name="${f.k}" id="${id}" value="${esc(val ?? "")}"${req} ${desc}>${hint}${err}</div>`;
    case "multi":
      return `<fieldset class="field multi-f" aria-describedby="${f.hint ? id + "-hint" : ""}"><legend>${esc(f.label)}</legend>
        <div class="multi">${f.options().map(([ov, ol]) => `<label class="check"><input type="checkbox" name="${f.k}" value="${esc(ov)}"${(val || []).includes(ov) ? " checked" : ""}>${esc(ol)}</label>`).join("") || `<span class="hint">캐릭터가 없습니다.</span>`}</div>${hint}</fieldset>`;
    case "tags":
      return `<div class="field">${label}<input class="input" type="text" name="${f.k}" id="${id}" value="${esc((val || []).join(", "))}"${ph}${req} ${desc}>${hint}${err}</div>`;
    case "image": {
      // 미리보기 칸 자체가 '올리기' 버튼 — 누르면 파일 고르기
      const url = val ? publicUrl(f.bucket, (f.thumbKey && v[f.thumbKey]) || val) : "";
      return `<div class="field img-f">
        <label class="img-drop${f.tall ? " tall" : ""}" for="${id}">
          <span class="img-prev" id="${id}-prev">${url ? `<img src="${esc(url)}" alt="">` : `<span class="img-plus" aria-hidden="true">+</span>`}</span>
          <span class="img-cap">${esc(f.label)}</span>
          <input class="sr" type="file" accept="image/*" name="${f.k}" id="${id}" ${desc}>
        </label>
        ${val ? `<label class="check img-del"><input type="checkbox" name="${f.k}__remove">삭제</label>` : ""}${err}</div>`;
    }
    case "focus": {
      const [x, y] = parseFocus(val) || [50, 15];
      const src = v[f.img] ? publicUrl(f.bucket, v[f.thumbKey] || v[f.img]) : "";
      if (!src) return `<input type="hidden" name="${f.k}" id="${id}" value="${esc(val ?? "")}">`;
      const pos = `object-position:${x}% ${y}%`;
      return `<details class="focus-d"${val ? " open" : ""}><summary>${esc(f.label)}</summary>
        <fieldset class="focus-f" data-focus><legend class="sr">${esc(f.label)}</legend>
        <div class="focus-prev" aria-hidden="true">${[["wide", "홈"], ["tall", "목록"], ["sq", "프로필"]].map(([k, t]) =>
          `<span class="fp ${k}"><img src="${esc(src)}" alt="" style="${pos}"><small>${t}</small></span>`).join("")}</div>
        <label class="rng"><span>가로</span><input type="range" min="0" max="100" step="1" value="${x}" data-axis="x"><output>${x}</output></label>
        <label class="rng"><span>세로</span><input type="range" min="0" max="100" step="1" value="${y}" data-axis="y"><output>${y}</output></label>
        <input type="hidden" name="${f.k}" id="${id}" value="${esc(val ?? "")}">
        <button class="btn small" type="button" data-focus-reset>기본 위치로</button><span class="sr focus-state"></span>
        </fieldset></details>`;
    }
    default:
      if (f.prefix) return `<div class="field">${label}<div class="input-pre"><span aria-hidden="true">${esc(f.prefix)}</span><input class="input" type="text" name="${f.k}" id="${id}" value="${esc(val ?? "")}"${f.max ? ` maxlength="${f.max}"` : ""}${f.pattern ? ` pattern="${esc(f.pattern)}" data-pattern-msg="${esc(f.patternMsg || "")}"` : ""}${ph}${req} ${desc}></div>${hint}${err}</div>`;
      return `<div class="field">${label}<input class="input" type="text" name="${f.k}" id="${id}" value="${esc(val ?? "")}"${ph}${f.max ? ` maxlength="${f.max}"` : ""}${f.pattern ? ` pattern="${esc(f.pattern)}" data-pattern-msg="${esc(f.patternMsg || "")}"` : ""}${req} ${desc}>${hint}${err}</div>`;
  }
}

export function admCurrentRow(table){
  const s = SCHEMAS[table];
  return ADM.sel == null ? null : (ADM.rows[table] || []).find(r => String(r[s.key]) === String(ADM.sel)) || null;
}

export function admRenderEditor(table){
  const s = SCHEMAS[table], row = admCurrentRow(table), v = row || (table === "items" ? { is_for_sale: true } : {});
  const media = f => f.type === "image" || f.type === "focus";
  const draw = list => list.map(f => f.row ? `<div class="row2">${f.row.map(x => admField(table, x, v)).join("")}</div>` : admField(table, f, v)).join("");
  const main = s.fields.filter(f => !media(f)), side = s.fields.filter(media);
  const gameImg = table === "characters" && row ? `
        <div class="field img-f" id="gimg-f">
          <label class="img-drop sq" for="gimg-file">
            <span class="img-prev" id="gimg-prev"><span class="img-plus" aria-hidden="true">…</span></span>
            <span class="img-cap">게임용 이미지</span>
            <input class="sr" type="file" id="gimg-file" accept="image/*">
          </label>
          <label class="check img-del" id="gimg-del-l" hidden><input type="checkbox" id="gimg-del">삭제</label>
        </div>` : "";
  $("#adm-editor").innerHTML = `
    <form class="form card adm-form${side.length ? " has-media" : ""}" id="adm-form" data-table="${table}" novalidate aria-labelledby="adm-form-h">
      <h2 class="card-h" id="adm-form-h" tabindex="-1">${row ? esc(s.title(row) || "(제목 없음)") : `새 ${s.label}`}</h2>
      <p class="form-error" id="adm-error" role="alert" hidden></p>
      <div class="adm-cols">
        <div class="adm-main">${draw(main)}</div>
        ${side.length ? `<aside class="adm-media" aria-label="이미지">${draw(side)}${gameImg}</aside>` : ""}
      </div>
      <div class="adm-actions">
        <button class="btn primary" type="submit">${row ? "저장" : "추가"}</button>
        <span class="adm-status" id="adm-status" role="status"></span>
        ${row ? `<button class="btn small danger adm-del" type="button" data-adm-del>삭제</button>` : ""}
      </div>
    </form>
    ${row && s.after ? s.after(row) : ""}`;
  state.admDirty = false;
  if (row && table === "characters"){ admLoadInventory(row.id); admLoadGameImg(row.id); }
}

export function admCollect(form, s){
  const out = {};
  for (const f of flatFields(s)){
    if (f.type === "multi"){ out[f.k] = $$(`input[name="${f.k}"]:checked`, form).map(i => i.value); continue; }
    const el = form.elements[f.k];
    if (!el || f.type === "image") continue;
    const raw = typeof el.value === "string" ? el.value.trim() : el.value;
    switch (f.type){
      case "check": out[f.k] = el.checked; break;
      case "number": out[f.k] = raw === "" ? (f.nullable ? null : 0) : Number(raw); break;   // 대부분 NOT NULL default 0
      case "tags": out[f.k] = raw.split(/[,，、]/).map(t => t.trim()).filter(Boolean); break;
      case "datetime": out[f.k] = raw ? new Date(raw).toISOString() : (f.k === "played_at" ? new Date().toISOString() : null); break;
      case "select": case "date": case "focus": out[f.k] = raw === "" ? null : raw; break;
      default: out[f.k] = raw;   // 텍스트는 빈 문자열 그대로 (NOT NULL default '' 컬럼)
    }
  }
  if (s.touch) out.updated_at = new Date().toISOString();
  return out;
}

export async function admSave(form){
  const table = form.dataset.table, s = SCHEMAS[table], row = admCurrentRow(table);
  showMsg($("#adm-error"), "");
  if (!validateForm(form)) return;
  const vals = admCollect(form, s);
  const imgF = flatFields(s).find(f => f.type === "image");
  const uploaded = [], oldPaths = [];
  try {
    if (imgF){
      const file = form.elements[imgF.k].files[0], remove = form.elements[imgF.k + "__remove"]?.checked;
      if (file){
        admStatus("이미지 변환 중…");
        const base = `${(vals.slug || table).replace(/[^a-z0-9-]/gi, "")}-${Date.now()}`;
        const jobs = [[imgF.k, imgF.max, ""], ...(imgF.thumbKey ? [[imgF.thumbKey, imgF.thumb, "-" + imgF.thumb]] : [])];
        for (const [key, size, suffix] of jobs){
          const blob = await toWebP(file, size), path = `${base}${suffix}.${extOf(blob)}`;
          admStatus("이미지 올리는 중…");
          const { error } = await sb.storage.from(imgF.bucket).upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
          if (error) throw error;
          uploaded.push(path); vals[key] = path;
        }
      } else if (remove && row){
        vals[imgF.k] = null; if (imgF.thumbKey) vals[imgF.thumbKey] = null;
      }
      if (row && (file || remove)) oldPaths.push(...[row[imgF.k], imgF.thumbKey && row[imgF.thumbKey]].filter(Boolean));
    }
    admStatus("저장 중…");
    const q = row ? sb.from(table).update(vals).eq(s.key, row[s.key]) : sb.from(table).insert(vals);
    const { data, error } = await q.select(s.select).single();
    if (error) throw error;
    if (oldPaths.length) sb.storage.from(imgF.bucket).remove(oldPaths);   // 이전 파일 정리 (실패해도 무시)
    if (table === "characters" && row) await saveGameImgWith(row.id).catch(err => toast("게임용 이미지는 저장하지 못했습니다: " + errMsg(err)));
    ADM.sel = data[s.key];
    await admLoad(table);
    admRenderCrud(table);
    admStatus(row ? "저장했습니다." : "추가했습니다.");
    toast(row ? "저장했습니다" : "추가했습니다");
    $("#adm-form-h")?.focus();
    refreshPublic();
  } catch (err){
    if (uploaded.length) sb.storage.from(imgF.bucket).remove(uploaded);   // 반쪽 저장된 이미지 정리
    admStatus("");
    showMsg($("#adm-error"), errMsg(err));
    $("#adm-error").scrollIntoView({ block: "nearest" });
  }
}

export async function admDelete(){
  const table = ADM.tab, s = SCHEMAS[table], row = admCurrentRow(table);
  if (!row || !confirm(`‘${s.title(row)}’을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
  try {
    if (table === "characters"){
      const { error } = await sb.rpc("admin_set_inventory", { p_character: row.id, p_rows: [] });
      if (error) throw error;
    }
    const { error } = await sb.from(table).delete().eq(s.key, row[s.key]);
    if (!error && table === "chapters" && row.log_path) sb.storage.from("logs").remove([row.log_path]);   // 붙어 있던 기록 파일도 정리
    if (error) throw error;
    const imgF = flatFields(s).find(f => f.type === "image");
    if (imgF){ const paths = [row[imgF.k], imgF.thumbKey && row[imgF.thumbKey]].filter(Boolean); if (paths.length) sb.storage.from(imgF.bucket).remove(paths); }
    ADM.sel = null;
    await admLoad(table);
    admRenderCrud(table);
    toast("삭제했습니다");
    admStatus("삭제했습니다.");
    $('[data-adm-new]', admPanel())?.focus();
    refreshPublic();
  } catch (err){ showMsg($("#adm-error"), errMsg(err)); }
}

/* ----- 캐릭터 소지품 ----- */
export function invRowHtml(r = {}, i = 0){
  const items = ADM.rows.items || [];
  return `<div class="inv-row" data-inv-row>
    <div class="field"><label for="inv-item-${i}">아이템</label>
      <select class="input" id="inv-item-${i}" data-k="item_id"><option value="">선택</option>${items.map(it =>
        `<option value="${esc(it.id)}"${it.id === r.item_id ? " selected" : ""}>${esc(it.name)}</option>`).join("")}</select></div>
    <div class="field"><label for="inv-qty-${i}">수량</label>
      <input class="input" type="number" inputmode="numeric" min="1" step="1" id="inv-qty-${i}" data-k="quantity" value="${r.quantity ?? 1}"></div>
    <div class="field note"><label for="inv-note-${i}">캐릭터별 메모</label>
      <input class="input" type="text" id="inv-note-${i}" data-k="note" maxlength="80" value="${esc(r.note ?? "")}"></div>
    <button class="btn small danger" type="button" data-inv-del aria-label="${i + 1}번째 칸 삭제">삭제</button>
  </div>`;
}

export let invSeq = 0;

export async function admLoadInventory(charId){
  const box = $("#inv-rows");
  const { data, error } = await sb.from("inventory").select("item_id, quantity, note, sort_order").eq("character_id", charId).order("sort_order");
  if (!box.isConnected) return;
  if (error){ box.innerHTML = `<p class="form-error" role="alert">${esc(errMsg(error))}</p>`; return; }
  box.innerHTML = data.length ? data.map(r => invRowHtml(r, invSeq++)).join("") : `<p class="adm-status" data-inv-empty>소지품이 없습니다.</p>`;
}

export async function admSaveInventory(btn){
  const rows = $$("#inv-rows [data-inv-row]").map(el => ({
    item_id: $('[data-k="item_id"]', el).value,
    quantity: Math.max(1, parseInt($('[data-k="quantity"]', el).value, 10) || 1),
    note: $('[data-k="note"]', el).value.trim()
  })).filter(r => r.item_id);
  await withBusy(btn, async () => {
    const { error } = await sb.rpc("admin_set_inventory", { p_character: btn.dataset.char, p_rows: rows });
    $("#inv-status").textContent = error ? errMsg(error) : `소지품 ${rows.length}칸을 저장했습니다.`;
    if (!error){ state.admDirty = false; toast("소지품을 저장했습니다"); refreshPublic(); }
  });
}

/* ----- 멤버 · 캐릭터별 코인 ----- */
/* =========================================================
   백업: 모든 표를 JSON 파일 하나로 내려받음 (이미지 파일 자체는 빠지고 경로만 들어감)
   ========================================================= */
const BACKUP_TABLES = ["profiles", "characters", "inventory", "items", "chapters", "log_secrets", "logs", "notices", "notice_categories",
  "chip_ledger", "shop_requests", "chip_requests", "game_slots", "game_records",
  "roulette_rooms", "roulette_seats", "roulette_bets", "roulette_chat", "roulette_avatars", "bj_tables", "bj_chat"];
const BACKUP_LABEL = { profiles: "멤버", characters: "캐릭터", inventory: "소지품", items: "상점 아이템", chapters: "지난 이야기", log_secrets: "기록 비밀 탭", logs: "로그", notices: "공지", notice_categories: "공지 분류",
  chip_ledger: "코인 기록", shop_requests: "구매 요청", chip_requests: "코인 정산 요청", game_slots: "게임 일정", game_records: "전적",
  roulette_rooms: "룰렛 방", roulette_seats: "룰렛 자리", roulette_bets: "룰렛 베팅", roulette_chat: "룰렛 채팅", roulette_avatars: "룰렛 자리 이미지",
  bj_tables: "블랙잭 테이블", bj_seats: "블랙잭 자리", bj_chat: "블랙잭 채팅" };
function admBackup(){
  let last = null; try { last = localStorage.getItem("comu-backup-at"); } catch (_) {}
  admPanel().innerHTML = `<section class="card adm-backup">
    <h3 class="card-h">백업</h3>
    <p class="hint">캐릭터 · 코인 기록 · 구매 기록 · 게임 기록 전부를 파일 하나로 받습니다. 이미지는 빠집니다.</p>
    <div class="adm-backup-row"><button class="btn primary" type="button" id="bk-go">백업 받기</button>
      <span class="hint" id="bk-last">${last ? `마지막: ${esc(new Date(last).toLocaleString("ko-KR"))}` : ""}</span></div>
    <ul class="bk-list" id="bk-list" hidden></ul>
  </section>`;
  $("#bk-go").addEventListener("click", e => withBusy(e.currentTarget, admBackupRun));
}
async function fetchAll(table){
  const rows = [];
  for (let from = 0; ; from += 1000){
    let { data, error } = await sb.from(table).select("*").order("id").range(from, from + 999);
    if (error && /column .*id|42703/.test(`${error.code} ${error.message}`)) ({ data, error } = await sb.from(table).select("*").range(from, from + 999));
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
async function admBackupRun(){
  const out = { site: "Titfortat777", made_at: new Date().toISOString(), tables: {} }, list = $("#bk-list"), lines = [];
  list.hidden = false; list.innerHTML = "";
  for (const t of BACKUP_TABLES){
    try { out.tables[t] = await fetchAll(t); lines.push(`<li><span>${BACKUP_LABEL[t] || t}</span><b>${out.tables[t].length.toLocaleString("ko-KR")}</b></li>`); }
    catch (err){ if (!/42P01|PGRST205/.test(`${err?.code} ${err?.message}`)) lines.push(`<li class="bad"><span>${BACKUP_LABEL[t] || t}</span><b>실패</b></li>`); }
    list.innerHTML = lines.join("");
  }
  const d = new Date(), p = v => String(v).padStart(2, "0");
  const name = `titfortat777-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  try { localStorage.setItem("comu-backup-at", out.made_at); } catch (_) {}
  $("#bk-last").textContent = `마지막: ${d.toLocaleString("ko-KR")}`;
  toast("백업 파일을 내려받았습니다");
}

export async function admMembers(){
  const [pr, ch, bl] = await Promise.all([
    sb.from("profiles").select("id, email, display_name, role, created_at").order("created_at"),
    sb.from("characters").select("id, owner_id"),
    sb.from("chip_balances").select(CURRENCY.ok ? "character_id, balance, pink" : "character_id, balance")
  ]);
  const failed = [pr, ch, bl].find(r => r.error);
  if (failed) throw failed.error;
  const members = pr.data, owner = new Map(ch.data.map(c => [c.id, c.owner_id])), bal = new Map(bl.data.map(b => [b.character_id, b]));
  const chars = ALL();
  const nameOf = m => m.display_name || (m.email || "").split("@")[0] || "이름 없음";
  admPanel().innerHTML = `
    <div class="card adm-invite" id="adm-invite" hidden></div>
    <div class="card">
      <div class="g-head"><h2 class="card-h" style="margin:0">멤버</h2>
        <a class="btn small" style="margin-left:auto" href="https://supabase.com/dashboard/project/${esc(new URL(CONFIG.SUPABASE_URL).hostname.split(".")[0])}/auth/users" target="_blank" rel="noopener" title="Supabase → Add user">계정 직접 만들기<span class="sr"> (Supabase 대시보드, 새 창)</span> ↗</a></div>
      <div class="table-scroll">
        <table class="members" style="min-width:36rem">
          <caption class="sr">멤버 목록 — 이름, 권한, 소유 캐릭터, 비밀번호 초기화</caption>
          <thead><tr><th scope="col">멤버</th><th scope="col">권한</th><th scope="col">소유 캐릭터</th><th scope="col"><span class="sr">비밀번호</span></th></tr></thead>
          <tbody>${members.map(m => `<tr>
            <th scope="row" class="who" style="font-weight:400">${esc(nameOf(m))}<small>${esc(idOf(m.email))}</small></th>
            <td>${m.id === state.session?.user.id ? `<span class="tag-d">관리자 (나)</span>`
              : `<label class="sr" for="role-${m.id}">${esc(nameOf(m))} 권한</label><select class="input small-sel" id="role-${m.id}" data-role="${m.id}" data-prev="${m.role === "admin" ? "admin" : "member"}">
                  <option value="member"${m.role === "admin" ? "" : " selected"}>멤버</option><option value="admin"${m.role === "admin" ? " selected" : ""}>관리자</option></select>`}</td>
            <td>${esc(chars.filter(c => owner.get(c.uuid) === m.id).map(c => c.name).join(", ") || "—")}</td>
            <td class="pw-cell">${m.id === state.session?.user.id ? "" : `<button class="btn small" type="button" data-pwreset="${m.id}" data-name="${esc(nameOf(m))}">비밀번호 초기화</button>`}</td>
          </tr>`).join("") || `<tr><td colspan="4" class="muted">멤버가 없습니다.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
    <div class="card" style="margin-top:1.5rem">
      <h2 class="card-h">캐릭터 · 코인</h2>
      <div class="table-scroll">
        <table class="members">
          <caption class="sr">캐릭터별 소유 멤버, 보유 코인, 코인 지급·차감</caption>
          <thead><tr><th scope="col">캐릭터</th><th scope="col">주인</th><th scope="col">코인</th><th scope="col"><span class="sr">코인 지급·차감</span></th></tr></thead>
          <tbody>${chars.map(c => {
            const nm = esc(c.name), cur = owner.get(c.uuid) || "";
            return `<tr>
              <th scope="row" class="who" style="font-weight:400">${nm}<small>${c.role}</small></th>
              <td><label class="sr" for="own-${c.uuid}">${nm} 소유 멤버</label>
                <select class="input" id="own-${c.uuid}" data-owner="${c.uuid}" data-prev="${esc(cur)}">
                  <option value="">없음</option>
                  ${members.map(m => `<option value="${m.id}"${m.id === cur ? " selected" : ""}>${esc(nameOf(m))}</option>`).join("")}
                </select></td>
              <td class="chips2" id="chips-${c.uuid}">${chipAmt(bal.get(c.uuid)?.balance, "blue")}${chipAmt(bal.get(c.uuid)?.pink, "pink")}</td>
              <td><form class="chip-form" data-chips="${c.uuid}" data-name="${nm}" novalidate>
                <label class="sr" for="cc-${c.uuid}">코인 종류</label>
                <select class="input small-sel cur-sel" id="cc-${c.uuid}" name="currency"><option value="blue">블루</option><option value="pink">핑크</option></select>
                <label class="sr" for="cd-${c.uuid}">${nm} 코인 증감 (차감은 음수)</label>
                <input class="input" type="number" inputmode="numeric" step="1" id="cd-${c.uuid}" name="delta" placeholder="+100 / -50" required aria-describedby="cd-${c.uuid}-err">
                <label class="sr" for="cr-${c.uuid}">사유</label>
                <input class="input" type="text" id="cr-${c.uuid}" name="reason" placeholder="사유" maxlength="60">
                <button class="btn small" type="submit">적용</button>
                <span class="field-error" id="cd-${c.uuid}-err" hidden></span>
              </form></td>
            </tr>`; }).join("") || `<tr><td colspan="4" class="muted">캐릭터가 없습니다.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
  admInvite();
}

/* ----- 가입 링크 (update-11.sql + 서버 함수 signup) — 공용 링크 하나, 켜고 끄거나 새로 바꿈 ----- */
const inviteUrl = code => `${location.origin}${location.pathname}#join/${code}`;
async function admInvite(){
  const box = $("#adm-invite");
  if (!box) return;
  const { data, error } = await sb.rpc("admin_invite_get");
  if (error || !data?.[0]) return;   // update-11.sql 전이면 숨김
  const inv = data[0];
  box.hidden = false;
  box.innerHTML = `
    <div class="g-head"><h2 class="card-h" style="margin:0">가입 링크</h2>
      <label class="check inv-on"><input type="checkbox" id="inv-on"${inv.enabled ? " checked" : ""}> 받기</label></div>
    <div class="inv-row${inv.enabled ? "" : " off"}">
      <input class="input" id="inv-url" readonly value="${esc(inviteUrl(inv.code))}" aria-label="가입 링크"${inv.enabled ? "" : " disabled"}>
      <button class="btn small primary" type="button" id="inv-copy"${inv.enabled ? "" : " disabled"}>복사</button>
      <button class="btn small" type="button" id="inv-new">새 링크</button>
    </div>`;
  $("#inv-url").addEventListener("focus", e => e.target.select());
  $("#inv-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#inv-url").value); toast("가입 링크를 복사했습니다"); }
    catch (_) { $("#inv-url").select(); toast("링크를 길게 눌러 복사해 주세요"); }
  });
  $("#inv-on").addEventListener("change", async e => {
    const on = e.target.checked;
    const { error } = await sb.rpc("admin_invite_set", { p_enabled: on, p_renew: false });
    if (error){ toast(errMsg(error)); e.target.checked = !on; return; }
    toast(on ? "가입 링크를 켰습니다" : "가입 링크를 껐습니다. 이제 링크로 가입할 수 없습니다");
    admInvite();
  });
  $("#inv-new").addEventListener("click", async e => {
    if (!confirm("새 링크로 바꾸면 지금 링크는 더 이상 쓸 수 없습니다. 바꿀까요?")) return;
    await withBusy(e.currentTarget, async () => {
      const { error } = await sb.rpc("admin_invite_set", { p_enabled: null, p_renew: true });
      if (error){ toast(errMsg(error)); return; }
      toast("새 가입 링크를 만들었습니다");
      await admInvite();
    });
  });
}

/* ----- 구매 요청 (update-7.sql) — 승인하면 서버가 코인 차감 + 재고 감소 + 소지품 지급을 한 번에 ----- */
const SHOP_ST = { pending: "승인 대기", approved: "승인", rejected: "거절", cancelled: "본인 취소" };
ADM.shopFilter = "pending";
export async function admShop(){
  let q = sb.from("shop_requests").select(`id, character_id, item_name, unit_price, quantity, total, status, memo, admin_note, requested_by, decided_by, created_at, decided_at${CURRENCY.ok ? ", currency" : ""}`)
    .order("created_at", { ascending: ADM.shopFilter === "pending" }).limit(300);
  if (ADM.shopFilter === "pending") q = q.eq("status", "pending");
  const [rq, pc] = await Promise.all([q, sb.from("shop_requests").select("id", { count: "exact", head: true }).eq("status", "pending")]);
  if (rq.error) throw rq.error;
  const rows = rq.data || [], pend = pc.count ?? 0;
  const charIds = [...new Set(rows.map(r => r.character_id))], userIds = [...new Set(rows.flatMap(r => [r.requested_by, r.decided_by]).filter(Boolean))];
  const [bl, pr] = await Promise.all([
    charIds.length ? sb.from("chip_balances").select(CURRENCY.ok ? "character_id, balance, pink" : "character_id, balance").in("character_id", charIds) : { data: [] },
    userIds.length ? sb.from("profiles").select("id, display_name, email").in("id", userIds) : { data: [] }
  ]);
  const bal = new Map((bl.data || []).map(b => [b.character_id, b]));
  const balIn = (id, cur) => (cur === "pink" ? bal.get(id)?.pink : bal.get(id)?.balance) ?? 0;
  const who = new Map((pr.data || []).map(p => [p.id, p.display_name || (p.email || "").split("@")[0] || "?"]));
  const chars = new Map(ALL().map(c => [c.uuid, c]));
  ADM.badge.shop = pend; admDrawTabs();
  const when = iso => iso ? `${fmtDate(iso)} ${fmtTime(iso)}` : "";
  admPanel().innerHTML = `
    <div class="card adm-shop">
      <div class="g-head"><h2 class="card-h" style="margin:0">구매 요청</h2>
        <div class="seg" role="group" aria-label="보기" id="shop-filter" style="margin-left:auto">
          <button type="button" data-shop-filter="pending" aria-pressed="${ADM.shopFilter === "pending"}">대기 ${pend}</button>
          <button type="button" data-shop-filter="all" aria-pressed="${ADM.shopFilter === "all"}">기록</button>
        </div></div>
      ${rows.length ? `<div class="table-scroll"><table class="members shop-log">
        <caption class="sr">구매 요청 — 요청 시각, 캐릭터, 상품, 합계, 남긴 말, 처리</caption>
        <thead><tr><th scope="col">요청</th><th scope="col">캐릭터</th><th scope="col">상품</th><th scope="col">합계</th><th scope="col">남긴 말</th><th scope="col">처리</th></tr></thead>
        <tbody>${rows.map(r => {
          const c = chars.get(r.character_id), b = balIn(r.character_id, r.currency), short = r.status === "pending" && b < r.total;
          return `<tr class="st-${r.status}">
            <td class="when">${esc(when(r.created_at))}<small>${esc(who.get(r.requested_by) || "")}</small></td>
            <th scope="row" class="who" style="font-weight:400">${esc(c?.name || "(삭제된 캐릭터)")}<small${short ? ` class="warn"` : ""}>보유 ${chipAmt(b, r.currency)}${short ? " · 부족" : ""}</small></th>
            <td>${esc(r.item_name)} ×${r.quantity}<small>${r.unit_price.toLocaleString("ko-KR")}씩</small></td>
            <td class="num">${chipAmt(r.total, r.currency)}</td>
            <td class="memo">${esc(r.memo || "")}</td>
            <td class="act">${r.status === "pending" ? `<div class="shop-act" data-shop-row="${esc(r.id)}">
                <label class="sr" for="sn-${esc(r.id)}">관리자 메모</label><input class="input" id="sn-${esc(r.id)}" placeholder="메모" maxlength="200">
                <button class="btn small primary" type="button" data-shop-ok>승인</button><button class="btn small danger" type="button" data-shop-no>거절</button></div>`
              : `<span class="st">${SHOP_ST[r.status] || r.status}</span><small>${esc(when(r.decided_at))}${r.decided_by && r.status !== "cancelled" ? ` · ${esc(who.get(r.decided_by) || "")}` : ""}</small>${r.admin_note ? `<small>${esc(r.admin_note)}</small>` : ""}`}</td>
          </tr>`; }).join("")}</tbody></table></div>`
      : `<p class="empty-note">${ADM.shopFilter === "pending" ? "대기 중인 요청 없음" : "기록 없음"}</p>`}
      <p class="adm-status" id="adm-status" role="status"></p>
    </div>`;
  requestAnimationFrame(() => { const seg = $("#shop-filter"); if (seg && !$(".seg-ink", seg)){ seg.insertAdjacentHTML("beforeend", `<span class="seg-ink" aria-hidden="true"></span>`); } placeInk(seg); });
}
const placeInk = seg => { const a = seg && $('button[aria-pressed="true"]', seg), ink = seg && $(".seg-ink", seg); if (a && ink){ ink.style.left = a.offsetLeft + "px"; ink.style.width = a.offsetWidth + "px"; } };

async function admShopDecide(btn, approve){
  const box = btn.closest("[data-shop-row]"), id = box.dataset.shopRow, note = $("input", box).value.trim();
  if (!approve && !confirm("이 요청을 거절할까요?")) return;
  await withBusy(btn, async () => {
    const { error } = await sb.rpc("admin_shop_decide", { p_request: id, p_approve: approve, p_note: note });
    if (error){ toast(errMsg(error)); admStatus(errMsg(error)); return; }
    toast(approve ? "승인했습니다 — 코인 차감·지급 완료" : "거절했습니다");
    await admShop();
    if (approve) refreshPublic();   // 재고·소지품이 바뀜
  });
}

/* 다른 탭을 보고 있어도 승인 대기 숫자는 바로 갱신 */
document.addEventListener("comu:shop-req", () => { if (!$('[data-page="admin"]').hidden) admCounts().then(admDrawTabs); });
document.addEventListener("comu:chip-req", () => { if (!$('[data-page="admin"]').hidden) admCounts().then(admDrawTabs); });
let shopT = 0;
document.addEventListener("comu:shop-req", () => {
  if (ADM.tab !== "shop" || !$("#admin-panel")?.isConnected || $('[data-page="admin"]').hidden) return;
  if (document.activeElement?.closest?.("[data-shop-row]")) return;   // 메모를 쓰는 중이면 그대로 둠
  clearTimeout(shopT); shopT = setTimeout(() => admShop().catch(() => {}), 300);
});

/* ----- 코인 정산 요청 (update-9.sql) — 승인하면 코인 기록에 바로 들어감 ----- */
ADM.creqFilter = "pending";
export async function admChipReq(){
  let q = sb.from("chip_requests").select(`id, character_id, amount, reason, status, admin_note, requested_by, decided_by, created_at, decided_at${CURRENCY.ok ? ", currency" : ""}`)
    .order("created_at", { ascending: ADM.creqFilter === "pending" }).limit(300);
  if (ADM.creqFilter === "pending") q = q.eq("status", "pending");
  const [rq, pc] = await Promise.all([q, sb.from("chip_requests").select("id", { count: "exact", head: true }).eq("status", "pending")]);
  if (rq.error) throw rq.error;
  const rows = rq.data || [], pend = pc.count ?? 0;
  const charIds = [...new Set(rows.map(r => r.character_id))], userIds = [...new Set(rows.flatMap(r => [r.requested_by, r.decided_by]).filter(Boolean))];
  const [bl, pr] = await Promise.all([
    charIds.length ? sb.from("chip_balances").select(CURRENCY.ok ? "character_id, balance, pink" : "character_id, balance").in("character_id", charIds) : { data: [] },
    userIds.length ? sb.from("profiles").select("id, display_name, email").in("id", userIds) : { data: [] }
  ]);
  const bal = new Map((bl.data || []).map(b => [b.character_id, b]));
  const balIn = (id, cur) => (cur === "pink" ? bal.get(id)?.pink : bal.get(id)?.balance) ?? 0;
  const who = new Map((pr.data || []).map(p => [p.id, p.display_name || (p.email || "").split("@")[0] || "?"]));
  const chars = new Map(ALL().map(c => [c.uuid, c]));
  ADM.badge.chipreq = pend; admDrawTabs();
  const when = iso => iso ? `${fmtDate(iso)} ${fmtTime(iso)}` : "";
  const sign = v => (v > 0 ? "+" : "") + v.toLocaleString("ko-KR");
  admPanel().innerHTML = `
    <div class="card adm-shop">
      <div class="g-head"><h2 class="card-h" style="margin:0">코인 정산 요청</h2>
        <div class="seg" role="group" aria-label="보기" id="creq-filter" style="margin-left:auto">
          <button type="button" data-creq-filter="pending" aria-pressed="${ADM.creqFilter === "pending"}">대기 ${pend}</button>
          <button type="button" data-creq-filter="all" aria-pressed="${ADM.creqFilter === "all"}">기록</button>
          <span class="seg-ink" aria-hidden="true"></span>
        </div></div>
      ${rows.length ? `<div class="table-scroll"><table class="members shop-log">
        <caption class="sr">코인 정산 요청 — 요청 시각, 캐릭터, 코인, 사유, 처리</caption>
        <thead><tr><th scope="col">요청</th><th scope="col">캐릭터</th><th scope="col">코인</th><th scope="col">사유</th><th scope="col">처리</th></tr></thead>
        <tbody>${rows.map(r => {
          const c = chars.get(r.character_id), b = balIn(r.character_id, r.currency), short = r.status === "pending" && b + r.amount < 0;
          return `<tr class="st-${r.status}">
            <td class="when">${esc(when(r.created_at))}<small>${esc(who.get(r.requested_by) || "")}</small></td>
            <th scope="row" class="who" style="font-weight:400">${esc(c?.name || "(삭제된 캐릭터)")}<small${short ? ` class="warn"` : ""}>보유 ${chipAmt(b, r.currency)}${short ? " · 부족" : ""}</small></th>
            <td class="num${r.amount < 0 ? " minus" : ""}">${chipAmt(r.amount, r.currency, true)}</td>
            <td class="memo">${esc(r.reason)}</td>
            <td class="act">${r.status === "pending" ? `<div class="shop-act" data-creq-row="${esc(r.id)}">
                <label class="sr" for="cn-${esc(r.id)}">관리자 메모</label><input class="input" id="cn-${esc(r.id)}" placeholder="메모" maxlength="200">
                <button class="btn small primary" type="button" data-creq-ok>승인</button><button class="btn small danger" type="button" data-creq-no>거절</button></div>`
              : `<span class="st">${{ approved: "승인", rejected: "거절", cancelled: "본인 취소" }[r.status]}</span><small>${esc(when(r.decided_at))}${r.decided_by && r.status !== "cancelled" ? ` · ${esc(who.get(r.decided_by) || "")}` : ""}</small>${r.admin_note ? `<small>${esc(r.admin_note)}</small>` : ""}`}</td>
          </tr>`; }).join("")}</tbody></table></div>`
      : `<p class="empty-note">${ADM.creqFilter === "pending" ? "대기 중인 요청 없음" : "기록 없음"}</p>`}
    </div>`;
  requestAnimationFrame(() => placeInk($("#creq-filter")));
}
async function admChipDecide(btn, approve){
  const box = btn.closest("[data-creq-row]"), note = $("input", box).value.trim();
  if (!approve && !confirm("이 요청을 거절할까요?")) return;
  await withBusy(btn, async () => {
    const { error } = await sb.rpc("admin_chip_decide", { p_request: box.dataset.creqRow, p_approve: approve, p_note: note });
    if (error){ toast(errMsg(error)); return; }
    toast(approve ? "승인했습니다 — 코인 반영 완료" : "거절했습니다");
    await admChipReq();
  });
}
let creqT = 0;
document.addEventListener("comu:chip-req", () => {
  if (ADM.tab !== "chipreq" || $('[data-page="admin"]').hidden) return;
  if (document.activeElement?.closest?.("[data-creq-row]")) return;
  clearTimeout(creqT); creqT = setTimeout(() => admChipReq().catch(() => {}), 300);
});

/* ----- 관리자 지정 (update-9.sql) ----- */
async function admSetRole(sel){
  const prev = sel.dataset.prev, admin = sel.value === "admin";
  if (!confirm(admin ? "이 멤버를 관리자로 지정할까요? 관리 화면의 모든 기능을 쓸 수 있게 됩니다." : "이 멤버의 관리자 권한을 해제할까요?")){ sel.value = prev; return; }
  const { error } = await sb.rpc("admin_set_role", { p_user: sel.dataset.role, p_admin: admin });
  if (error){ sel.value = prev; toast(/PGRST202|admin_set_role/.test(`${error.code} ${error.message}`) ? "supabase/update-9.sql을 먼저 실행해 주세요" : errMsg(error)); return; }
  sel.dataset.prev = sel.value;
  toast(admin ? "관리자로 지정했습니다" : "관리자 권한을 해제했습니다");
}

/* ----- 게임용 이미지 (룰렛 자리) — 캐릭터 목록·프로필 이미지와 따로 ----- */
export async function admLoadGameImg(charId){
  const box = $("#gimg-prev"); if (!box) return;
  const { data, error } = await sb.from("roulette_avatars").select("path").eq("character_id", charId).maybeSingle();
  if (!box.isConnected) return;
  if (error){ $("#gimg-f").hidden = true; return; }   // update-8.sql 전
  box.dataset.path = data?.path || "";
  box.innerHTML = data ? `<img src="${esc(publicUrl("roulette", data.path))}" alt="">` : `<span class="img-plus" aria-hidden="true">+</span>`;
  $("#gimg-del-l").hidden = !data;
}
/* 저장 버튼을 누를 때 함께: 새 파일이 있으면 올리고, '삭제'에 체크했으면 지움 */
async function saveGameImgWith(charId){
  const file = $("#gimg-file")?.files[0], del = $("#gimg-del")?.checked, old = $("#gimg-prev")?.dataset.path;
  if (file){
    const blob = await toWebP(file, 512), path = `${charId}/${Date.now()}.${extOf(blob)}`;
    const up = await sb.storage.from("roulette").upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
    if (up.error) throw up.error;
    const { error } = await sb.rpc("roulette_set_avatar", { p_character: charId, p_path: path });
    if (error){ sb.storage.from("roulette").remove([path]); throw error; }
    if (old) sb.storage.from("roulette").remove([old]);
  } else if (del && old){
    const { error } = await sb.rpc("roulette_set_avatar", { p_character: charId, p_path: null });
    if (error) throw error;
    sb.storage.from("roulette").remove([old]);
  }
}
/* ----- 관리 페이지 이벤트 ----- */
$("#admin-tabs").addEventListener("click", e => {
  const t = e.target.closest('[role="tab"]');
  if (!t || t.dataset.tab === ADM.tab) return;
  if (state.admDirty && !confirm("저장하지 않은 변경이 있습니다. 이동할까요?")) return;
  ADM.sel = null; state.admDirty = false;
  admShow(t.dataset.tab);
  $("#tab-" + t.dataset.tab)?.focus();
});

$("#admin-tabs").addEventListener("keydown", e => {
  const tabs = $$('[role="tab"]', e.currentTarget), i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
  if (j == null) return;
  e.preventDefault();
  tabs[(j + tabs.length) % tabs.length].click();
});

admPanel().addEventListener("click", async e => {
  const t = e.target;
  if (t.closest("[data-adm-new]")){
    if (state.admDirty && !confirm("저장하지 않은 변경이 있습니다. 새로 쓸까요?")) return;
    ADM.sel = null; admRenderCrud(ADM.tab); $("#adm-form-h").focus(); return;
  }
  const sel = t.closest("[data-adm-sel]");
  if (sel){
    if (state.admDirty && !confirm("저장하지 않은 변경이 있습니다. 이동할까요?")) return;
    ADM.sel = sel.dataset.admSel;
    $$("[data-adm-sel]", admPanel()).forEach(b => b.setAttribute("aria-current", b === sel));
    admRenderEditor(ADM.tab); $("#adm-form-h").focus(); return;
  }
  if (t.closest("[data-adm-del]")) return admDelete();
  const sf = t.closest("[data-shop-filter]");
  if (sf){ ADM.shopFilter = sf.dataset.shopFilter; await admShop(); $(`[data-shop-filter="${ADM.shopFilter}"]`)?.focus(); return; }
  if (t.closest("[data-shop-ok]")) return admShopDecide(t.closest("[data-shop-ok]"), true);
  const cf = t.closest("[data-creq-filter]");
  if (cf){ ADM.creqFilter = cf.dataset.creqFilter; await admChipReq(); $(`[data-creq-filter="${ADM.creqFilter}"]`)?.focus(); return; }
  if (t.closest("[data-creq-ok]")) return admChipDecide(t.closest("[data-creq-ok]"), true);
  if (t.closest("[data-creq-no]")) return admChipDecide(t.closest("[data-creq-no]"), false);

  if (t.closest("[data-shop-no]")) return admShopDecide(t.closest("[data-shop-no]"), false);
  const pv = t.closest("[data-md-preview]");
  if (pv){
    const ta = document.getElementById(pv.dataset.mdPreview), box = document.getElementById(pv.dataset.mdPreview + "-prev");
    const on = pv.getAttribute("aria-pressed") !== "true";
    pv.setAttribute("aria-pressed", on); pv.textContent = on ? "편집으로 돌아가기" : "미리보기";
    if (on){
      box.innerHTML = `<p class="muted">불러오는 중…</p>`;
      try { box.innerHTML = await renderMarkdown(ta.value) || `<p class="muted">내용이 없습니다.</p>`; }
      catch (_){ box.textContent = "미리보기를 불러오지 못했습니다."; }
    }
    ta.hidden = on; box.hidden = !on;
    return;
  }
  if (t.closest("[data-inv-add]")){
    $("#inv-rows [data-inv-empty]")?.remove();
    $("#inv-rows").insertAdjacentHTML("beforeend", invRowHtml({}, invSeq++));
    $("#inv-rows [data-inv-row]:last-child select").focus();
    state.admDirty = true; return;
  }
  const del = t.closest("[data-inv-del]");
  if (del){
    const row = del.closest("[data-inv-row]"), next = row.nextElementSibling || row.previousElementSibling;
    row.remove(); state.admDirty = true;
    (next ? $("select", next) : $("[data-inv-add]"))?.focus();
    $("#inv-status").textContent = "칸을 삭제했습니다. ‘소지품 저장’을 눌러야 반영됩니다.";
    return;
  }
  const invSave = t.closest("[data-inv-save]");
  if (invSave) return admSaveInventory(invSave);
  if (t.closest(".bm-link")){ e.preventDefault(); toast("이 버튼은 누르지 말고 즐겨찾기 막대로 끌어다 놓으세요"); return; }
  if (t.closest("[data-log-room]")) return withBusy(t.closest("[data-log-room]"), logRoom);
  if (t.closest("[data-log-lib]")) return logLibPaste();
  if (t.closest("[data-log-bm-copy]")){ const { BOOKMARKLET } = await import("./logparse.js?v=20261031f"); try { await navigator.clipboard.writeText(BOOKMARKLET); toast("북마크 코드를 복사했습니다"); } catch (_){ toast("복사하지 못했습니다"); } return; }
  const logSave = t.closest("[data-log-save]");
  if (logSave) return withBusy(logSave, () => logSaveNow(logSave.dataset.id));
  const logDel = t.closest("[data-log-del]");
  if (logDel) return withBusy(logDel, () => logDelete(logDel.dataset.id));
});

admPanel().addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  if (f.id === "adm-form") return withBusy($('button[type="submit"]', f), () => admSave(f));
  if (f.dataset.chips){
    const input = f.delta, delta = parseInt(input.value, 10);
    if (!checkField(input)) return input.focus();
    if (!delta){ fieldError(input, "0이 아닌 정수를 입력해 주세요."); return input.focus(); }
    await withBusy($("button", f), async () => {
      const cur = f.currency.value;
      const { data, error } = await sb.rpc("admin_adjust_chips", CURRENCY.ok ? { p_character: f.dataset.chips, p_amount: delta, p_reason: f.reason.value.trim(), p_currency: cur } : { p_character: f.dataset.chips, p_amount: delta, p_reason: f.reason.value.trim() });
      if (error){ fieldError(input, errMsg(error)); input.focus(); return; }
      const cell = $("#chips-" + f.dataset.chips), idx = cur === "pink" ? 1 : 0;
      cell.children[idx].outerHTML = chipAmt(data, cur);
      f.delta.value = ""; f.reason.value = ""; fieldError(input, "");
      const what = `${f.dataset.name} ${CUR[cur].name} ${delta > 0 ? "+" : ""}${delta}`;
      announce(`${what}, 잔액 ${data}`);
      toast(`${what} → 잔액 ${data.toLocaleString("ko-KR")}`);
      if (state.mine.some(m => m.uuid === f.dataset.chips)){ await loadMine(); renderAccount(); }
    });
  }
});

admPanel().addEventListener("change", async e => {
  const rs = e.target.closest("[data-role]");
  if (rs) return admSetRole(rs);
  const sel = e.target.closest("[data-owner]");
  if (!sel) return;
  const { error } = await sb.rpc("admin_set_owner", { p_character: sel.dataset.owner, p_owner: sel.value || null });
  if (error){ sel.value = sel.dataset.prev; toast(errMsg(error)); return; }
  sel.dataset.prev = sel.value;
  announce(sel.value ? "소유 멤버를 지정했습니다" : "소유 멤버를 해제했습니다");
  toast("저장했습니다");
  if (sel.value === state.session?.user.id || state.mine.some(m => m.uuid === sel.dataset.owner)){ await loadMine(); renderAccount(); }
  admMembers().then(() => $("#own-" + sel.dataset.owner)?.focus());   // 위쪽 멤버 표의 소유 캐릭터 갱신
});

admPanel().addEventListener("input", e => { if (e.target.closest("#adm-form, #inv-rows")) state.admDirty = true; });

/* 이미지 초점: 슬라이더를 움직이면 미리보기 세 칸이 바로 바뀜 */
function setFocus(box, x, y, empty = false){
  $$("input[type=range]", box).forEach(r => { r.value = r.dataset.axis === "x" ? x : y; r.nextElementSibling.textContent = r.value; });
  $$(".fp img", box).forEach(img => img.style.objectPosition = `${x}% ${y}%`);
  $("input[type=hidden]", box).value = empty ? "" : `${x} ${y}`;
  $(".focus-state", box).textContent = empty ? "기본 위치 사용 중" : "직접 정함";
}
admPanel().addEventListener("input", e => {
  const box = e.target.closest("[data-focus]");
  if (!box || e.target.type !== "range") return;
  const [x, y] = ["x", "y"].map(k => $(`[data-axis="${k}"]`, box).value);
  setFocus(box, x, y);
});
admPanel().addEventListener("click", e => {
  const b = e.target.closest("[data-focus-reset]");
  if (!b) return;
  setFocus(b.closest("[data-focus]"), 50, 15, true);
  state.admDirty = true;
});

admPanel().addEventListener("change", e => {
  if (e.target.id === "log-file") logRead(e.target);
  if (e.target.name === "log-fmt"){ const w = $(`.log-who[data-t="${e.target.dataset.t}"]`); if (w) w.hidden = e.target.value !== "secret"; }
});
admPanel().addEventListener("change", e => {
  if (e.target.id !== "gimg-file") return;
  const f = e.target.files[0];
  if (f && /^image\//.test(f.type)){ $("#gimg-prev").innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`; state.admDirty = true; }
});

admPanel().addEventListener("change", e => {
  const file = e.target.closest('#adm-form input[type="file"]');
  if (!file || file.id === "gimg-file") return;
  state.admDirty = true;
  const f = file.files[0], prev = document.getElementById(file.id + "-prev");
  if (!f) return;
  if (!/^image\//.test(f.type)){ fieldError(file, "이미지 파일만 올릴 수 있습니다."); file.value = ""; return; }
  fieldError(file, "");
  const url = URL.createObjectURL(f);
  prev.innerHTML = `<img src="${url}" alt="">`;
});

/* =========================================================
   진행 기록: 로그 파일 → 고르기(탭·나레이션) → JSON으로 저장
   ========================================================= */
const LOG = { messages: null, info: null, name: "", library: [] };

async function logRead(input){
  const f = input.files[0], opts = $("#log-opts"), btn = $("[data-log-save]");
  LOG.messages = null; LOG.library = []; btn.disabled = true; opts.innerHTML = ""; fieldError(input, "");
  if (!f) return;
  if (f.size > 60 * 1024 * 1024){ fieldError(input, "60MB 이하 파일만 올릴 수 있습니다."); return; }
  $("#log-status").textContent = "읽는 중…";
  const { parseLog, analyze, BOOKMARKLET } = await import("./logparse.js?v=20261031f");
  LOG.match = (await import("./logsecret.js?v=20261031f")).matchCharacters;
  const messages = parseLog(await f.text());
  $("#log-status").textContent = "";
  if (!messages.length){ fieldError(input, "대사를 찾지 못했습니다. 코코포리아에서 내보낸 로그 파일이 맞는지 확인해 주세요."); return; }
  LOG.messages = messages; LOG.info = analyze(messages); LOG.name = f.name;
  const tabs = LOG.info.tabs, sp = LOG.info.speakers;
  opts.innerHTML = `
    <p class="form-note">대사 ${messages.length.toLocaleString("ko-KR")}개 · 탭 ${tabs.length}개 · 화자 ${sp.length}명을 찾았습니다.</p>
    <fieldset class="log-fs"><legend>저장할 탭과 종류</legend>
      <div class="log-tabrows">${tabs.map((t, i) => logTabRow(t, i)).join("")}</div>
      <p class="hint">메인: 노벨 모드 대사창 · 잡담: 노벨 모드 채팅창, 읽기 화면에서 처음엔 접힘 · 정보: 노벨 모드 쪽지 ·
        비밀: 공개 기록 파일에서 빠지고, 체크한 캐릭터의 주인과 관리자만 봅니다. 캐릭터는 그 탭에서 말한 이름과 같은 사이트 캐릭터를 미리 골라 둡니다.</p>
    </fieldset>
    <fieldset class="log-fs"><legend>나레이션으로 보일 화자</legend>
      <p class="hint" style="margin-top:0">체크한 화자는 이름 없이 본문처럼 보입니다 (진행자·KP 등).</p>
      <div class="log-sp">${sp.map((s, i) => `<label class="check"><input type="checkbox" name="log-narr" value="${i}"><span class="log-dot" style="background:${esc(s.color)}"></span>${esc(s.name || "(이름 없음)")} <span class="hint" style="margin:0">(${s.count.toLocaleString("ko-KR")})</span></label>`).join("")}</div>
    </fieldset>
    <fieldset class="log-fs"><legend>스탠딩·표정 이미지 (선택)</legend>
      <p class="hint" style="margin-top:0">로그 화자와 이름이 같은 코코포리아 캐릭터의 이미지를 대사 옆에 붙이고, 사이트 저장소에 복사해 둡니다. 코코포리아에서 이미지를 지워도 기록에는 남습니다.</p>
      <div class="field"><label for="log-room">코코포리아 룸 링크</label>
        <div class="log-inline"><input class="input" id="log-room" type="url" inputmode="url" placeholder="https://ccfolia.com/rooms/…"><button class="btn" type="button" data-log-room>불러오기</button></div>
        <label class="check"><input type="checkbox" id="log-room-chat" checked>채팅 기록으로 대사마다 실제로 쓴 표정 맞추기</label>
      </div>
      <details class="log-alt"><summary>링크로 안 될 때 (비공개 룸)</summary>
        <ol class="hint">
          <li>아래 <b>스탠딩 가져오기</b> 버튼을 즐겨찾기 막대로 끌어다 놓습니다 (또는 코드를 복사해 새 북마크 주소로 저장).</li>
          <li>코코포리아 룸에 입장한 상태에서 그 북마크를 누릅니다.</li>
          <li>뜬 창의 ‘복사하고 닫기’를 누른 뒤, 아래 칸에 붙여넣고 ‘적용’을 누릅니다.</li>
        </ol>
        <div class="form-actions"><a class="btn small bm-link" href="${esc(BOOKMARKLET)}" draggable="true">스탠딩 가져오기</a><button class="btn small" type="button" data-log-bm-copy>북마크 코드 복사</button></div>
        <div class="field"><label for="log-lib-text">붙여넣기</label><textarea class="input" id="log-lib-text" rows="3"></textarea></div>
        <button class="btn small" type="button" data-log-lib>적용</button>
      </details>
      <p class="adm-status" id="log-lib-status" role="status"></p>
    </fieldset>
    <label class="check"><input type="checkbox" id="log-strip" checked>줄 처음·끝의 @표정 태그 지우기</label>`;
  btn.disabled = false;
}

const FMT_LABEL = { main: "메인", info: "정보", other: "잡담", secret: "비밀" };
function logTabRow(t, i){
  return `<div class="log-tabrow" data-t="${i}">
    <label class="check"><input type="checkbox" name="log-tab" value="${i}" checked>${esc(t.name)} <span class="hint" style="margin:0">(${t.count.toLocaleString("ko-KR")})</span></label>
    <select class="input log-fmt" name="log-fmt" data-t="${i}" aria-label="${esc(t.name)} 탭 종류">${Object.entries(FMT_LABEL).map(([v, l]) => `<option value="${v}" ${t.format === v ? "selected" : ""}>${l}</option>`).join("")}</select>
    <div class="log-who" data-t="${i}" ${t.format === "secret" ? "" : "hidden"}>${logWho(i)}</div>
  </div>`;
}
/* 비밀 탭을 볼 캐릭터: 그 탭에서 말한 화자 이름과 맞는 사이트 캐릭터를 미리 체크 */
function logWho(i){
  const tab = LOG.info.tabs[i].name, chars = ALL();
  if (!chars.length) return `<p class="hint">사이트에 캐릭터가 없습니다. 관리자만 볼 수 있게 저장됩니다.</p>`;
  const names = [...new Set(LOG.messages.filter(m => m.tab === tab).map(m => m.name))];
  const hit = new Set(LOG.match(names, chars));
  return `<span class="log-who-l">볼 수 있는 캐릭터</span>${chars.map(c => `<label class="check"><input type="checkbox" name="log-who-${i}" value="${esc(c.uuid)}" ${hit.has(c.uuid) ? "checked" : ""}>${esc(c.name)}</label>`).join("")}
    ${hit.size ? "" : `<span class="hint">이 탭의 화자와 이름이 같은 캐릭터가 없습니다. 아무도 고르지 않으면 관리자만 봅니다.</span>`}`;
}

function libSummary(extra = ""){
  const names = new Set(LOG.library.map(c => c.name.trim()));
  const hit = LOG.info.speakers.filter(s => names.has(s.name.trim())).length;
  const faces = LOG.library.reduce((n, c) => n + c.faces.length + (c.iconUrl ? 1 : 0), 0);
  $("#log-lib-status").textContent = `캐릭터 ${LOG.library.length}명 · 이미지 ${faces}개 불러옴 — 로그 화자 ${hit}/${LOG.info.speakers.length}명과 이름이 맞음${extra}`;
}

async function logRoom(){
  const { roomIdFrom, loadRoom, alignRoomFaces } = await import("./logparse.js?v=20261031f");
  const id = roomIdFrom($("#log-room").value);
  if (!id){ $("#log-lib-status").textContent = "코코포리아 룸 링크 형식이 아닙니다. (https://ccfolia.com/rooms/…)"; $("#log-room").focus(); return; }
  try {
    const { characters, roomMsgs } = await loadRoom(id, { withLog: $("#log-room-chat").checked, onStatus: t => { $("#log-lib-status").textContent = t; } });
    LOG.library = characters;
    const matched = roomMsgs.length ? alignRoomFaces(LOG.messages, roomMsgs) : 0;
    libSummary(roomMsgs.length ? ` · 대사 ${matched.toLocaleString("ko-KR")}개에 실제 표정 연결` : "");
  } catch (err){
    const hint = err.status === 403 || err.status === 404 ? " 비공개 룸이거나 링크가 틀렸을 수 있습니다. ‘링크로 안 될 때’ 방법을 써 주세요." : "";
    $("#log-lib-status").textContent = "룸에서 불러오지 못했습니다: " + err.message + hint;
    $(".log-alt").open = true;
  }
}

async function logLibPaste(){
  const { parseLibrary } = await import("./logparse.js?v=20261031f");
  try {
    const lib = parseLibrary($("#log-lib-text").value);
    if (!lib.length){ $("#log-lib-status").textContent = "캐릭터를 찾지 못했습니다."; return; }
    LOG.library = lib; libSummary();
  } catch (err){ $("#log-lib-status").textContent = err.message; }
}

/* 표정 이미지를 사이트 저장소로 복사: 긴 변 480px WebP, 주소의 해시를 파일 이름으로 써서 같은 이미지는 한 번만.
   코코포리아 서버가 교차 출처 읽기를 막으면 원본 주소를 그대로 둠 */
async function sha1(t){ const b = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(t)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
async function grabImage(url, max = 480){
  const img = new Image();
  img.crossOrigin = "anonymous"; img.decoding = "async"; img.referrerPolicy = "no-referrer";
  img.src = url;
  await img.decode();
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = c.getContext("2d"); ctx.imageSmoothingQuality = "high"; ctx.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, "image/webp", .88));   // 교차 출처가 막혔으면 여기서 오류
  if (!blob) throw new Error("encode");
  return blob;
}
export async function backupFaces(urls, onProgress = () => {}){
  const out = urls.slice(); let ok = 0, done = 0;
  const work = async i => {
    const u = urls[i];
    try {
      const path = `img/${await sha1(u)}.webp`;
      const blob = await grabImage(u);
      const up = await sb.storage.from("logs").upload(path, blob, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
      if (up.error && !/exist|duplicate|409/i.test(up.error.message + (up.error.statusCode || ""))) throw up.error;
      out[i] = path; ok++;
    } catch (_) { /* 원본 주소 유지 */ }
    onProgress(++done, urls.length);
  };
  const queue = urls.map((_, i) => i);
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => { while (queue.length) await work(queue.shift()); }));
  return { faces: out, ok };
}

async function logSaveNow(id){
  if (!LOG.messages) return;
  const { pack } = await import("./logparse.js?v=20261031f");
  const include = new Set($$('input[name="log-tab"]:checked').map(i => LOG.info.tabs[+i.value].name));
  const narrators = new Set($$('input[name="log-narr"]:checked').map(i => LOG.info.speakers[+i.value].name));
  if (!include.size){ $("#log-status").textContent = "저장할 탭을 하나 이상 골라 주세요."; return; }
  const row = (ADM.rows.chapters || []).find(r => r.id === id);
  if (row?.log_path && !confirm("이미 저장된 기록을 새 로그로 바꿉니다. 기록 화면에서 고친 대사와 BGM 구간은 사라집니다. 계속할까요?")) return;
  const formats = new Map($$('select[name="log-fmt"]').map(sel => [LOG.info.tabs[+sel.dataset.t].name, sel.value]));
  const owners = new Map(LOG.info.tabs.map((t, i) => [t.name, $$(`input[name="log-who-${i}"]:checked`).map(x => x.value)]));
  const data = pack(LOG.messages, { include, narrators, stripTag: $("#log-strip").checked, src: LOG.name, library: LOG.library, formats, owners });
  try {
    if (data.faces.length){
      const r = await backupFaces(data.faces, (d, n) => { $("#log-status").textContent = `표정 이미지 복사 중… ${d}/${n}`; });
      data.faces = r.faces;
      if (r.ok < data.faces.length) toast(`이미지 ${data.faces.length - r.ok}개는 코코포리아가 복사를 막아 원본 주소로 연결했습니다`);
    }
    // 비밀 탭은 공개 기록 파일에서 빼서 log_secrets 표로 (update-20.sql)
    const { splitLog, saveSecrets } = await import("./logsecret.js?v=20261031f");
    const { pub, secrets } = splitLog(data);
    const blob = new Blob([JSON.stringify(pub)], { type: "application/json" });
    const path = `ch-${id}-${Date.now()}.json`;
    $("#log-status").textContent = `저장 중… (${Math.ceil(blob.size / 1024).toLocaleString("ko-KR")}KB${secrets.length ? ` · 비밀 탭 ${secrets.length}개 따로` : ""})`;
    await saveSecrets(sb, id, secrets);
    const up = await sb.storage.from("logs").upload(path, blob, { contentType: "application/json", cacheControl: "31536000", upsert: false });
    if (up.error) throw up.error;
    const { error } = await sb.from("chapters").update({ log_path: path, updated_at: new Date().toISOString() }).eq("id", id);
    if (error){ sb.storage.from("logs").remove([path]); throw error; }
    if (row?.log_path) sb.storage.from("logs").remove([row.log_path]);
    toast(`기록을 저장했습니다 (대사 ${data.n.toLocaleString("ko-KR")}개)`);
    LOG.messages = null;
    await admLoad("chapters"); admRenderCrud("chapters");
    refreshPublic();
  } catch (err){ $("#log-status").textContent = errMsg(err); }
}

async function logDelete(id){
  const row = (ADM.rows.chapters || []).find(r => r.id === id);
  if (!row?.log_path || !confirm("이 회차에 붙은 기록을 삭제할까요?")) return;
  const { error } = await sb.from("chapters").update({ log_path: null, updated_at: new Date().toISOString() }).eq("id", id);
  if (error){ $("#log-status").textContent = errMsg(error); return; }
  sb.storage.from("logs").remove([row.log_path]);
  import("./logsecret.js?v=20261031f").then(m => m.saveSecrets(sb, id, [])).catch(() => {});   // 붙어 있던 비밀 탭도
  toast("기록을 삭제했습니다");
  await admLoad("chapters"); admRenderCrud("chapters");
  refreshPublic();
}

/* 비밀번호 초기화: 임시 비밀번호를 만들어 서버 함수(signup, action reset)로 바꾸고, 화면에 보여 주며 복사 */
admPanel().addEventListener("click", async e => {
  const b = e.target.closest("[data-pwreset]");
  if (!b) return;
  if (!confirm(`${b.dataset.name}의 비밀번호를 임시 비밀번호로 바꿀까요? 지금 비밀번호는 더 이상 쓸 수 없습니다.`)) return;
  const abc = "abcdefghjkmnpqrstuvwxyz23456789", rnd = crypto.getRandomValues(new Uint8Array(10));
  const temp = Array.from(rnd, x => abc[x % abc.length]).join("");
  await withBusy(b, async () => {
    const { error } = await sb.functions.invoke("signup", { body: { action: "reset", user: b.dataset.pwreset, password: temp } });
    if (error){
      let msg = "초기화하지 못했습니다";
      try { msg = (await error.context.json()).error || msg; } catch (_) {}
      toast(msg); return;
    }
    let copied = false;
    try { await navigator.clipboard.writeText(temp); copied = true; } catch (_) {}
    b.closest("td").innerHTML = `<span class="pw-temp">임시 비밀번호 <code>${temp}</code>${copied ? " · 복사됨" : ""}</span>`;
    toast(`${b.dataset.name}에게 임시 비밀번호를 전달해 주세요`, 4000);
  });
});

/* =========================================================
   아이템 여러 장 한 번에: 이미지마다 상품 하나 (이름 = 파일 이름). 분류·가격·코인 종류는 한꺼번에
   ========================================================= */
function bulkDlg(){
  let d = $("#bulk-dlg");
  if (d) return d;
  document.body.insertAdjacentHTML("beforeend", `<dialog class="dlg" id="bulk-dlg" aria-labelledby="bulk-h">
    <form class="form" id="bulk-form" method="dialog" novalidate>
      <h2 class="card-h" id="bulk-h">아이템 여러 장 추가</h2>
      <p class="form-error" id="bulk-err" role="alert" hidden></p>
      <label class="img-drop bulk-drop"><input type="file" id="bulk-files" accept="image/*" multiple hidden><span id="bulk-pick">이미지 고르기</span></label>
      <ul class="bulk-prev" id="bulk-prev"></ul>
      <div class="row2">
        <div class="field"><label for="bulk-cat">분류</label><input class="input" id="bulk-cat" maxlength="20" placeholder="예: 파츠"></div>
        <div class="field"><label for="bulk-stock">재고</label><input class="input" id="bulk-stock" type="number" min="0" step="1" placeholder="무제한"></div>
      </div>
      <div class="row2">
        <div class="field"><label for="bulk-price">가격</label><input class="input" id="bulk-price" type="number" min="0" step="1" placeholder="비우면 가격 미정"></div>
        <div class="field"><label for="bulk-cur">코인 종류</label><select class="input" id="bulk-cur">${OPT.currency.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div>
      </div>
      <label class="check"><input type="checkbox" id="bulk-sale" checked>상점에 표시</label>
      <p class="adm-status" id="bulk-status" role="status"></p>
      <div class="form-actions"><button class="btn primary" type="submit">추가</button><button class="btn" type="button" data-close>닫기</button></div>
    </form></dialog>`);
  d = $("#bulk-dlg");
  $("[data-close]", d).addEventListener("click", () => d.close());
  $("#bulk-files").addEventListener("change", e => {
    const files = [...e.target.files];
    $("#bulk-pick").textContent = files.length ? `${files.length}장 선택됨` : "이미지 고르기";
    $("#bulk-prev").innerHTML = files.slice(0, 60).map(f => `<li><img src="${URL.createObjectURL(f)}" alt=""><span>${esc(f.name.replace(/\.[^.]+$/, ""))}</span></li>`).join("");
  });
  $("#bulk-form").addEventListener("submit", async e => {
    e.preventDefault();
    const files = [...$("#bulk-files").files], err = $("#bulk-err"), st = $("#bulk-status");
    showMsg(err, "");
    if (!files.length){ showMsg(err, "이미지를 골라 주세요."); return; }
    const price = $("#bulk-price").value === "" ? null : parseInt($("#bulk-price").value, 10), stock = $("#bulk-stock").value === "" ? null : parseInt($("#bulk-stock").value, 10);
    if ((price != null && !(price >= 0)) || (stock != null && !(stock >= 0))){ showMsg(err, "가격과 재고는 0 이상의 정수입니다."); return; }
    await withBusy($('button[type="submit"]', e.target), async () => {
      const base = Math.max(-1, ...(ADM.rows.items || []).map(r => r.sort_order ?? 0)) + 1;
      let ok = 0;
      for (const [i, f] of files.entries()){
        st.textContent = `${i + 1} / ${files.length} 올리는 중…`;
        let path = null;
        try {
          const blob = await toWebP(f, CONFIG.IMG.item);
          path = `item-${Date.now()}-${i}.${extOf(blob)}`;
          const up = await sb.storage.from("items").upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
          if (up.error) throw up.error;
          const row = { name: f.name.replace(/\.[^.]+$/, "").slice(0, 40) || "아이템", description: "", price, stock, is_for_sale: $("#bulk-sale").checked,
            sort_order: base + i, image_path: path, currency: $("#bulk-cur").value };
          if (CAT.ok) row.category = $("#bulk-cat").value.trim();
          const { error } = await sb.from("items").insert(row);
          if (error) throw error;
          ok++;
        } catch (x){
          if (path) sb.storage.from("items").remove([path]);
          showMsg(err, `${f.name}: ${errMsg(x)}`); break;
        }
      }
      st.textContent = `${ok}개 추가했습니다.`;
      if (ok){ toast(`아이템 ${ok}개를 추가했습니다`); await admLoad("items"); admRenderCrud("items"); refreshPublic(); }
      if (ok === files.length){ d.close(); e.target.reset(); $("#bulk-prev").innerHTML = ""; $("#bulk-pick").textContent = "이미지 고르기"; st.textContent = ""; }
    });
  });
  return d;
}
admPanel().addEventListener("click", e => { if (e.target.closest("[data-adm-bulk]")) bulkDlg().showModal(); });
