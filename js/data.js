import { loadMine } from "./auth.js";
import { CONFIG } from "./config.js";
import { $ } from "./dom.js";
import { route } from "./router.js";
import { DATA, nav, state } from "./state.js";
import { renderAccount, renderCast, renderHome, renderHomeNotices, renderNotice, renderNoticeList, renderNoticeSeg, renderShop, renderStory } from "./views.js";

/* =========================================================
   DATA LAYER — Supabase 조회 → 화면용 DATA 모양으로 변환
   세계관(DATA.world)은 DB가 아니라 이 파일의 더미 데이터 자리에서 직접 작성합니다.
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

export const noticeQuery = () => sb.from("notices")
  .select("id, title, body, is_pinned, pin_order, published_at, notice_categories(name)")
  .order("is_pinned", { ascending: false }).order("pin_order")
  .order("published_at", { ascending: false });

export const mapNotice = n => ({
  id: String(n.id), title: n.title, body: n.body, date: fmtDate(n.published_at), iso: n.published_at,
  category: n.notice_categories?.name ?? "", pinned: n.is_pinned, pinOrder: n.pin_order
});

export function withTimeout(promise, ms = 12000){
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

export async function loadAll(){
  const q = await withTimeout(Promise.all([
    // 필요한 컬럼만 명시 — 나중에 비공개 컬럼을 추가해도 노출되지 않게
    sb.from("characters")
      .select("id, slug, name, kind, suit, chip_color, image_path, thumb_path, age, height, keywords, description, sort_order, inventory(quantity, note, sort_order, items(name, description, image_path))")
      .order("sort_order"),
    noticeQuery(),
    sb.from("notice_categories").select("name").order("sort_order"),
    sb.from("chapters").select("number, title, summary, played_on").order("number"),
    sb.from("items").select("id, name, description, image_path, price, stock, sort_order")
      .eq("is_for_sale", true).order("sort_order")
  ]));
  const failed = q.find(r => r.error);
  if (failed) throw failed.error;
  const [chars, notices, cats, chapters, items] = q.map(r => r.data);

  const all = chars.map(mapCharacter);
  return {
    dealers: all.filter(c => c.role === "딜러"),
    players: all.filter(c => c.role === "참가자"),
    categories: cats.map(c => c.name),
    notices: notices.map(mapNotice),
    chapters: chapters.map(c => ({ number: c.number, title: c.title, summary: c.summary, date: fmtDate(c.played_on), iso: c.played_on })),
    items: items.map(it => ({ id: it.id, name: it.name, description: it.description, price: it.price, stock: it.stock, img: publicUrl("items", it.image_path) }))
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
  [$("#skip-link"), $("#site-head"), $("#app"), $(".site-foot")].forEach(el => el.inert = true);  // 오류 화면 뒤는 조작 불가
  $("#boot .btn").focus();
}

/* =========================================================
   REALTIME — 공지·내 칩이 새로고침 없이 갱신됨
   ========================================================= */
export let chanNotices = null, chanProfile = null, noticeTimer = 0;

export function subscribeNotices(){
  if (!USE_DB || chanNotices) return;
  chanNotices = sb.channel("public:notices")
    .on("postgres_changes", { event: "*", schema: "public", table: "notices" }, () => {
      clearTimeout(noticeTimer); noticeTimer = setTimeout(reloadNotices, 400);   // 연속 변경은 한 번에
    })
    .subscribe();
}

export async function reloadNotices(){
  const { data, error } = await noticeQuery();
  if (error) return;
  DATA.notices = data.map(mapNotice);
  renderHomeNotices();
  if (nav.current === "notices") renderNoticeList();
  if (nav.current === "notice"){
    const id = nav.key.split("/")[1];
    // 읽는 중인 공지는 포커스를 옮기지 않고 내용만 교체. 삭제됐다면 '없는 페이지'로
    if (DATA.notices.some(n => n.id === id)) renderNotice(id); else route();
  }
}

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
    renderHome(); renderCast(); renderStory(); renderShop(); renderNoticeSeg(); renderAccount();
  } catch (err){ console.error("[data] refresh failed:", err); }
}
