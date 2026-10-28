/* =========================================================
   가입 — 관리자가 공유한 링크(#join/코드)로만
   코드 확인과 계정 만들기는 서버 함수(supabase/functions/signup)가 함. 사이트 자체 가입은 막혀 있음
   ========================================================= */
import { loginEmail } from "./config.js?v=20261029c";
import { sb } from "./data.js?v=20261029c";
import { $, toast } from "./dom.js?v=20261029c";
import { fieldError, showMsg, validateForm, withBusy } from "./forms.js?v=20261029c";

let code = "";

export async function openJoin(param){
  code = decodeURIComponent(param || "").trim();
  const form = $("#join-form"), bad = $("#join-bad");
  form.hidden = true; bad.hidden = true;
  showMsg($("#join-error"), "");
  let ok = false;
  if (code){
    const { data, error } = await sb.rpc("invite_valid", { p_code: code });
    ok = !error && data === true;
  }
  form.hidden = !ok; bad.hidden = ok;
  if (ok) $("#join-name").focus();
}

$("#join-form").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.currentTarget, pw = $("#join-pw"), pw2 = $("#join-pw2");
  showMsg($("#join-error"), "");
  if (!validateForm(f)) return;
  if (pw.value !== pw2.value){ fieldError(pw2, "비밀번호가 서로 다릅니다."); pw2.focus(); return; }
  await withBusy($('button[type="submit"]', f), async () => {
    const id = f.email.value.trim().toLowerCase(), password = pw.value;
    const { error } = await sb.functions.invoke("signup", { body: { id, password, code, name: f.name.value.trim() } });
    if (error){
      let msg = "가입하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      try { msg = (await error.context.json()).error || msg; } catch (_) {}
      showMsg($("#join-error"), msg);
      return;
    }
    const { error: le } = await sb.auth.signInWithPassword({ email: loginEmail(id), password });
    f.reset();
    if (le){ toast("가입했습니다. 로그인해 주세요"); location.hash = "#login"; return; }
    toast("가입했습니다. 관리자가 캐릭터를 연결하면 코인과 상점을 쓸 수 있어요", 5000);
    location.hash = "#home";
  });
});
