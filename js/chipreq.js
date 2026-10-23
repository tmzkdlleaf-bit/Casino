/* =========================================================
   칩 정산 요청 — 멤버가 "칩 100개 추가" 같은 요청을 올리고 관리자가 승인 (supabase/update-9.sql)
   설정 화면의 '칩 정산 요청' 칸. 승인되면 서버가 칩 기록에 넣음
   ========================================================= */
import { USE_DB, fmtDate, fmtTime, sb } from "./data.js?v=20261024d";
import { $, announce, esc, toast } from "./dom.js?v=20261024d";
import { errMsg, showMsg, withBusy } from "./forms.js?v=20261024d";
import { state } from "./state.js?v=20261024d";
import { myChars } from "./views.js?v=20261024d";

export const CREQ = { list: [], ok: true };
const ST = { pending: "승인 대기", approved: "승인됨", rejected: "거절됨", cancelled: "취소함" };
const n = v => (v > 0 ? "+" : "") + Number(v).toLocaleString("ko-KR");
const missing = e => /42P01|PGRST205|PGRST202|chip_request/.test(`${e?.code} ${e?.message}`);

export async function loadChipRequests(){
  const ids = state.mine.map(m => m.uuid);
  if (!USE_DB || !state.session || !ids.length){ CREQ.list = []; return; }
  const { data, error } = await sb.from("chip_requests").select("id, character_id, amount, reason, status, admin_note, created_at, decided_at")
    .in("character_id", ids).order("created_at", { ascending: false }).limit(20);
  if (error){ CREQ.ok = !missing(error); CREQ.list = []; return; }
  CREQ.ok = true; CREQ.list = data || [];
}

export function renderChipRequests(){
  const card = $("#creq-card"), chars = myChars();
  card.hidden = !(USE_DB && state.session && chars.length);
  if (card.hidden) return;
  if (!CREQ.ok){ $("#creq-form").hidden = true; $("#creq-list").innerHTML = `<p class="hint">아직 준비되지 않았습니다. (관리자: supabase/update-9.sql 실행 필요)</p>`; return; }
  $("#creq-form").hidden = false;
  const sel = $("#creq-char"), keep = sel.value;
  sel.innerHTML = chars.map(c => `<option value="${esc(c.uuid)}">${esc(c.name)} — 보유 ${c.balance.toLocaleString("ko-KR")}칩</option>`).join("");
  if (chars.some(c => c.uuid === keep)) sel.value = keep;
  $("#creq-char-f").hidden = chars.length < 2;
  const names = Object.fromEntries(chars.map(c => [c.uuid, c.name]));
  $("#creq-list").innerHTML = CREQ.list.length ? `<ul class="creq-list my-reqs" aria-label="내 정산 요청">${CREQ.list.map(r => `<li class="st-${r.status}">
      <div class="t"><strong class="${r.amount < 0 ? "minus" : ""}">${n(r.amount)}칩</strong> ${esc(r.reason)}
        <span class="m">${chars.length > 1 ? esc(names[r.character_id] || "") + " · " : ""}${esc(fmtDate(r.created_at))} ${esc(fmtTime(r.created_at))}</span>
        ${r.admin_note ? `<span class="m note">관리자: ${esc(r.admin_note)}</span>` : ""}</div>
      <span class="st">${ST[r.status]}</span>
      ${r.status === "pending" ? `<button class="btn small" type="button" data-creq-cancel="${esc(r.id)}">취소</button>` : ""}
    </li>`).join("")}</ul>` : `<p class="hint">보낸 요청이 없습니다.</p>`;
}

$("#creq-form").addEventListener("submit", async e => {
  e.preventDefault();
  const amt = parseInt($("#creq-amt").value, 10), why = $("#creq-why").value.trim(), err = $("#creq-err");
  showMsg(err, "");
  if (!amt){ showMsg(err, "0이 아닌 정수를 입력해 주세요. (빼는 요청은 -50 처럼)"); $("#creq-amt").focus(); return; }
  if (!why){ showMsg(err, "사유를 적어 주세요."); $("#creq-why").focus(); return; }
  await withBusy($('button[type="submit"]', e.target), async () => {
    const { error } = await sb.rpc("chip_request", { p_character: $("#creq-char").value, p_amount: amt, p_reason: why });
    if (error){ showMsg(err, missing(error) ? "아직 준비되지 않았습니다. (관리자: update-9.sql 실행 필요)" : errMsg(error)); return; }
    e.target.reset();
    toast("정산 요청을 보냈습니다. 관리자가 승인하면 반영됩니다");
    await loadChipRequests(); renderChipRequests();
  });
});

document.addEventListener("click", async e => {
  const b = e.target.closest("[data-creq-cancel]");
  if (!b || !confirm("이 정산 요청을 취소할까요?")) return;
  await withBusy(b, async () => {
    const { error } = await sb.rpc("chip_request_cancel", { p_request: b.dataset.creqCancel });
    if (error){ toast(errMsg(error)); return; }
    await loadChipRequests(); renderChipRequests();
  });
});

/* 실시간: 내 요청이 처리되면 알림 (이전 상태는 갖고 있던 목록에서) */
export async function onChipRequestChange(row){
  const prev = CREQ.list.find(r => r.id === row?.id);
  if (prev?.status === "pending" && (row.status === "approved" || row.status === "rejected")){
    const msg = `칩 정산 ${row.status === "approved" ? "승인" : "거절"}: ${n(row.amount)}칩${row.admin_note ? ` — ${row.admin_note}` : ""}`;
    toast(msg); announce(msg);
  }
  if (state.mine.some(m => m.uuid === row?.character_id)){ await loadChipRequests(); renderChipRequests(); }
}
