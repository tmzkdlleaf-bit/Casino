/* =========================================================
   상점 구매 — 요청 → 관리자 승인 → 코인 차감·소지품 지급 (supabase/update-7.sql)
   요청할 때는 코인이 빠지지 않고, 승인되는 순간 서버에서 한 번에 처리됨
   ========================================================= */
import { CURRENCY, USE_DB, itemCols, mapItem, publicUrl, sb, fmtDate, fmtTime } from "./data.js?v=20261031h";
import { $, CUR, chipAmt, curOf, esc, toast, announce } from "./dom.js?v=20261031h";
import { errMsg, showMsg, withBusy } from "./forms.js?v=20261031h";
import { DATA, state } from "./state.js?v=20261031h";
import { balOf, myChars, renderShop } from "./views.js?v=20261031h";

export const SHOP = { reqs: [], ok: true, loaded: false };
export const STATUS = { pending: "승인 대기", approved: "승인됨", rejected: "거절됨", cancelled: "취소함" };
const missingTable = e => /42P01|PGRST205|PGRST202|shop_request/.test(`${e?.code} ${e?.message}`);
const n = v => Number(v || 0).toLocaleString("ko-KR");

/* 내 캐릭터들의 최근 요청 30개 */
export async function loadMyRequests(){
  const ids = state.mine.map(m => m.uuid);
  if (!USE_DB || !state.session || !ids.length){ SHOP.reqs = []; SHOP.loaded = true; return; }
  let { data, error } = await sb.from("shop_requests")
    .select(`id, character_id, item_id, item_name, unit_price, quantity, total, status, memo, admin_note, created_at, decided_at${CURRENCY.ok ? ", currency" : ""}`)
    .in("character_id", ids).order("created_at", { ascending: false }).limit(30);
  if (error && CURRENCY.ok && /currency/.test(error.message || "")){ CURRENCY.ok = false; return loadMyRequests(); }   // update-12.sql 전
  SHOP.loaded = true;
  if (error){ SHOP.ok = !missingTable(error); SHOP.reqs = []; if (SHOP.ok) console.warn("[shop]", error.message); return; }
  SHOP.ok = true;
  SHOP.reqs = data || [];
}

/* 대기 중인 요청 합계 — 이만큼은 승인되면 빠질 코인 */
export const pendingOf = (uuid, cur = "blue") => SHOP.reqs.filter(r => r.character_id === uuid && r.status === "pending" && curOf(r.currency) === curOf(cur)).reduce((s, r) => s + r.total, 0);

/* 기본으로 고를 캐릭터: 참가자 우선 */
export const buyers = () => myChars().sort((a, b) => (a.role === "참가자" ? 0 : 1) - (b.role === "참가자" ? 0 : 1));
let buyer = null;

/* 상점 오른쪽 창 아래쪽: 구매 요청 칸 */
export function buyHtml(it){
  if (!USE_DB) return `<p class="hint">구매는 사이트가 데이터베이스에 연결된 뒤에 쓸 수 있습니다.</p>`;
  if (!state.session) return `<p class="hint">구매하려면 <a href="#login">로그인</a>해 주세요.</p>`;
  const list = buyers();
  if (!list.length) return `<p class="hint">연결된 캐릭터가 없어 구매할 수 없습니다. 관리자에게 캐릭터 연결을 요청해 주세요.</p>`;
  if (!SHOP.ok) return `<p class="hint">구매 기능이 아직 준비되지 않았습니다. (관리자: supabase/update-7.sql 실행 필요)</p>`;
  if (it.price == null) return `<p class="hint">가격이 정해지지 않은 상품입니다.</p>`;
  if (it.stock === 0) return `<p class="hint">품절된 상품입니다.</p>`;
  if (!list.some(c => c.uuid === buyer)) buyer = list[0].uuid;
  const c = list.find(x => x.uuid === buyer), max = Math.min(99, it.stock ?? 99);
  return `<form class="buy" id="buy-form" novalidate>
    ${list.length > 1 ? `<div class="field"><label for="buy-char">어느 캐릭터로</label><select class="input" id="buy-char">${list.map(x =>
      `<option value="${esc(x.uuid)}"${x.uuid === buyer ? " selected" : ""}>${esc(x.name)} — ${CUR[curOf(it.currency)].short} ${n(balOf(x, it.currency))}</option>`).join("")}</select></div>` : ""}
    <div class="buy-row">
      <div class="field"><label for="buy-qty">수량</label><input class="input" id="buy-qty" type="number" inputmode="numeric" min="1" max="${max}" step="1" value="1"></div>
      <p class="buy-total" aria-live="polite"><span>합계</span><strong id="buy-total">${chipAmt(it.price, it.currency)}</strong></p>
    </div>
    <div class="field"><label for="buy-memo">남길 말 <span class="hint" style="display:inline">(선택)</span></label><input class="input" id="buy-memo" maxlength="200" autocomplete="off"></div>
    <p class="hint" id="buy-bal">${buyBalText(c, it.price, it.currency)}</p>
    <p class="form-error" id="buy-err" role="alert" hidden></p>
    <button class="btn primary" type="submit" data-item-id="${esc(it.id)}">구매 요청</button>
  </form>`;
}

function buyBalText(c, total, cur){
  const have = balOf(c, cur), pend = pendingOf(c.uuid, cur), free = have - pend;
  return `${esc(c.name)} ${CUR[curOf(cur)].name} ${n(have)}${pend ? ` · 승인 대기 ${n(pend)}` : ""} → 쓸 수 있는 ${n(free)}` + (free < total ? ` <b class="warn">(부족)</b>` : "");
}

