import { CALM_KEY, isIdAccount, loginEmail } from "./config.js?v=20261031f";
import { sb, subscribeProfile } from "./data.js?v=20261031f";
import { $, toast } from "./dom.js?v=20261031f";
import { applyCalm } from "./effects.js?v=20261031f";
import { checkField, errMsg, fieldError, showMsg, validateForm, withBusy } from "./forms.js?v=20261031f";
import { route } from "./router.js?v=20261031f";
import { state } from "./state.js?v=20261031f";
import { renderAccount, renderShop } from "./views.js?v=20261031f";
import { SHOP, loadMyRequests } from "./shop.js?v=20261031f";
import { notifyUnseen } from "./notify.js?v=20261031f";
import { CREQ, loadChipRequests, renderChipRequests } from "./chipreq.js?v=20261031f";

/* =========================================================
   AUTH — 이메일 + 비밀번호, 초대제
   ========================================================= */
export async function refreshAuth(session){
  const before = `${state.session?.user.id}|${state.isAdmin}`;
  state.session = session || null;
  if (session){
    const { data, error } = await sb.from("profiles").select("id, email, display_name, role, reduce_motion").eq("id", session.user.id).maybeSingle();
    state.profile = error ? null : data;
    await loadMine();
    // '애니메이션 끄기'는 계정 설정을 따름 (이 기기에도 저장)
    if (state.profile && state.profile.reduce_motion !== state.calm){
      state.calm = state.profile.reduce_motion;
      try { localStorage.setItem(CALM_KEY, state.calm ? "1" : "0"); } catch (_) {}
      applyCalm();
    }
  } else { state.profile = null; state.mine = []; }
  state.isAdmin = state.profile?.role === "admin";
  await Promise.all([loadMyRequests(), loadChipRequests()]);
  if (before !== `${state.session?.user.id}|${state.isAdmin}`) notifyUnseen(SHOP.reqs, CREQ.list);   // 로그인·접속할 때 한 번
  renderChipRequests();
  subscribeProfile();
  renderAccount();
  if (state.ready) renderShop();
  document.dispatchEvent(new Event("comu:auth"));   // 룰렛 화면 등이 버튼을 다시 그림
  // 로그인 상태나 권한이 바뀌었을 때만 현재 화면을 다시 판정 (토큰 갱신 때는 그대로)
  if (state.ready && before !== `${state.session?.user.id}|${state.isAdmin}`) route();
}

export async function loadMine(){
  const uid = state.session?.user.id;
  if (!uid){ state.mine = []; return; }
  const { data: chars, error } = await sb.from("characters").select("id").eq("owner_id", uid);
  if (error){ state.mine = []; return; }
  const ids = chars.map(c => c.id);
  let bal = [];
  if (ids.length){
    let r = await sb.from("chip_balances").select("character_id, balance, pink").in("character_id", ids);
    if (r.error) r = await sb.from("chip_balances").select("character_id, balance").in("character_id", ids);   // update-12.sql 전
    bal = r.data || [];
  }
  state.mine = ids.map(id => { const b = bal.find(x => x.character_id === id); return { uuid: id, balance: b?.balance ?? 0, pink: b?.pink ?? 0 }; });
}

export function showLoginNotice(){
  $("#login-note")?.remove();
  showMsg($("#login-error"), state.loginNotice || "");
  state.loginNotice = null;
}

$("#login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.currentTarget;
  showMsg($("#login-error"), "");
  if (!validateForm(f)) return;
  await withBusy($('button[type="submit"]', f), async () => {
    const { error } = await sb.auth.signInWithPassword({ email: loginEmail(f.email.value), password: f.password.value });
    if (error){
      showMsg($("#login-error"), errMsg(error));
      f.password.value = ""; f.password.focus();
      return;
    }
    f.reset();
    toast("로그인했습니다");
    // 화면 이동은 onAuthStateChange → refreshAuth → route 가 처리
  });
});

$("#forgot").addEventListener("click", async e => {
  const email = $("#login-email");
  showMsg($("#login-error"), "");
  if (!email.value.trim()){
    fieldError(email, "아이디를 입력해 주세요.");
    email.focus(); return;
  }
  // 아이디 계정은 메일이 없어서 관리자가 초기화 (관리 → 멤버)
  if (isIdAccount(loginEmail(email.value))){
    $("#login-note")?.remove();
    $("#login-form").insertAdjacentHTML("afterbegin", `<p class="form-note" id="login-note" role="status">관리자에게 비밀번호 초기화를 요청해 주세요. 받은 임시 비밀번호로 로그인한 뒤 설정에서 바꾸면 됩니다.</p>`);
    return;
  }
  await withBusy(e.currentTarget, async () => {
    const { error } = await sb.auth.resetPasswordForEmail(loginEmail(email.value), { redirectTo: location.origin + location.pathname });
    if (error){ showMsg($("#login-error"), errMsg(error)); return; }
    $("#login-note")?.remove();
    $("#login-form").insertAdjacentHTML("afterbegin", `<p class="form-note" id="login-note" role="status">가입된 이메일이라면 재설정 메일이 발송됩니다. 메일의 링크를 눌러 새 비밀번호를 정해 주세요.</p>`);
  });
});

$("#pw-form").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.currentTarget, a = $("#pw-new"), b = $("#pw-new2");
  showMsg($("#pw-error"), "");
  if (!validateForm(f)) return;
  if (a.value !== b.value){ fieldError(b, "비밀번호가 서로 다릅니다."); b.focus(); return; }
  await withBusy($('button[type="submit"]', f), async () => {
    const { error } = await sb.auth.updateUser({ password: a.value });
    if (error){ showMsg($("#pw-error"), errMsg(error)); return; }
    f.reset();
    state.pwMode = null;
    toast("비밀번호를 저장했습니다");
    location.hash = "#settings";
  });
});

$("#acct-form").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.currentTarget, name = $("#set-name");
  if (!validateForm(f)) return;
  await withBusy($('button[type="submit"]', f), async () => {
    const { data, error } = await sb.from("profiles").update({ display_name: name.value.trim() }).eq("id", state.session.user.id).select("display_name").single();
    if (error){ toast(errMsg(error)); return; }
    state.profile = { ...state.profile, display_name: data.display_name };
    renderAccount();
    toast("저장했습니다");
  });
});

$("#logout").addEventListener("click", async e => {
  await withBusy(e.currentTarget, async () => {
    await sb.auth.signOut();
    toast("로그아웃했습니다");
    location.hash = "#home";
  });
});
