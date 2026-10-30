import { showLoginNotice } from "./auth.js?v=20261030d";
import { PAGES, PAGE_TITLES } from "./config.js?v=20261030d";
import { USE_DB } from "./data.js?v=20261030d";
import { $, $$, setTitle, splitText } from "./dom.js?v=20261030d";
import { applyFilter, castSelect, showStart, showStop } from "./effects.js?v=20261030d";
import { DATA, motionOK, nav, state } from "./state.js?v=20261030d";
import { ALL, renderAccount, renderProfile, renderRecords, renderShop } from "./views.js?v=20261030d";
import { stopCharMusic } from "./charedit.js?v=20261030d";
import { renderNavOrderList } from "./navorder.js?v=20261030d";

export function resolve(){
  const [page, param] = (location.hash.slice(1) || "home").split("/");
  let view = page;
  if (!PAGES.includes(page)) view = "notfound";
  else if (page === "admin" && !state.isAdmin) view = state.session ? "notfound" : "login";   // 로그인 후 같은 주소에서 바로 관리 화면으로
  else if (page === "password" && !state.session) view = "login";
  else if (page === "login" && state.session) view = "settings";
  else if ((page === "login" || page === "password" || page === "join") && !USE_DB) view = "notfound";
  else if (page === "join" && state.session) view = "settings";   // 이미 로그인한 사람은 설정으로
  else if (page === "characters" && param) view = ALL().some(c => c.id === param) ? "profile" : "notfound";
  else if (page === "story" && param) view = DATA.chapters.some(c => String(c.number) === param) ? "log" : "notfound";
  else if (page === "roulette") view = param && USE_DB ? "roulette" : "notfound";   // 방이 있는지는 roulette.js가 확인
  else if (page === "blackjack") view = param && USE_DB ? "blackjack" : "notfound";
  const navKey = view === "profile" ? "characters" : view === "log" ? "story" : view === "roulette" || view === "blackjack" ? "game" : ["notfound", "password", "join"].includes(view) ? null : view;
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
  // 상점: 들어올 때마다 내 요청·잔액을 새로 (실시간 연결이 끊겨 있어도 승인 결과가 보이게)
  if (view === "shop" && USE_DB && state.session) Promise.all([import("./shop.js?v=20261030d"), import("./auth.js?v=20261030d")])
    .then(async ([m, a]) => { await a.loadMine(); await Promise.all([m.loadMyRequests(), m.reloadItems()]); renderAccount(); renderShop(); });
  if (view === "settings"){
    renderAccount(); renderNavOrderList();
    import("./chipreq.js?v=20261030d").then(async m => { m.renderChipRequests(); await m.loadChipRequests(); m.renderChipRequests(); });
  }
  if (view === "admin") import("./admin.js?v=20261030d").then(m => m.admOpen());
  if (view === "login") showLoginNotice();
  if (view === "join") import("./join.js?v=20261030d").then(m => m.openJoin(param));
  if (view === "password"){
    $("#pw-lede").textContent = { invite: "초대를 수락했습니다. 사용할 비밀번호를 정해 주세요.", recovery: "새 비밀번호를 정해 주세요." }[state.pwMode] || "새 비밀번호를 입력해 주세요.";
    $("#pw-form").reset(); $("#pw-error").hidden = true;
  }

  $$(".pane, .scroll", section).forEach(p => p.scrollTop = 0);   // 페이지는 고정, 창 안만 처음으로

  if (view === "log") import("./logview.js?v=20261030d").then(m => m.openLog(param));
  // 러시안 룰렛: 게임 화면 = 방 목록, #roulette/방ID = 방. 다른 화면으로 가면 실시간 연결을 끊음
  if (view === "game" || view === "roulette" || from === "game" || from === "roulette")
    import("./roulette.js?v=20261030d").then(m => m.onRoute(view, param)).catch(err => console.error("[roulette]", err));
  if (view === "game" || view === "blackjack" || from === "game" || from === "blackjack")
    import("./blackjack.js?v=20261030d").then(m => m.onRoute(view, param)).catch(err => console.error("[blackjack]", err));
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
