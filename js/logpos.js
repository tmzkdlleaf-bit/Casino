/* =========================================================
   진행 기록 — 읽던 자리 기억 (이 기기에만, 회차마다)
   { i: 대사 번호, n: 그때 전체 대사 수, a: 그 대사의 앞부분(나중에 같은 대사를 다시 찾는 데 씀), t: 저장한 때 }
   지난 이야기 목록의 ‘이어 보기’와 기록 화면(읽기·노벨)이 같이 씀
   ========================================================= */
const KEY = id => "comu-log-pos-" + id;
export const posKey = c => String(c?.id ?? c?.number ?? "");

export function getPos(id){
  try {
    const p = JSON.parse(localStorage.getItem(KEY(id)) || "null");
    return p && Number.isInteger(p.i) && p.i >= 0 && p.n > 0 ? p : null;
  } catch (_){ return null; }
}
export function setPos(id, p){ try { localStorage.setItem(KEY(id), JSON.stringify({ ...p, t: Date.now() })); } catch (_) {} }
export function clearPos(id){ try { localStorage.removeItem(KEY(id)); } catch (_) {} }

/* 어디까지 읽었나: none(안 읽음·맨 앞) / mid(읽는 중) / done(끝까지) + 몇 %인지 */
export function posState(p){
  if (!p || p.i < 2) return { kind: "none", pct: 0 };
  if (p.i >= p.n - 1) return { kind: "done", pct: 100 };
  return { kind: "mid", pct: Math.max(1, Math.min(99, Math.round((p.i + 1) / p.n * 100))) };
}

/* 대사를 다시 찾기 위한 표시: 화자 이름 + 본문 앞부분 */
export const anchorOf = (log, i) => { const x = log?.m?.[i]; return x ? (log.sp[x[1]]?.[0] || "") + "|" + String(x[2]).slice(0, 60) : ""; };

/* 저장해 둔 자리 → 지금 기록에서의 대사 번호.
   기록을 고쳤거나 보는 사람이 달라져(비밀 탭) 번호가 밀렸으면, 같은 대사를 원래 자리에서 가까운 쪽부터 찾음. 없으면 비슷한 비율 자리 */
export function findPos(log, p){
  const n = log?.m?.length || 0;
  if (!p || !n) return -1;
  if (p.i < n && (!p.a || anchorOf(log, p.i) === p.a)) return p.i;
  if (p.a) for (let d = 1; d < n; d++){
    const lo = p.i - d, hi = p.i + d;
    if (lo < 0 && hi >= n) break;
    if (lo >= 0 && lo < n && anchorOf(log, lo) === p.a) return lo;
    if (hi < n && anchorOf(log, hi) === p.a) return hi;
  }
  return Math.max(0, Math.min(n - 1, Math.round(p.i / Math.max(1, p.n) * n)));
}
