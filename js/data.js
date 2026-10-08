import { loadMine } from "./auth.js?v=20261009c";
import { CONFIG } from "./config.js?v=20261009c";
import { $ } from "./dom.js?v=20261009c";
import { route } from "./router.js?v=20261009c";
import { DATA, nav, state } from "./state.js?v=20261009c";
import { renderAccount, renderCast, renderHome, renderRecords, renderShop, renderStory } from "./views.js?v=20261009c";

/* =========================================================
   DATA LAYER — Supabase 조회 → 화면용 DATA 모양으로 변환
   ========================================================= */
export const DB_CONFIGURED = !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);

export const USE_DB = DB_CONFIGURED && !!window.supabase;

/* 초대·비밀번호 재설정 메일 링크는 #access_token=…&type=invite 형태로 돌아옴.
   해시 라우터가 이를 페이지 주소로 읽기 전에 먼저 챙겨 둠 */
export const AUTH_HASH = (() => {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.has("access_token") && !h.has("error")) return null;
  return { type: h.get("type"), error: h.get("error_code") || h.get("error"), errorText: h.get("error_description") };
})();

export const sb = USE_DB ? supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: { flowType: "implicit", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
}) : null;

export const SUIT_MAP = { spade: "♠", heart: "♥", club: "♣", diamond: "♦" };

export const publicUrl = (bucket, path) => path ? sb.storage.from(bucket).getPublicUrl(path).data.publicUrl : "";

export const fmtDate = iso => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
};

/* 이미지 초점 "가로 세로"(0~100) → CSS object-position. 없거나 형식이 틀리면 "" (사이트 기본 위치) */
export const parseFocus = v => {
  const m = /^(\d{1,3}) (\d{1,3})$/.exec(v || "");
  return m && +m[1] <= 100 && +m[2] <= 100 ? [+m[1], +m[2]] : null;
};
export const focusCss = v => { const f = parseFocus(v); return f ? `${f[0]}% ${f[1]}%` : ""; };

