-- =========================================================
-- update-5: 게임 전적 (game_records)
--   누가 언제 무슨 게임에서 이겼는지 기록. 게임 화면의 '전적'과 홈의 '최근 전적'에 표시
--   누구나 읽기 / 쓰기는 관리자만 (관리 → 전적 탭에서 입력)
--   chips 칸은 표에 보이는 숫자일 뿐, 실제 칩 지급·차감은 관리 → 멤버 탭에서 따로 합니다
-- 여러 번 실행해도 안전합니다.
-- =========================================================
begin;

create table if not exists public.game_records (
  id              uuid primary key default gen_random_uuid(),
  played_at       timestamptz not null default now(),
  game_name       text not null default '',
  winner_id       uuid references public.characters(id) on delete set null,
  participant_ids uuid[] not null default '{}',
  chips           integer not null default 0,
  note            text not null default '',
  created_at      timestamptz not null default now()
);
create index if not exists game_records_played_at_idx on public.game_records (played_at desc);

alter table public.game_records enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'game_records' loop
    execute format('drop policy %I on public.game_records', p.policyname);
  end loop;
end $$;
create policy "public read" on public.game_records for select to anon, authenticated using (true);
create policy "admin write" on public.game_records for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.game_records to anon, authenticated;
grant insert, update, delete on public.game_records to authenticated;

commit;

-- 확인: 아래가 2 이면 정상
-- select count(*) from pg_policies where schemaname='public' and tablename='game_records';
