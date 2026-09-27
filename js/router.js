import { showLoginNotice } from "./auth.js";
import { PAGES, PAGE_TITLES } from "./config.js";
import { USE_DB } from "./data.js";
import { $, $$, setTitle, splitText } from "./dom.js";
import { applyFilter, bindSpy, deal, moveNavInk, onScroll, setMenu } from "./effects.js";
import { DATA, motionOK, nav, state } from "./state.js";
import { ALL, renderAccount, renderNotice, renderNoticeList, renderProfile } from "./views.js";

export function resolve(){
  const [page, param] = (location.hash.slice(1) || "home").split("/");
  let view = page;
  if (!PAGES.includes(page)) view = "notfound";
  else if (page === "admin" && !state.isAdmin) view = state.session ? "notfound" : "login";   // 로그인 후 같은 주소에서 바로 관리 화면으로
  else if (page === "password" && !state.session) view = "login";
  else if (page === "login" && state.session) view = "settings";
  else if ((page === "login" || page === "password") && !USE_DB) view = "notfound";
  else if (page === "characters" && param) view = ALL().some(c => c.id === param) ? "profile" : "notfound";
  else if (page === "notices" && param) view = DATA.notices.some(n => String(n.id) === param) ? "notice" : "notfound";
  const navKey = view === "profile" ? "characters" : ["notice", "notices", "notfound", "password"].includes(view) ? null : view;
  return { view, param, navKey };
}

export function route(){
  if (!state.ready) return;
  const { view, param, navKey } = resolve();
  const key = view + "/" + (param || "");
  if (key === nav.key) return;
  const from = nav.current;

  // 캐릭터 목록 -> 프로필: 누른 스트립 이미지를 공유 요소로 지정
  let src = null;
  if (from === "characters"){
    nav.listScroll = scrollY;
    if (view === "profile"){ src = $(`.strip[data-id="${param}"] .img`); if (src) src.style.viewTransitionName = "portrait"; }
  }

  setMenu(false, { restoreFocus: false });

  const swap = () => {
    if (src) src.style.viewTransitionName = "";
    nav.current = view; nav.key = key;
    $$("[data-page]").forEach(s => s.hidden = s.dataset.page !== view);
    $$("#nav a, .foot-nav a").forEach(a => navKey && a.getAttribute("href") === "#" + navKey ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
    setTitle(PAGE_TITLES[view] ?? "");

    if (view === "profile"){ renderProfile(param); nav.lastProfile = param; }
    if (view === "notice") renderNotice(param);

    // DOM 쓰기를 먼저 모두 끝내고(렌더·글자 쪼개기), 레이아웃은 스크롤에서 한 번만 계산
    const section = $(`[data-page="${view}"]`);
    $$(".page-title.split, .home-title.split", section).forEach(splitText);
    if (view === "characters") applyFilter();
    if (view === "notices") renderNoticeList();
    if (view === "settings") renderAccount();
    if (view === "admin") import("./admin.js").then(m => m.admOpen());
    if (view === "login") showLoginNotice();
    if (view === "password"){
      $("#pw-lede").textContent = { invite: "초대를 수락했습니다. 사용할 비밀번호를 정해 주세요.", recovery: "새 비밀번호를 정해 주세요." }[state.pwMode] || "새 비밀번호를 입력해 주세요.";
      $("#pw-form").reset(); $("#pw-error").hidden = true;
    }

    // 프로필 -> 목록: 돌아갈 스트립에 공유 요소 이름을 넘기고 스크롤 위치 복원
    if (view === "characters" && from === "profile"){
      const back = $(`.strip[data-id="${nav.lastProfile}"] .img`);
      if (back) back.style.viewTransitionName = "portrait";
      window.scrollTo({ top: nav.listScroll, behavior: "instant" });
    } else {
      window.scrollTo({ top: 0, behavior: "instant" });
    }

    // 여기부터는 읽기 위주 (레이아웃이 이미 계산돼 있어 추가 비용 없음)
    onScroll();
    moveNavInk();
    if (view === "characters") deal();
    if (view === "world") bindSpy();
    // SPA 화면 전환을 보조기기에 알림: 새 화면의 h1으로 포커스 이동 (첫 로드는 제외)
    if (from !== null) focusHeading(section);
  };

  const clearNames = () => $$(".strip .img").forEach(el => el.style.viewTransitionName = "");
  if (document.startViewTransition && motionOK() && from !== null){
    document.startViewTransition(swap).finished.finally(clearNames);
  } else { swap(); clearNames(); }
}

export function focusHeading(scope){
  const h = scope && $("h1", scope);
  const target = h || $("#app");
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}