/* 내 구매 요청 목록 */
export function myReqHtml(){
  if (!USE_DB || !state.session || !SHOP.ok || !myChars().length) return "";
  const names = Object.fromEntries(myChars().map(c => [c.uuid, c.name]));
  const multi = myChars().length > 1;
  return `<section class="my-reqs" aria-labelledby="my-reqs-h">
    <h3 id="my-reqs-h">내 구매 요청</h3>
    ${SHOP.reqs.length ? `<ul>${SHOP.reqs.map(r => `<li class="st-${r.status}">
      <div class="t"><strong>${esc(r.item_name)}</strong> ×${r.quantity}<span class="m">${chipAmt(r.total, r.currency)}${multi ? ` · ${esc(names[r.character_id] || "")}` : ""} · ${esc(fmtDate(r.created_at))} ${esc(fmtTime(r.created_at))}</span>
        ${r.admin_note ? `<span class="m note">관리자: ${esc(r.admin_note)}</span>` : ""}</div>
      <span class="st">${STATUS[r.status] || r.status}</span>
      ${r.status === "pending" ? `<button class="btn small" type="button" data-req-cancel="${esc(r.id)}">취소<span class="sr"> — ${esc(r.item_name)}</span></button>` : ""}
    </li>`).join("")}</ul>` : `<p class="hint">아직 요청한 상품이 없습니다.</p>`}
  </section>`;
}

/* ---------- 이벤트 ---------- */
const curItem = () => DATA.items[state.shopSel ?? 0];
document.addEventListener("input", e => {
  if (e.target.id === "buy-qty" || e.target.id === "buy-char"){
    const it = curItem(); if (!it) return;
    if (e.target.id === "buy-char") buyer = e.target.value;
    const q = Math.max(1, Math.min(99, parseInt($("#buy-qty").value, 10) || 1));
    $("#buy-total").innerHTML = chipAmt(it.price * q, it.currency);
    const c = buyers().find(x => x.uuid === buyer);
    if (c) $("#buy-bal").innerHTML = buyBalText(c, it.price * q, it.currency);
  }
});
document.addEventListener("change", e => { if (e.target.id === "buy-char"){ buyer = e.target.value; } });

document.addEventListener("submit", async e => {
  if (e.target.id !== "buy-form") return;
  e.preventDefault();
  const f = e.target, it = curItem(), err = $("#buy-err"), qtyEl = $("#buy-qty");
  showMsg(err, "");
  const qty = parseInt(qtyEl.value, 10);
  if (!(qty >= 1 && qty <= +qtyEl.max)){ showMsg(err, `수량은 1~${qtyEl.max}개입니다.`); qtyEl.focus(); return; }
  if (!confirm(`${it.name} ${qty}개 (${CUR[curOf(it.currency)].name} ${n(it.price * qty)})를 구매 요청할까요?\n관리자가 승인하면 코인이 빠집니다.`)) return;
  await withBusy($('button[type="submit"]', f), async () => {
    const { error } = await sb.rpc("shop_request", { p_character: buyer, p_item: it.id, p_quantity: qty, p_memo: $("#buy-memo").value.trim() });
    if (error){ showMsg(err, missingTable(error) ? "구매 기능이 아직 준비되지 않았습니다. (관리자: update-7.sql 실행 필요)" : errMsg(error)); return; }
    toast("구매를 요청했습니다. 관리자가 승인하면 지급됩니다");
    await loadMyRequests();
    renderShop();
  });
});

document.addEventListener("click", async e => {
  const b = e.target.closest("[data-req-cancel]");
  if (!b) return;
  if (!confirm("이 구매 요청을 취소할까요?")) return;
  await withBusy(b, async () => {
    const { error } = await sb.rpc("shop_cancel", { p_request: b.dataset.reqCancel });
    if (error){ toast(errMsg(error)); return; }
    toast("요청을 취소했습니다");
    await loadMyRequests();
    renderShop();
  });
});

/* 실시간: 내 요청이 승인·거절되면 알림 (data.js의 채널이 부름) */
//   실시간 UPDATE의 old에는 키만 들어 있으므로, 이전 상태는 갖고 있던 목록에서 찾음
export async function onRequestChange(row){
  const mine = state.mine.some(m => m.uuid === row?.character_id);
  const prev = SHOP.reqs.find(r => r.id === row?.id);
  if (mine && prev?.status === "pending" && (row.status === "approved" || row.status === "rejected")){
    const msg = `구매 요청 ${row.status === "approved" ? "승인" : "거절"}: ${row.item_name} ×${row.quantity}${row.admin_note ? ` — ${row.admin_note}` : ""}`;
    announce(msg);   // 화면 알림은 notify.js
  }
  if (mine){ await loadMyRequests(); if (row.status === "approved") await reloadItems(); renderShop(); }
}

/* 승인으로 재고가 바뀌었을 수 있으니 상품만 다시 불러옴 */
export async function reloadItems(){
  const { data, error } = await sb.from("items").select(itemCols()).eq("is_for_sale", true).order("sort_order");
  if (error) return;
  DATA.items = data.map(mapItem);
}

/* 상점 분류 탭 */
document.addEventListener("click", e => {
  const b = e.target.closest("#shop-cats [data-cat]");
  if (!b) return;
  state.shopCat = b.dataset.cat;
  state.shopSel = null;
  renderShop();
});
