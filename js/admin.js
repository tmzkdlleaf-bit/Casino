import { loadMine } from "./auth.js";
import { CONFIG } from "./config.js";
import { FOCUS, LOGS, USE_DB, fmtDate, parseFocus, publicUrl, refreshPublic, sb } from "./data.js";
import { $, $$, announce, esc, toast } from "./dom.js";
import { checkField, errMsg, fieldError, showMsg, validateForm, withBusy } from "./forms.js";
import { renderMarkdown } from "./markdown.js";
import { state } from "./state.js";
import { ALL, renderAccount } from "./views.js";

/* =========================================================
   ADMIN — 관리 페이지. 화면만 관리자에게 보이고, 실제 차단은 RLS + RPC가 담당
   ========================================================= */
export const ADM = { tab: "notices", rows: {}, sel: null, dirty: false, tabsDrawn: false };

export const ADMIN_TABS = [["notices", "공지"], ["notice_categories", "공지 분류"], ["characters", "캐릭터"], ["items", "아이템"], ["chapters", "지난 이야기"], ["game_slots", "게임 일정"], ["members", "멤버"]];

export const OPT = {
  kind: [["dealer", "딜러"], ["player", "참가자"]],
  suit: [["spade", "♠ 스페이드"], ["heart", "♥ 하트"], ["club", "♣ 클럽"], ["diamond", "♦ 다이아"]],
  chip: [["green", "초록"], ["red", "빨강"]]
};

/* 캐릭터 입력 칸 — 이미지 초점(image_focus)은 update-4.sql을 실행한 DB에서만 보임 */
const CHAR_FIELDS = [
  { row: [
    { k: "name", label: "이름", type: "text", required: true, max: 40 },
    { k: "slug", label: "주소 이름(slug)", type: "text", required: true, max: 40, pattern: "[a-z0-9\\-]+", patternMsg: "영문 소문자, 숫자, 하이픈(-)만 쓸 수 있습니다.", hint: "프로필 주소에 쓰임 — #characters/이 값" }
  ] },
  { row: [
    { k: "kind", label: "구분", type: "select", required: true, options: () => OPT.kind },
    { k: "sort_order", label: "표시 순서", type: "number", min: 0 }
  ] },
  { row: [
    { k: "suit", label: "카드 무늬 (딜러)", type: "select", options: () => [["", "없음"], ...OPT.suit] },
    { k: "chip_color", label: "칩 색 (참가자)", type: "select", options: () => [["", "없음"], ...OPT.chip] }
  ] },
  { row: [
    { k: "age", label: "나이", type: "text", max: 20 },
    { k: "height", label: "키", type: "text", max: 20 }
  ] },
  { k: "keywords", label: "성격 키워드", type: "tags", hint: "쉼표로 구분 — 예: 침착, 계산적" },
  { k: "description", label: "설명", type: "textarea" },
  { k: "image_path", thumbKey: "thumb_path", label: "캐릭터 이미지", type: "image", bucket: "characters", max: CONFIG.IMG.character, thumb: CONFIG.IMG.characterThumb,
    hint: `세로형 권장. 올리면 WebP로 자동 변환 (긴 변 ${CONFIG.IMG.character}px + 목록용 ${CONFIG.IMG.characterThumb}px)` },
  { k: "image_focus", label: "이미지 초점", type: "focus", img: "image_path", thumbKey: "thumb_path", bucket: "characters",
    hint: "잘려서 보이는 곳(홈·캐릭터 목록·프로필)에서 이미지의 어느 부분을 보여 줄지 정합니다. 비워 두면 기본 위치를 씁니다." }
];

