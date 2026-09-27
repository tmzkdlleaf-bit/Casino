-- =====================================================================
--  카지노 커뮤 — 게임 일정 권한 (setup.sql 다음에 실행)
--  Supabase 대시보드 > SQL Editor 에 전체를 붙여 넣고 Run 한 번.
--  여러 번 실행해도 안전합니다. 중간에 오류가 나면 전부 취소됩니다.
--
--  하는 일
--   game_slots(게임 일정): 누구나 읽기 / 쓰기는 관리자만
--        ※ game_slots 에 걸려 있던 기존 정책은 모두 지우고 새로 겁니다
--        홈의 '다음 게임'과 관리 > 게임 일정 탭에서 씁니다
--
--  ※ 이 파일을 실행하기 전에는 홈 '다음 게임'이 비어 보이고, 관리 > 게임 일정 저장이 거절될 수 있습니다.
-- =====================================================================
begin;

alter table public.game_slots enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'game_slots' loop
    execute format('drop policy %I on public.game_slots', p.policyname);
  end loop;
end $$;
create policy "public read" on public.game_slots for select to anon, authenticated using (true);
create policy "admin write" on public.game_slots for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.game_slots to anon, authenticated;
grant insert, update, delete on public.game_slots to authenticated;

commit;

-- 확인: 아래 결과가 2 이면 성공
-- select count(*) from pg_policies where schemaname='public' and tablename='game_slots';
