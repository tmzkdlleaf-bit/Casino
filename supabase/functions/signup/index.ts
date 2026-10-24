// =========================================================
// 가입 링크 처리 (Supabase Edge Function: signup)
//   사이트의 #join/<코드> 화면에서 호출. 코드가 맞을 때만 계정을 만들고 바로 로그인 가능하게 함.
//   코드·켜짐 여부는 public.signup_invite (supabase/update-11.sql)
// =========================================================
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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
  const email = String(b.email ?? "").trim().toLowerCase();
  const password = String(b.password ?? "");
  const code = String(b.code ?? "").trim();
  const name = String(b.name ?? "").trim().slice(0, 20);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "이메일 형식을 확인해 주세요" }, 400);
  if (password.length < 8 || password.length > 72) return json({ error: "비밀번호는 8자 이상이어야 합니다" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: inv, error: invErr } = await admin.from("signup_invite").select("code, enabled").eq("id", 1).maybeSingle();
  if (invErr) return json({ error: "가입 기능이 아직 준비되지 않았습니다" }, 500);
  if (!inv || !inv.enabled || inv.code !== code) return json({ error: "가입 링크가 만료되었거나 잘못되었습니다. 관리자에게 새 링크를 받아 주세요" }, 403);

  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    const dup = /already|registered|exists/i.test(error.message);
    return json({ error: dup ? "이미 가입된 이메일입니다. 로그인해 주세요" : "가입하지 못했습니다: " + error.message }, dup ? 409 : 400);
  }
  if (name && data.user) await admin.from("profiles").update({ display_name: name }).eq("id", data.user.id);
  return json({ ok: true });
});
