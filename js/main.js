import { refreshAuth } from "./auth.js";
import { CALM_KEY } from "./config.js";
import { AUTH_HASH, DB_CONFIGURED, USE_DB, loadAll, sb, showBootError, subscribeNotices } from "./data.js";
import { $, $$, announce, toast } from "./dom.js";
import { initBgm, initWorldBg } from "./ambience.js";
import { applyCalm, applyFilter, applyShow, filterSummary, renderHeroChips, runIntro, setShowHover, showStep } from "./effects.js";
import { errMsg } from "./forms.js";
import { focusHeading, route } from "./router.js";
import { DATA, motionOK, nav, state } from "./state.js";
import { placeSegInk, renderAccount, renderCast, renderHome, renderInventory, renderNoticeList, renderNoticeSeg, renderShop, renderStory, renderWorld } from "./views.js";

/* ---------- events ---------- */
document.addEventListener("click", e => {
  // 본문 바로가기: 해시 라우터가 #app을 페이지로 해석하지 않도록 직접 처리
  if (e.target.closest("#skip-link")){ e.preventDefault(); focusHeading($(`[data-page="${nav.current}"]`)); return; }

  const jump = e.target.closest("[data-jump]");
  if (jump){
    e.preventDefault();
    const sec = document.getElementById(jump.dataset.jump);
    sec?.scrollIntoView({ behavior: motionOK() ? "smooth" : "auto" });
    $("h2", sec)?.focus({ preventScroll: true });   // 포커스도 함께 이동 (WCAG 2.4.3)
    return;
  }

  const slot = e.target.closest("#pf-inv button.slot");
  if (slot){ renderInventory(state.invItems, +slot.dataset.slot); $(`#pf-inv [data-slot="${slot.dataset.slot}"]`).focus(); return; }

  const cat = e.target.closest("#notice-seg button");
  if (cat){
    state.noticeFilter = cat.dataset.cat;
    announce(`${state.noticeFilter} 공지 ${renderNoticeList()}건`);
    return;
  }

  // 좁은 화면 홈: 창 하나에 보일 정보 전환 (다음 게임에는 최근 이야기도 함께)
  const mt = e.target.closest("#mtabs button");
  if (mt){
    const show = { "p-next": ["p-next", "latest-card"] }[mt.dataset.panel] || [mt.dataset.panel];
    $$("#mtabs button").forEach(b => b.setAttribute("aria-pressed", b === mt));
    $$(".board > .g-panel, .board > .table").forEach(el => el.classList.toggle("on", show.includes(el.id)));
    return;
  }

  // 캐릭터 자동 넘김 멈춤/재생
  if (e.target.closest("#show-toggle")){ state.reelPaused = !state.reelPaused; applyShow(); return; }
  if (e.target.closest("#show-prev")){ showStep(-1); return; }
  if (e.target.closest("#show-next")){ showStep(1); return; }

  const f = e.target.closest("#seg button");
  if (f){
    if (f.dataset.filter === state.filter) return;
    state.filter = f.dataset.filter;
    $("#cast-pane").scrollTop = 0;
    applyFilter();
    announce(filterSummary());
  }
});

export let spun = 0;

$("#spin").addEventListener("click", () => {
  spun += 1440 + Math.floor(Math.random() * 360);
  $("#wheel").style.transform = `rotate(${spun}deg)`;
});

/* 스위치는 누르는 즉시 적용 (role="switch"의 기대 동작) */
$("#set-calm").addEventListener("change", e => {
  state.calm = e.target.checked;
  try { localStorage.setItem(CALM_KEY, state.calm ? "1" : "0"); } catch (_) {}
  applyCalm();
  toast(state.calm ? "애니메이션을 껐습니다" : "애니메이션을 켰습니다");
  if (USE_DB && state.session){
    sb.from("profiles").update({ reduce_motion: state.calm }).eq("id", state.session.user.id).then(({ error }) => {
      if (!error && state.profile) state.profile.reduce_motion = state.calm;
    });
  }
});

/* 소지품 칸: 방향키·Home·End로 이동 (칸 전체가 Tab 한 번) */
$("#pf-inv").addEventListener("keydown", e => {
  const btns = $$("#pf-inv button.slot"), i = btns.indexOf(document.activeElement);
  if (i < 0) return;
  const cols = getComputedStyle($("#pf-inv")).gridTemplateColumns.split(" ").length;
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
  let j = step != null ? i + step : e.key === "Home" ? 0 : e.key === "End" ? btns.length - 1 : null;
  if (j == null) return;
  e.preventDefault();
  j = Math.max(0, Math.min(btns.length - 1, j));
  btns.forEach((b, k) => b.tabIndex = k === j ? 0 : -1);
  btns[j].focus();
});

