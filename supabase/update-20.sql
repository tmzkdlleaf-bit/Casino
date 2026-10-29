-- =====================================================================
--  update-20 : 진행 기록의 비밀 탭을 '볼 수 있는 사람'에게만
--   · 기록 파일(logs 저장소)은 누구나 받을 수 있는 공개 파일이라, 비밀 탭은 거기서 빼서
--     이 표(log_secrets)에 따로 넣습니다.
--   · 읽을 수 있는 사람: 관리자, 그리고 그 비밀 탭에 지정된 캐릭터의 주인(owner_id)
--   · 넣기·고치기·지우기: 관리자만
--   · 회차를 지우면 붙어 있던 비밀 탭도 같이 지워짐
--   update-19 다음에 한 번 실행. 여러 번 실행해도 안전합니다.
--   (이 SQL을 실행하기 전에 올린 기록은 비밀 탭이 공개 파일에 그대로 들어 있습니다.
--    실행 뒤 그 회차에 로그를 다시 올리면 비밀 탭이 이 표로 옮겨집니다.)
-- =====================================================================
begin;

-- chapters.id 와 같은 형식으로 만듦 (uuid가 아니어도 되게)
do $$
declare t text;
begin
  select format_type(a.atttypid, a.atttypmod) into t
    from pg_attribute a where a.attrelid = 'public.chapters'::regclass and a.attname = 'id';
  execute format($f$
    create table if not exists public.log_secrets (
      id            uuid primary key default gen_random_uuid(),
      chapter_id    %s not null references public.chapters(id) on delete cascade,
      tab_name      text not null,
      character_ids uuid[] not null default '{}',   -- 볼 수 있는 캐릭터 (그 주인이 봄)
      data          jsonb not null,                 -- 탭·화자·표정·대사 (사이트가 원래 기록과 합쳐 보여 줌)
      created_at    timestamptz not null default now()
    )$f$, t);
end $$;

create index if not exists log_secrets_chapter on public.log_secrets (chapter_id);

alter table public.log_secrets enable row level security;

drop policy if exists "log secrets read" on public.log_secrets;
create policy "log secrets read" on public.log_secrets for select to authenticated using (
  public.is_admin()
  or exists (select 1 from public.characters c where c.id = any (log_secrets.character_ids) and c.owner_id = auth.uid())
);

drop policy if exists "log secrets admin write" on public.log_secrets;
create policy "log secrets admin write" on public.log_secrets for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.log_secrets from anon;
grant select, insert, update, delete on public.log_secrets to authenticated;

commit;

-- 확인: 표가 있고 읽기 규칙이 켜져 있으면 true
select relrowsecurity as rls_on from pg_class where oid = 'public.log_secrets'::regclass;
