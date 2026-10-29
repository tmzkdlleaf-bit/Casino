/* =========================================================
   요청 처리 결과 알림 — 구매 요청 · 코인 정산 요청
   · 접속 중: 관리자가 승인/거절하는 순간 알림
   · 다음 접속 때: 마지막으로 본 뒤 처리된 요청 개수 안내
   마지막으로 본 시각은 이 브라우저에 계정별로 저장
   ========================================================= */
import { CUR, curOf, toast } from "./dom.js?v=20261030a";
import { state } from "./state.js?v=20261030a";

const key = () => "comu-seen-dec:" + (state.session?.user.id || "");
const n = v => Number(v || 0).toLocaleString("ko-KR");
const told = new Set();   // 같은 알림 두 번 띄우지 않기

function seen(){ try { return localStorage.getItem(key()); } catch (_) { return null; } }
function markSeen(iso){
  const prev = seen();
  if (prev && Date.parse(prev) >= Date.parse(iso)) return;
  try { localStorage.setItem(key(), iso); } catch (_) {}
}
const done = r => r.status === "approved" || r.status === "rejected";
const mineChar = r => state.mine.some(m => m.uuid === r.character_id);

/* 실시간: 내 캐릭터의 요청이 막 처리됐을 때 */
export function notifyDecision(row, kind){
  if (!row || !done(row) || !mineChar(row) || !row.decided_at) return;
  if (row.decided_by && row.decided_by === state.session?.user.id) return;   // 관리자가 자기 것을 직접 처리한 경우
  const id = kind + row.id;
  if (told.has(id)) return;
  told.add(id);
  const ok = row.status === "approved";
  const what = kind === "shop" ? `구매 ${row.item_name} ×${row.quantity}` : `${CUR[curOf(row.currency)].name} 정산 ${row.amount > 0 ? "+" : ""}${n(row.amount)}`;
  toast(`${what} — ${ok ? "승인됨" : "거절됨"}${!ok && row.admin_note ? ` (${row.admin_note})` : ""}`, 4500);
  markSeen(row.decided_at);
}

/* 접속할 때: 지난번 이후 처리된 요청 요약 */
export function notifyUnseen(shopReqs, chipReqs){
  if (!state.session) return;
  const rows = [...(shopReqs || []), ...(chipReqs || [])].filter(r => done(r) && r.decided_at);
  const last = rows.reduce((m, r) => (r.decided_at > m ? r.decided_at : m), "");
  const prev = seen();
  if (!prev){ markSeen(last || new Date().toISOString()); return; }   // 처음엔 지난 것들로 알림을 쏟아내지 않음
  const fresh = rows.filter(r => Date.parse(r.decided_at) > Date.parse(prev));
  if (fresh.length){
    const ok = fresh.filter(r => r.status === "approved").length, no = fresh.length - ok;
    setTimeout(() => toast(`처리된 요청 ${fresh.length}건 — ${[ok ? `승인 ${ok}` : "", no ? `거절 ${no}` : ""].filter(Boolean).join(" · ")}`, 5000), 1200);
  }
  if (last) markSeen(last);
}
