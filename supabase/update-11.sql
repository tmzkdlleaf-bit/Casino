-- =========================================================
-- update-11 : 가입 링크 (공용 링크 하나)
--   · 사이트 자체 가입은 계속 막아 두고, 서버 함수(supabase/functions/signup)가
--     링크의 코드를 확인한 뒤에만 계정을 만듦
--   · 관리자는 관리 → 멤버에서 링크를 켜고 끄거나 새 링크로 바꿈 (바꾸면 옛 링크는 못 씀)
--   update-10 다음에 한 번 실행. 여러 번 실행해도 안전합니다.
-- =========================================================

create table if not exists public.signup_invite (
  id         integer primary key default 1 check (id = 1),   -- 한 줄만
  code       text not null,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.signup_invite enable row level security;
revoke all on public.signup_invite from anon, authenticated;   -- 코드는 아래 함수로만

insert into public.signup_invite (id, code, enabled)
values (1, substr(md5(random()::text || clock_timestamp()::text), 1, 12), true)
on conflict (id) do nothing;

-- 관리자: 지금 링크 정보
create or replace function public.admin_invite_get()
returns table (code text, enabled boolean, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  return query select i.code, i.enabled, i.updated_at from public.signup_invite i where i.id = 1;
end $$;

-- 관리자: 켜기/끄기, 새 링크로 바꾸기
create or replace function public.admin_invite_set(p_enabled boolean, p_renew boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  update public.signup_invite set
    enabled = coalesce(p_enabled, enabled),
    code = case when p_renew then substr(md5(random()::text || clock_timestamp()::text), 1, 12) else code end,
    updated_at = now()
  where id = 1 returning code into v;
  return v;
end $$;

-- 누구나: 이 링크가 지금 쓸 수 있는지 (가입 화면을 보여 줄지 판단)
create or replace function public.invite_valid(p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.signup_invite where id = 1 and enabled and code = trim(coalesce(p_code, '')));
$$;

revoke all on function public.admin_invite_get() from public, anon;
revoke all on function public.admin_invite_set(boolean, boolean) from public, anon;
revoke all on function public.invite_valid(text) from public;
grant execute on function public.admin_invite_get() to authenticated;
grant execute on function public.admin_invite_set(boolean, boolean) to authenticated;
grant execute on function public.invite_valid(text) to anon, authenticated;
grant select on public.signup_invite to service_role;

-- 확인
select (select count(*) from public.signup_invite) as invite_rows,
       (select count(*) from pg_proc where proname in ('admin_invite_get', 'admin_invite_set', 'invite_valid')) as funcs;
