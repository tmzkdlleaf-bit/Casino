import { CALM_KEY } from "./config.js?v=20261009d";
import { sb, subscribeProfile } from "./data.js?v=20261009d";
import { $, toast } from "./dom.js?v=20261009d";
import { applyCalm } from "./effects.js?v=20261009d";
import { checkField, errMsg, fieldError, showMsg, validateForm, withBusy } from "./forms.js?v=20261009d";
import { route } from "./router.js?v=20261009d";
import { state } from "./state.js?v=20261009d";
import { renderAccount } from "./views.js?v=20261009d";

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
  subscribeProfile();
  renderAccount();
  // 로그인 상태나 권한이 바뀌었을 때만 현재 화면을 다시 판정 (토큰 갱신 때는 그대로)
  if (state.ready && before !== `${state.session?.user.id}|${state.isAdmin}`) route();
}

export async function loadMine(){
  const uid = state.session?.user.id;
  if (!uid){ state.mine = []; return; }
  const { data: chars, error } = await sb.from("characters").select("id").eq("owner_id", uid);
  if (error){ state.mine = []; return; }
  const ids = chars.map(c => c.id);
  const bal = ids.length ? (await sb.from("chip_balances").select("character_id, balance").in("character_id", ids)).data || [] : [];
  state.mine = ids.map(id => ({ uuid: id, balance: bal.find(b => b.character_id === id)?.balance ?? 0 }));
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
    const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
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
  if (!email.value.trim() || !checkField(email)){
    fieldError(email, "재설정 메일을 받을 이메일을 입력해 주세요.");
    email.focus(); return;
  }
  await withBusy(e.currentTarget, async () => {
    const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + location.pathname });
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