window.addEventListener("hashchange", () => {
  if (state.admDirty && nav.current === "admin" && !confirm("저장하지 않은 변경이 있습니다. 이 페이지를 떠날까요?")){
    history.replaceState(null, "", "#admin"); return;
  }
  state.admDirty = false;
  route();
});

window.addEventListener("beforeunload", e => { if (state.admDirty){ e.preventDefault(); e.returnValue = ""; } });

addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  $("#site-head").classList.add("tips-off");   // 떠 있는 이름표 닫기
  if (e.target.closest?.("input, textarea, select")) return;
  if (nav.current === "profile") location.hash = "#characters";
  else if (nav.current === "notice") location.hash = "#notices";
  else if (nav.current === "log") location.hash = "#story";
});


window.addEventListener("resize", () => {
  if (nav.current === "characters") applyFilter();
  if (nav.current === "notices") placeSegInk($("#notice-seg"));
});

// 이름표는 다음 조작 때 다시 쓸 수 있게
["pointermove", "focusin"].forEach(t => $("#site-head").addEventListener(t, () => $("#site-head").classList.remove("tips-off")));

/* 설정: 인트로 다시 보기 */
$("#replay-intro").addEventListener("click", () => {
  if (!motionOK()){ toast("애니메이션 끄기가 켜져 있어 인트로를 재생하지 않습니다"); return; }
  runIntro({ force: true });
});

/* 홈 캐릭터: 마우스를 올리거나 키보드로 들어가면 잠시 멈춤 */
const show = $("#show");
show.addEventListener("pointerenter", () => setShowHover(true));
show.addEventListener("pointerleave", () => setShowHover(false));
show.addEventListener("focusin", () => setShowHover(true));
show.addEventListener("focusout", e => { if (!show.contains(e.relatedTarget)) setShowHover(false); });
document.addEventListener("visibilitychange", () => setShowHover(false));

/* 캐릭터 페이지: 손가락으로 옆으로 밀어서 딜러 ↔ 참가자 */
let sw = null;
$("#cast-pane").addEventListener("pointerdown", e => { if (e.pointerType !== "mouse") sw = { x: e.clientX, y: e.clientY }; });
$("#cast-pane").addEventListener("pointerup", e => {
  if (!sw) return;
  const dx = e.clientX - sw.x, dy = e.clientY - sw.y; sw = null;
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  const to = dx < 0 ? "player" : "dealer";
  if (to !== state.filter) $(`#seg button[data-filter="${to}"]`).click();
});

/* 독의 로그아웃 = 설정 화면의 로그아웃 */
$("#dock-logout").addEventListener("click", () => $("#logout").click());

/* ---------- boot ---------- */
renderHeroChips();
applyCalm();
initWorldBg();
initBgm();

// 저장된 '애니메이션 끄기'를 인트로보다 먼저 적용
runIntro();

(async () => {
  // Supabase 라이브러리가 막혔거나(SRI 불일치·네트워크) 없으면 더미 화면으로 조용히 넘어가지 않고 오류 표시
  if (DB_CONFIGURED && !USE_DB){ showBootError(new Error("supabase-js failed to load")); return; }
  // 로딩 표시는 인트로 아래에 깔려 있다가, 인트로가 먼저 끝나면 드러남
  if (USE_DB){
    try {
      const [data, { data: { session } }] = await Promise.all([loadAll(), sb.auth.getSession()]);
      Object.assign(DATA, data);
      await refreshAuth(session);
    } catch (err){ showBootError(err); return; }

    // 메일 링크(초대·재설정)로 들어온 경우: 토큰이 담긴 주소를 정리하고 알맞은 화면으로
    if (AUTH_HASH){
      let to = "#home";
      if (AUTH_HASH.error){ state.loginNotice = errMsg({ message: `${AUTH_HASH.error} ${AUTH_HASH.errorText || ""}` }); to = "#login"; }
      else if (["invite", "recovery"].includes(AUTH_HASH.type) && state.session){ state.pwMode = AUTH_HASH.type; to = "#password"; }
      history.replaceState(null, "", location.pathname + location.search + to);
    }
    sb.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
      if (event === "PASSWORD_RECOVERY") state.pwMode = "recovery";
      setTimeout(() => refreshAuth(session), 0);   // 콜백 안에서 바로 DB를 부르면 교착될 수 있어 한 박자 뒤에
    });
    subscribeNotices();
  }
  renderHome(); renderCast(); renderWorld(); renderStory(); renderShop(); renderNoticeSeg(); renderAccount();
  state.ready = true;
  route();
  $("#boot").classList.add("hide");
})();
