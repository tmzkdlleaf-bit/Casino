import { refreshAuth } from "./auth.js";
import { CALM_KEY } from "./config.js";
import { AUTH_HASH, DB_CONFIGURED, USE_DB, loadAll, sb, showBootError, subscribeNotices } from "./data.js";
import { $, $$, announce, toast } from "./dom.js";
import { applyCalm, applyFilter, filterSummary, moveNavInk, onScroll, runIntro, setMenu } from "./effects.js";
import { errMsg } from "./forms.js";
import { focusHeading, route } from "./router.js";
import { DATA, motionOK, mqMobileNav, nav, state } from "./state.js";
import { placeSegInk, renderAccount, renderCast, renderHome, renderInventory, renderNoticeList, renderNoticeSeg, renderShop, renderStory, renderWorld } from "./views.js";

/* ---------- events ---------- */
document.addEventListener("click", e => {
  // 본문 바로가기: 해시 라우터가 #app을 페이지로 해석하지 않도록 직접 처리
  if (e.target.closest("#skip-link")){ e.preventDefault(); focusHeading($(`[data-page="${nav.current}"]`)); $(`[data-page="${nav.current}"]`)?.scrollIntoView(); return; }

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
    const run = () => announce(`${state.noticeFilter} 공지 ${renderNoticeList()}건`);
    if (document.startViewTransition && motionOK()) document.startViewTransition(run); else run();
    return;
  }

  const f = e.target.closest("#seg button");
  if (f){
    state.filter = f.dataset.filter;
    if (document.startViewTransition && motionOK()) document.startViewTransition(applyFilter); else applyFilter();
    announce(filterSummary());
  }
});

$("#menu-btn").addEventListener("click", () => setMenu(!$("#site-head").classList.contains("open")));

$$("#nav a").forEach((a, k) => a.style.setProperty("--k", k));

// 같은 페이지 링크를 눌러도 메뉴는 닫힘
$("#nav").addEventListener("click", e => { if (e.target.closest("a")) setMenu(false, { restoreFocus: false }); });

mqMobileNav.addEventListener("change", () => setMenu(false, { restoreFocus: false }));

$("#to-top").addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: motionOK() ? "smooth" : "auto" });
  $("#skip-link").focus({ preventScroll: true });
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
  if ($("#site-head").classList.contains("open")){ setMenu(false); return; }   // 메뉴가 먼저
  if (e.target.closest?.("input, textarea, select")) return;
  if (nav.current === "profile") location.hash = "#characters";
  else if (nav.current === "notice") location.hash = "#notices";
});

window.addEventListener("scroll", onScroll, { passive: true });

window.addEventListener("resize", () => {
  moveNavInk();
  if (nav.current === "characters") applyFilter();
  if (nav.current === "notices") placeSegInk($("#notice-seg"));
});

/* ---------- boot ---------- */
applyCalm();

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
  document.fonts?.ready.then(moveNavInk);
})();