export function mapCharacter(r){
  return {
    id: r.slug,
    uuid: r.id,
    name: r.name,
    role: r.kind === "dealer" ? "딜러" : "참가자",
    suit: SUIT_MAP[r.suit] || "♠",
    chip: r.chip_color || "green",
    img: publicUrl("characters", r.image_path),
    thumb: publicUrl("characters", r.thumb_path),
    focus: focusCss(r.image_focus),
    age: r.age, height: r.height,
    keywords: r.keywords || [],
    description: r.description || "",
    inventory: (r.inventory || [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(v => ({
        name: v.items?.name ?? "",
        description: v.items?.description ?? "",
        img: publicUrl("items", v.items?.image_path),
        quantity: v.quantity,
        note: v.note
      }))
  };
}

export function withTimeout(promise, ms = 12000){
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

/* 나중에 추가한 칸: update SQL을 아직 실행하지 않은 DB에서도 동작하도록, 칸이 없으면 빼고 다시 조회
   LOGS — chapters.log_path (update-3.sql) / FOCUS — characters.image_focus (update-4.sql) */
export const LOGS = { ok: true };
export const FOCUS = { ok: true };
const charQuery = () => sb.from("characters")
  .select(`id, slug, name, kind, suit, chip_color, image_path, thumb_path${FOCUS.ok ? ", image_focus" : ""}, age, height, keywords, description, sort_order, inventory(quantity, note, sort_order, items(name, description, image_path))`)
  .order("sort_order");
const chapterQuery = () => sb.from("chapters").select(`id, number, title, summary, played_on${LOGS.ok ? ", log_path" : ""}`).order("number");
const missingCol = (e, col) => e && (e.code === "42703" || e.code === "PGRST204") && new RegExp(col).test(e.message || "");

/* 전적: 최신순. game_records 표는 update-5.sql로 만듦 — 아직 없거나 읽을 수 없으면 빈 목록으로 두고 화면은 계속 */
export const pad2 = n => String(n).padStart(2, "0");
export const fmtTime = iso => { if (!iso) return ""; const d = new Date(iso); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
export const RECORDS = { ok: true };
export async function loadRecords(byUuid){
  const { data, error } = await sb.from("game_records")
    .select("id, played_at, game_name, winner_id, participant_ids, chips, note")
    .order("played_at", { ascending: false }).limit(500);
  if (error){ RECORDS.ok = false; console.warn("[data] game_records:", error.message); return []; }
  RECORDS.ok = true;
  return (data || []).map(r => ({
    id: r.id, iso: r.played_at, date: fmtDate(r.played_at), time: fmtTime(r.played_at), game: r.game_name || "",
    winner: byUuid[r.winner_id] || null,
    players: (r.participant_ids || []).map(id => byUuid[id]?.name).filter(Boolean),
    chips: r.chips || 0, note: r.note || ""
  }));
}

/* 게임 일정: 지금부터 끝나지 않은 것만, 가까운 순. 읽기 권한이 없거나 표가 비어도 화면은 계속 */
export async function loadSlots(){
  const { data, error } = await sb.from("game_slots")
    .select("id, game, dealer_character_id, starts_at, ends_at, status")
    .gte("starts_at", new Date(Date.now() - 6 * 36e5).toISOString())
    .order("starts_at").limit(6);
  if (error){ console.warn("[data] game_slots:", error.message); return []; }
  return (data || []).filter(s => s.status !== "cancelled" && s.status !== "canceled");
}

export async function loadAll(){
  let q = await withTimeout(Promise.all([
    // 필요한 컬럼만 명시 — 나중에 비공개 컬럼을 추가해도 노출되지 않게
    charQuery(),
    chapterQuery(),
    sb.from("items").select("id, name, description, image_path, price, stock, sort_order")
      .eq("is_for_sale", true).order("sort_order"),
    loadSlots().then(data => ({ data, error: null }))
  ]));
  if (FOCUS.ok && missingCol(q[0].error, "image_focus")){ FOCUS.ok = false; q = [...q]; q[0] = await charQuery(); }
  if (LOGS.ok && missingCol(q[1].error, "log_path")){ LOGS.ok = false; q = [...q]; q[1] = await chapterQuery(); }
  const failed = q.find(r => r.error);
  if (failed) throw failed.error;
  const [chars, chapters, items, slots] = q.map(r => r.data);

  const all = chars.map(mapCharacter);
  const byUuid = Object.fromEntries(all.map(c => [c.uuid, c]));
  const records = await withTimeout(loadRecords(byUuid)).catch(() => []);
  return {
    dealers: all.filter(c => c.role === "딜러"),
    players: all.filter(c => c.role === "참가자"),
    chapters: chapters.map(c => ({ id: c.id, number: c.number, title: c.title, summary: c.summary, date: fmtDate(c.played_on), iso: c.played_on, log: publicUrl("logs", c.log_path) })),
    items: items.map(it => ({ id: it.id, name: it.name, description: it.description, price: it.price, stock: it.stock, img: publicUrl("items", it.image_path) })),
    slots: slots.map(s => ({ id: s.id, game: s.game || "", start: s.starts_at, end: s.ends_at, dealer: byUuid[s.dealer_character_id] || null })),
    records
  };
}

export function showBootError(err){
  console.error("[data] load failed:", err);
  $("#boot").classList.remove("hide");
  $("#boot").innerHTML = `
    <div class="boot-error" role="alert">
      <h2 tabindex="-1">불러오지 못했습니다</h2>
      <p>잠시 후 다시 시도해 주세요.</p>
      <button class="btn" type="button" id="boot-retry">다시 시도</button>
    </div>`;
  $("#boot-retry").addEventListener("click", () => location.reload());
  document.body.classList.remove("intro-on");
  $("#intro")?.remove();
  [$("#skip-link"), $("#site-head"), $("#app")].forEach(el => el.inert = true);  // 오류 화면 뒤는 조작 불가
  $("#boot .btn").focus();
}

/* =========================================================
   REALTIME — 내 칩이 새로고침 없이 갱신됨
   ========================================================= */
export let chanProfile = null;

export function subscribeProfile(){
  if (!USE_DB) return;
  const uid = state.session?.user.id;
  if (chanProfile && chanProfile.uid === uid) return;
  if (chanProfile){ sb.removeChannel(chanProfile); chanProfile = null; }
  if (!uid) return;
  chanProfile = sb.channel("me:" + uid)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${uid}` }, ({ new: row }) => {
      const wasAdmin = state.isAdmin;
      state.profile = { ...state.profile, ...row };
      state.isAdmin = state.profile.role === "admin";
      renderAccount();
      if (wasAdmin !== state.isAdmin) route();
    })
    // 칩 기록은 RLS 때문에 내 캐릭터 것(관리자는 전부)만 도착함 → 잔액 다시 조회
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chip_ledger" }, () => loadMine().then(renderAccount))
    .subscribe();
  chanProfile.uid = uid;
}

/* 관리 페이지에서 저장한 뒤 공개 화면 데이터 새로 고침 */
export async function refreshPublic(){
  try {
    Object.assign(DATA, await loadAll());
    renderHome(); renderCast(); renderStory(); renderShop(); renderAccount();
    if (nav.current === "game") renderRecords();
  } catch (err){ console.error("[data] refresh failed:", err); }
}
