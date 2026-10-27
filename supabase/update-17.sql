-- =====================================================================
--  update-17 : '칩' → '코인' · 상품 분류
--   1) 서버가 보내는 안내·오류 문구의 '칩'을 모두 '코인'으로 (블루 코인 · 핑크 코인 등)
--      — 이름에 '칩'이 들어간 문구가 있는 함수를 찾아 글자만 바꿔 다시 만듦 (동작은 그대로)
--      이미 남아 있는 채팅·기록 글은 그대로 둠
--   2) items.category: 상품 분류 (예: 파츠). 상점에 분류별 탭이 생김
--   update-16 다음에 한 번 실행. 여러 번 실행해도 안전합니다.
-- =====================================================================
begin;

do $$
declare r record;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' and p.prosrc like '%칩%' loop
    execute replace(pg_get_functiondef(r.oid), '칩', '코인');
  end loop;
end $$;

alter table public.items add column if not exists category text not null default '';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'items_category_len') then
    alter table public.items add constraint items_category_len check (char_length(category) <= 20);
  end if;
end $$;

commit;

select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc like '%칩%') as funcs_with_old_word,
       public.chip_name('pink') as pink_name,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'items' and column_name = 'category') as category_col;
