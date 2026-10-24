// =========================================================
// 가입 링크 처리 (Supabase Edge Function: signup)
//   · 가입: 사이트의 #join/<코드> 화면에서 호출. 코드가 맞을 때만 아이디로 계정을 만듦
//     아이디는 내부적으로 "<아이디>@titfortat777.invalid" 주소로 저장 (메일은 보내지 않음)
//   · 비밀번호 초기화 (action: "reset"): 관리자만. 아이디 계정은 재설정 메일을 받을 수 없어서
//   코드·켜짐 여부는 public.signup_invite (supabase/update-11.sql)
// =========================================================
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const ID_DOMAIN = "titfortat777.invalid";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "잘못된 요청입니다" }, 405);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "잘못된 요청입니다" }, 400); }
  const password = String(b.password ?? "");
  if (password.length < 8 || password.length > 72) return json({ error: "비밀번호는 8자 이상이어야 합니다" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ----- 관리자: 비밀번호 초기화 -----
  if (b.action === "reset") {
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: me } = await admin.auth.getUser(jwt);
    if (!me?.user) return json({ error: "로그인이 필요합니다" }, 401);
    const { data: prof } = await admin.from("profiles").select("role").eq("id", me.user.id).maybeSingle();
    if (prof?.role !== "admin") return json({ error: "권한이 없습니다" }, 403);
    const target = String(b.user ?? "");
    if (!target || target === me.user.id) return json({ error: "다른 멤버만 초기화할 수 있습니다" }, 400);
    const { error } = await admin.auth.admin.updateUserById(target, { password });
    if (error) return json({ error: "초기화하지 못했습니다: " + error.message }, 400);
    return json({ ok: true });
  }

  // ----- 가입 -----
  const id = String(b.id ?? "").trim().toLowerCase();
  const code = String(b.code ?? "").trim();
  const name = String(b.name ?? "").trim().slice(0, 20);
  if (!/^[a-z0-9_]{3,20}$/.test(id)) return json({ error: "아이디는 영문 소문자·숫자·_ 로 3~20자입니다" }, 400);

  const { data: inv, error: invErr } = await admin.from("signup_invite").select("code, enabled").eq("id", 1).maybeSingle();
  if (invErr) return json({ error: "가입 기능이 아직 준비되지 않았습니다" }, 500);
  if (!inv || !inv.enabled || inv.code !== code) return json({ error: "가입 링크가 만료되었거나 잘못되었습니다. 관리자에게 새 링크를 받아 주세요" }, 403);

  const { data, error } = await admin.auth.admin.createUser({ email: `${id}@${ID_DOMAIN}`, password, email_confirm: true });
  if (error) {
    const dup = /already|registered|exists/i.test(error.message);
    return json({ error: dup ? "이미 쓰고 있는 아이디입니다" : "가입하지 못했습니다: " + error.message }, dup ? 409 : 400);
  }
  if (data.user) await admin.from("profiles").update({ display_name: name || id }).eq("id", data.user.id);
  return json({ ok: true });
});