export const SCHEMAS = {
  notices: {
    label: "공지", key: "id", touch: true, needs: ["notice_categories"],
    select: "id, title, body, is_pinned, pin_order, published_at, category_id",
    order: [["is_pinned", { ascending: false }], ["published_at", { ascending: false }]],
    title: r => r.title, meta: r => [r.is_pinned ? "고정" : "", fmtDate(r.published_at)].filter(Boolean).join(" · "),
    fields: [
      { k: "title", label: "제목", type: "text", required: true, max: 120 },
      { row: [
        { k: "category_id", label: "분류", type: "select", options: () => [["", "분류 없음"], ...(ADM.rows.notice_categories || []).map(c => [c.id, c.name])] },
        { k: "published_at", label: "게시 시각", type: "datetime", hint: "비우면 저장하는 시각" }
      ] },
      { row: [
        { k: "is_pinned", label: "상단 고정", type: "check" },
        { k: "pin_order", label: "고정 순서", type: "number", min: 0, hint: "작을수록 위" }
      ] },
      { k: "body", label: "내용", type: "markdown", required: true, hint: "마크다운 사용 가능 — **굵게**, [링크](https://…), - 목록, > 인용" }
    ]
  },
  notice_categories: {
    label: "공지 분류", key: "id", select: "id, name, sort_order", order: [["sort_order"]],
    title: r => r.name, meta: r => r.sort_order != null ? `순서 ${r.sort_order}` : "",
    fields: [
      { k: "name", label: "분류 이름", type: "text", required: true, max: 20 },
      { k: "sort_order", label: "표시 순서", type: "number", min: 0, hint: "작을수록 앞" }
    ]
  },
  characters: {
    label: "캐릭터", key: "id", touch: true, needs: ["items"],
    get select(){ return `id, slug, name, kind, suit, chip_color, image_path, thumb_path${FOCUS.ok ? ", image_focus" : ""}, age, height, keywords, description, sort_order`; },
    order: [["sort_order"]],
    title: r => r.name, meta: r => `${r.kind === "dealer" ? "딜러" : "참가자"} · ${r.slug}`,
    get fields(){ return CHAR_FIELDS.filter(f => f.k !== "image_focus" || FOCUS.ok); },
    after: row => `
      <section class="card sub-editor" aria-labelledby="inv-h">
        <h3 id="inv-h">소지품</h3>
        <p class="hint">아이템은 ‘아이템’ 탭에서 먼저 만들어 두세요. 위에서부터 순서대로 표시됩니다.</p>
        <div class="inv-rows" id="inv-rows"><p class="adm-status">불러오는 중…</p></div>
        <div class="form-actions">
          <button class="btn" type="button" data-inv-add>칸 추가</button>
          <button class="btn primary" type="button" data-inv-save data-char="${esc(row.id)}">소지품 저장</button>
        </div>
        <p class="adm-status" id="inv-status" role="status"></p>
      </section>`
  },
  items: {
    label: "아이템", key: "id", touch: true, select: "id, name, description, image_path, price, stock, is_for_sale, sort_order", order: [["sort_order"]],
    title: r => r.name, meta: r => [r.is_for_sale ? `판매 ${r.price ?? 0}칩` : "비매품", r.stock != null ? `재고 ${r.stock}` : ""].filter(Boolean).join(" · "),
    fields: [
      { k: "name", label: "이름", type: "text", required: true, max: 40 },
      { k: "description", label: "설명", type: "textarea" },
      { row: [
        { k: "price", label: "가격 (칩)", type: "number", min: 0, nullable: true, hint: "비우면 가격 없음" },
        { k: "stock", label: "재고", type: "number", min: 0, nullable: true, hint: "비우면 무제한" }
      ] },
      { row: [
        { k: "is_for_sale", label: "상점에 표시", type: "check" },
        { k: "sort_order", label: "표시 순서", type: "number", min: 0 }
      ] },
      { k: "image_path", label: "아이템 이미지", type: "image", bucket: "items", max: CONFIG.IMG.item, hint: `정사각형 권장. WebP로 자동 변환 (긴 변 ${CONFIG.IMG.item}px), 투명 배경 유지` }
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
      { k: "memo", label: "메모", type: "textarea", hint: "화면에는 표시되지 않지만 누구나 조회할 수 있는 칸입니다. 비밀 내용은 적지 마세요." }
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
      { k: "summary", label: "요약", type: "textarea", hint: "지난 이야기 목록과 홈에 표시" },
      { k: "body", label: "본문", type: "textarea", hint: "상세 기록 (현재 공개 화면에는 표시되지 않음)" }
    ],
    after: row => LOGS.ok ? `
      <section class="card sub-editor" aria-labelledby="log-h">
        <h3 id="log-h">진행 기록 (코코포리아 로그)</h3>
        <p class="hint">코코포리아에서 내보낸 로그 파일(.html 또는 .txt)을 올리면 사이트 모양으로 바꿔 저장합니다. 원본 파일은 올라가지 않습니다. 대사 수정과 구간 BGM은 저장한 뒤 기록 화면의 ‘편집’에서 합니다.</p>
        <p class="adm-status" id="log-now">${row.log_path ? `저장된 기록이 있습니다 — <a href="#story/${esc(String(row.number))}">보기</a>` : "아직 저장된 기록이 없습니다."}</p>
        <div class="field"><label for="log-file">로그 파일</label><input type="file" id="log-file" accept=".html,.htm,.txt" aria-describedby="log-file-err"><span class="field-error" id="log-file-err" hidden></span></div>
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
  $("#admin-tabs").innerHTML = ADMIN_TABS.map(([id, label]) =>
    `<button type="button" role="tab" id="tab-${id}" data-tab="${id}" aria-controls="admin-panel" aria-selected="${id === ADM.tab}" tabindex="${id === ADM.tab ? 0 : -1}">${label}</button>`).join("");
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
  l.id = "admin-css"; l.rel = "stylesheet"; l.href = "css/admin.css";
  document.head.append(l);
}

export async function admOpen(){
  if (!USE_DB || !state.isAdmin) return;
  ensureAdminCss();
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
    const s = SCHEMAS[tab];
    await Promise.all([admLoad(tab), ...(s.needs || []).map(admLoad)]);
    admRenderCrud(tab);
  } catch (err){
    panel.innerHTML = `<p class="form-error" role="alert">${esc(errMsg(err))}</p>`;
  }
}

export function admRenderCrud(table){
  const s = SCHEMAS[table], rows = ADM.rows[table] || [];
  const sel = ADM.sel == null ? null : String(ADM.sel);
  admPanel().innerHTML = `
    <div class="adm">
      <div class="adm-list">
        <button class="btn primary" type="button" data-adm-new>새 ${s.label} 추가</button>
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
      return `<div class="field">${label}<textarea class="input" name="${f.k}" id="${id}" rows="5"${req} ${desc}>${esc(val ?? "")}</textarea>${hint}${err}</div>`;
    case "markdown":
      return `<div class="field">${label}
        <div class="md-tools"><button class="btn small" type="button" data-md-preview="${id}" aria-pressed="false" aria-controls="${id} ${id}-prev">미리보기</button></div>
        <textarea class="input" name="${f.k}" id="${id}" rows="12"${req} ${desc}>${esc(val ?? "")}</textarea>
        <div class="md-preview md" id="${id}-prev" hidden tabindex="0" aria-label="미리보기"></div>${hint}${err}</div>`;
    case "number":
      return `<div class="field">${label}<input class="input" type="number" inputmode="numeric" step="1" name="${f.k}" id="${id}" value="${val ?? ""}"${f.min != null ? ` min="${f.min}"` : ""}${req} ${desc}>${hint}${err}</div>`;
    case "datetime":
      return `<div class="field">${label}<input class="input" type="datetime-local" name="${f.k}" id="${id}" value="${toLocalInput(val)}"${req} ${desc}>${hint}${err}</div>`;
    case "date":
      return `<div class="field">${label}<input class="input" type="date" name="${f.k}" id="${id}" value="${esc(val ?? "")}"${req} ${desc}>${hint}${err}</div>`;
    case "tags":
      return `<div class="field">${label}<input class="input" type="text" name="${f.k}" id="${id}" value="${esc((val || []).join(", "))}"${req} ${desc}>${hint}${err}</div>`;
    case "image": {
      const url = val ? publicUrl(f.bucket, (f.thumbKey && v[f.thumbKey]) || val) : "";
      return `<div class="field"><label class="label-like" id="${id}-lbl" for="${id}">${esc(f.label)}</label>
        <div class="img-field">
          <div class="img-prev" id="${id}-prev">${url ? `<img src="${esc(url)}" alt="현재 이미지">` : `<span aria-hidden="true">없음</span>`}</div>
          <div>
            <input type="file" accept="image/*" name="${f.k}" id="${id}" ${desc}>
            ${val ? `<label class="check"><input type="checkbox" name="${f.k}__remove">이미지 삭제</label>` : ""}
          </div>
        </div>${hint}${err}</div>`;
    }
    case "focus": {
      const [x, y] = parseFocus(val) || [50, 15];
      const src = v[f.img] ? publicUrl(f.bucket, v[f.thumbKey] || v[f.img]) : "";
      const pos = `object-position:${x}% ${y}%`;
      return `<fieldset class="field focus-f" data-focus aria-describedby="${id}-hint"><legend>${esc(f.label)}</legend>
        ${src ? `<div class="focus-prev" aria-hidden="true">${[["wide", "홈"], ["tall", "목록"], ["sq", "프로필"]].map(([k, t]) =>
          `<span class="fp ${k}"><img src="${esc(src)}" alt="" style="${pos}"><small>${t}</small></span>`).join("")}</div>` : `<p class="hint">이미지를 올려 저장한 뒤에 정할 수 있습니다.</p>`}
        <div class="row2">
          <label class="rng">가로 <input type="range" min="0" max="100" step="1" value="${x}" data-axis="x"${src ? "" : " disabled"}><output>${x}</output></label>
          <label class="rng">세로 <input type="range" min="0" max="100" step="1" value="${y}" data-axis="y"${src ? "" : " disabled"}><output>${y}</output></label>
        </div>
        <input type="hidden" name="${f.k}" id="${id}" value="${esc(val ?? "")}">
        <div class="form-actions"><button class="btn small" type="button" data-focus-reset${src ? "" : " disabled"}>기본 위치로</button><span class="hint focus-state">${val ? "직접 정함" : "기본 위치 사용 중"}</span></div>
        ${hint}</fieldset>`;
    }
    default:
      return `<div class="field">${label}<input class="input" type="text" name="${f.k}" id="${id}" value="${esc(val ?? "")}"${f.max ? ` maxlength="${f.max}"` : ""}${f.pattern ? ` pattern="${esc(f.pattern)}" data-pattern-msg="${esc(f.patternMsg || "")}"` : ""}${req} ${desc}>${hint}${err}</div>`;
  }
}

