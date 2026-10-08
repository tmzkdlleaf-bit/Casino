import { showLoginNotice } from "./auth.js?v=20261009d";
import { PAGES, PAGE_TITLES } from "./config.js?v=20261009d";
import { USE_DB } from "./data.js?v=20261009d";
import { $, $$, setTitle, splitText } from "./dom.js?v=20261009d";
import { applyFilter, castSelect, showStart, showStop } from "./effects.js?v=20261009d";
import { DATA, motionOK, nav, state } from "./state.js?v=20261009d";
import { ALL, renderAccount, renderProfile, renderRecords } from "./views.js?v=20261009d";
import { stopCharMusic } from "./charedit.js?v=20261009d";
import { renderNavOrderList } from "./navorder.js?v=20261009d";

export function resolve(){
  const [page, param] = (location.hash.slice(1) || "home").split("/");
  let view = page;
  if (!PAGES.includes(page)) view = "notfound";
  else if (page === "admin" && !state.isAdmin) view = state.session ? "notfound" : "login";   // 로그인 후 같은 주소에서 바로 관리 화면으로
  else if (page === "password" && !state.session) view = "login";
  else if (page === "login" && state.session) view = "settings";
  else if ((page === "login" || page === "password") && !USE_DB) view = "notfound";
  else if (page === "characters" && param) view = ALL().some(c => c.id === param) ? "profile" : "notfound";
  else if (page === "story" && param) view = DATA.chapters.some(c => String(c.number) === param) ? "log" : "notfound";
  const navKey = view === "profile" ? "characters" : view === "log" ? "story" : ["notfound", "password"].includes(view) ? null : view;
  return { view, param, navKey };
}

export function route(){
  if (!state.ready) return;
  const { view, param, navKey } = resolve();
  const key = view + "/" + (param || "");
  if (key === nav.key) return;
  const from = nav.current;


  nav.current = view; nav.key = key;
  $$("[data-page]").forEach(s => s.hidden = s.dataset.page !== view);
  $$("#nav a, #me, #dock-menu a").forEach(a => navKey && a.getAttribute("href") === "#" + navKey ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  $("#dock-more").classList.toggle("on", ["settings", "admin"].includes(navKey));
  setTitle(PAGE_TITLES[view] ?? "");

  const pfToPf = from === "profile" && view === "profile";   // 프로필끼리 넘김: 효과 없이 내용만
  if (from === "profile" && !pfToPf) stopCharMusic();
  if (view === "profile"){ nav.lastProfile = param; renderProfile(param, { quiet: pfToPf }); }

  // DOM 쓰기를 먼저 모두 끝내고(렌더·글자 쪼개기), 레이아웃은 한 번만 계산
  const section = $(`[data-page="${view}"]`);
  $$(".page-title.split", section).forEach(splitText);
  // 프로필에서 돌아오면 방금 보던 캐릭터를 가운데로
  if (view === "characters" && from === "profile" && nav.lastProfile) castSelect(nav.lastProfile);
  if (view === "characters") applyFilter({ instant: from === "profile", enter: from !== "profile" });
  if (view === "game") renderRecords();
  if (view === "settings"){ renderAccount(); renderNavOrderList(); }
  if (view === "admin") import("./admin.js?v=20261009d").then(m => m.admOpen());
  if (view === "login") showLoginNotice();
  if (view === "password"){
    $("#pw-lede").textContent = { invite: "초대를 수락했습니다. 사용할 비밀번호를 정해 주세요.", recovery: "새 비밀번호를 정해 주세요." }[state.pwMode] || "새 비밀번호를 입력해 주세요.";
    $("#pw-form").reset(); $("#pw-error").hidden = true;
  }

  $$(".pane, .scroll", section).forEach(p => p.scrollTop = 0);   // 페이지는 고정, 창 안만 처음으로

  if (view === "log") import("./logview.js?v=20261009d").then(m => m.openLog(param));
  view === "home" ? showStart() : showStop();

  // 새 화면만 서서히 떠오름 (전체 화면 캡처 방식의 뷰 전환은 무거워서 쓰지 않음)
  if (from !== null && motionOK() && !pfToPf){
    section.classList.remove("enter");
    void section.offsetWidth;
    section.classList.add("enter");
    section.addEventListener("animationend", e => { if (e.target === section) section.classList.remove("enter"); }, { once: true });
  }
  // SPA 화면 전환을 보조기기에 알림: 새 화면의 h1으로 포커스 이동 (첫 로드는 제외)
  if (from !== null) focusHeading(section);
}

export function focusHeading(scope){
  const h = scope && $("h1", scope);
  const target = h || $("#app");
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}