export function admCurrentRow(table){
  const s = SCHEMAS[table];
  return ADM.sel == null ? null : (ADM.rows[table] || []).find(r => String(r[s.key]) === String(ADM.sel)) || null;
}

export function admRenderEditor(table){
  const s = SCHEMAS[table], row = admCurrentRow(table), v = row || (table === "items" ? { is_for_sale: true } : {});
  $("#adm-editor").innerHTML = `
    <form class="form card" id="adm-form" data-table="${table}" novalidate aria-labelledby="adm-form-h">
      <h2 class="card-h" id="adm-form-h" tabindex="-1">${row ? esc(s.title(row) || "(제목 없음)") : `새 ${s.label}`}</h2>
      <p class="hint">* 표시는 필수 항목입니다.</p>
      <p class="form-error" id="adm-error" role="alert" hidden></p>
      ${s.fields.map(f => f.row ? `<div class="row2">${f.row.map(x => admField(table, x, v)).join("")}</div>` : admField(table, f, v)).join("")}
      <div class="form-actions">
        <button class="btn primary" type="submit">${row ? "저장" : "추가"}</button>
        ${row ? `<button class="btn danger" type="button" data-adm-del>삭제</button>` : ""}
      </div>
      <p class="adm-status" id="adm-status" role="status"></p>
    </form>
    ${row && s.after ? s.after(row) : ""}`;
  state.admDirty = false;
  if (row && table === "characters") admLoadInventory(row.id);
}

export function admCollect(form, s){
  const out = {};
  for (const f of flatFields(s)){
    const el = form.elements[f.k];
    if (!el || f.type === "image") continue;
    const raw = typeof el.value === "string" ? el.value.trim() : el.value;
    switch (f.type){
      case "check": out[f.k] = el.checked; break;
      case "number": out[f.k] = raw === "" ? (f.nullable ? null : 0) : Number(raw); break;   // 대부분 NOT NULL default 0
      case "tags": out[f.k] = raw.split(/[,，、]/).map(t => t.trim()).filter(Boolean); break;
      case "datetime": out[f.k] = raw ? new Date(raw).toISOString() : (f.k === "published_at" ? new Date().toISOString() : null); break;
      case "select": case "date": case "focus": out[f.k] = raw === "" ? null : raw; break;
      default: out[f.k] = raw;   // 텍스트는 빈 문자열 그대로 (NOT NULL default '' 컬럼)
    }
  }
  if (s.touch) out.updated_at = new Date().toISOString();
  return out;
}

/* 이미지 → WebP (지원하지 않는 브라우저는 PNG/JPEG). 긴 변을 max px로 축소 */
export async function toWebP(file, max){
  if (!/^image\//.test(file.type)) throw new Error("이미지 파일만 올릴 수 있습니다.");
  if (file.size > 25 * 1024 * 1024) throw new Error("25MB 이하 이미지만 올릴 수 있습니다.");
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d"); ctx.imageSmoothingQuality = "high"; ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const enc = (type, q) => new Promise(r => c.toBlob(r, type, q));
  const webp = await enc("image/webp", .86);
  if (webp && webp.type === "image/webp") return webp;
  return file.type === "image/png" ? enc("image/png") : enc("image/jpeg", .88);
}

export const extOf = blob => ({ "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" })[blob.type] || "bin";

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

/* ----- 멤버 · 캐릭터별 칩 ----- */
export async function admMembers(){
  const [pr, ch, bl] = await Promise.all([
    sb.from("profiles").select("id, email, display_name, role, created_at").order("created_at"),
    sb.from("characters").select("id, owner_id"),
    sb.from("chip_balances").select("character_id, balance")
  ]);
  const failed = [pr, ch, bl].find(r => r.error);
  if (failed) throw failed.error;
  const members = pr.data, owner = new Map(ch.data.map(c => [c.id, c.owner_id])), bal = new Map(bl.data.map(b => [b.character_id, b.balance ?? 0]));
  const chars = ALL();
  const nameOf = m => m.display_name || (m.email || "").split("@")[0] || "이름 없음";
  admPanel().innerHTML = `
    <div class="card">
      <h2 class="card-h">멤버</h2>
      <p class="form-note">새 멤버 초대: Supabase 대시보드 → Authentication → Users → <strong>Invite user</strong>. 초대받은 사람은 메일의 링크로 들어와 비밀번호를 정합니다.</p>
      <div class="table-scroll" style="margin-top:1.25rem">
        <table class="members" style="min-width:36rem">
          <caption class="sr">멤버 목록 — 이름, 역할, 소유 캐릭터</caption>
          <thead><tr><th scope="col">멤버</th><th scope="col">역할</th><th scope="col">소유 캐릭터</th></tr></thead>
          <tbody>${members.map(m => `<tr>
            <th scope="row" class="who" style="font-weight:400">${esc(nameOf(m))}<small>${esc(m.email || "")}</small></th>
            <td class="${m.role === "admin" ? "tag-d" : ""}">${m.role === "admin" ? "관리자" : "멤버"}</td>
            <td>${esc(chars.filter(c => owner.get(c.uuid) === m.id).map(c => c.name).join(", ") || "—")}</td>
          </tr>`).join("") || `<tr><td colspan="3" class="muted">멤버가 없습니다.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
    <div class="card" style="margin-top:1.5rem">
      <h2 class="card-h">캐릭터별 소유자 · 칩</h2>
      <div class="table-scroll">
        <table class="members">
          <caption class="sr">캐릭터별 소유 멤버, 보유 칩, 칩 지급·차감</caption>
          <thead><tr><th scope="col">캐릭터</th><th scope="col">소유 멤버</th><th scope="col">칩</th><th scope="col">칩 지급·차감</th></tr></thead>
          <tbody>${chars.map(c => {
            const nm = esc(c.name), cur = owner.get(c.uuid) || "";
            return `<tr>
              <th scope="row" class="who" style="font-weight:400">${nm}<small>${c.role}</small></th>
              <td><label class="sr" for="own-${c.uuid}">${nm} 소유 멤버</label>
                <select class="input" id="own-${c.uuid}" data-owner="${c.uuid}" data-prev="${esc(cur)}">
                  <option value="">없음</option>
                  ${members.map(m => `<option value="${m.id}"${m.id === cur ? " selected" : ""}>${esc(nameOf(m))}</option>`).join("")}
                </select></td>
              <td id="chips-${c.uuid}">${(bal.get(c.uuid) ?? 0).toLocaleString("ko-KR")}</td>
              <td><form class="chip-form" data-chips="${c.uuid}" data-name="${nm}" novalidate>
                <label class="sr" for="cd-${c.uuid}">${nm} 칩 증감 (차감은 음수)</label>
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
  if (t.closest("[data-log-bm-copy]")){ const { BOOKMARKLET } = await import("./logparse.js"); try { await navigator.clipboard.writeText(BOOKMARKLET); toast("북마크 코드를 복사했습니다"); } catch (_){ toast("복사하지 못했습니다"); } return; }
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
      const { data, error } = await sb.rpc("admin_adjust_chips", { p_character: f.dataset.chips, p_amount: delta, p_reason: f.reason.value.trim() });
      if (error){ fieldError(input, errMsg(error)); input.focus(); return; }
      $("#chips-" + f.dataset.chips).textContent = data.toLocaleString("ko-KR");
      f.reset(); fieldError(input, "");
      announce(`${f.dataset.name} 칩 ${delta > 0 ? "+" : ""}${delta}, 잔액 ${data}`);
      toast(`${f.dataset.name} 칩 ${delta > 0 ? "+" : ""}${delta} → 잔액 ${data.toLocaleString("ko-KR")}`);
      if (state.mine.some(m => m.uuid === f.dataset.chips)){ await loadMine(); renderAccount(); }
    });
  }
});

admPanel().addEventListener("change", async e => {
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

admPanel().addEventListener("change", e => { if (e.target.id === "log-file") logRead(e.target); });

admPanel().addEventListener("change", e => {
  const file = e.target.closest('#adm-form input[type="file"]');
  if (!file) return;
  state.admDirty = true;
  const f = file.files[0], prev = document.getElementById(file.id + "-prev");
  if (!f) return;
  if (!/^image\//.test(f.type)){ fieldError(file, "이미지 파일만 올릴 수 있습니다."); file.value = ""; return; }
  fieldError(file, "");
  const url = URL.createObjectURL(f);
  prev.innerHTML = `<img src="${url}" alt="새로 올릴 이미지 미리보기">`;
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
  const { parseLog, analyze, BOOKMARKLET } = await import("./logparse.js");
  const messages = parseLog(await f.text());
  $("#log-status").textContent = "";
  if (!messages.length){ fieldError(input, "대사를 찾지 못했습니다. 코코포리아에서 내보낸 로그 파일이 맞는지 확인해 주세요."); return; }
  LOG.messages = messages; LOG.info = analyze(messages); LOG.name = f.name;
  const tabs = LOG.info.tabs, sp = LOG.info.speakers;
  opts.innerHTML = `
    <p class="form-note">대사 ${messages.length.toLocaleString("ko-KR")}개 · 탭 ${tabs.length}개 · 화자 ${sp.length}명을 찾았습니다.</p>
    <fieldset class="log-fs"><legend>저장할 탭</legend>
      ${tabs.map((t, i) => `<label class="check"><input type="checkbox" name="log-tab" value="${i}" ${t.format === "secret" ? "" : "checked"}>${esc(t.name)} <span class="hint" style="margin:0">(${t.count.toLocaleString("ko-KR")})</span></label>`).join("")}
      <p class="hint">비밀 탭은 처음에 빠져 있습니다. 잡담 탭은 저장되지만 보는 화면에서 처음엔 접혀 있습니다.</p>
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

function libSummary(extra = ""){
  const names = new Set(LOG.library.map(c => c.name.trim()));
  const hit = LOG.info.speakers.filter(s => names.has(s.name.trim())).length;
  const faces = LOG.library.reduce((n, c) => n + c.faces.length + (c.iconUrl ? 1 : 0), 0);
  $("#log-lib-status").textContent = `캐릭터 ${LOG.library.length}명 · 이미지 ${faces}개 불러옴 — 로그 화자 ${hit}/${LOG.info.speakers.length}명과 이름이 맞음${extra}`;
}

async function logRoom(){
  const { roomIdFrom, loadRoom, alignRoomFaces } = await import("./logparse.js");
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
  const { parseLibrary } = await import("./logparse.js");
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
  const { pack } = await import("./logparse.js");
  const include = new Set($$('input[name="log-tab"]:checked').map(i => LOG.info.tabs[+i.value].name));
  const narrators = new Set($$('input[name="log-narr"]:checked').map(i => LOG.info.speakers[+i.value].name));
  if (!include.size){ $("#log-status").textContent = "저장할 탭을 하나 이상 골라 주세요."; return; }
  const row = (ADM.rows.chapters || []).find(r => r.id === id);
  if (row?.log_path && !confirm("이미 저장된 기록을 새 로그로 바꿉니다. 기록 화면에서 고친 대사와 BGM 구간은 사라집니다. 계속할까요?")) return;
  const data = pack(LOG.messages, { include, narrators, stripTag: $("#log-strip").checked, src: LOG.name, library: LOG.library });
  try {
    if (data.faces.length){
      const r = await backupFaces(data.faces, (d, n) => { $("#log-status").textContent = `표정 이미지 복사 중… ${d}/${n}`; });
      data.faces = r.faces;
      if (r.ok < data.faces.length) toast(`이미지 ${data.faces.length - r.ok}개는 코코포리아가 복사를 막아 원본 주소로 연결했습니다`);
    }
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const path = `ch-${id}-${Date.now()}.json`;
    $("#log-status").textContent = `저장 중… (${Math.ceil(blob.size / 1024).toLocaleString("ko-KR")}KB)`;
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
  toast("기록을 삭제했습니다");
  await admLoad("chapters"); admRenderCrud("chapters");
  refreshPublic();
}
