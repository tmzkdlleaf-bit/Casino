-- =====================================================================
--  카지노 커뮤 — 이야기 기록(코코포리아 로그) 백업 (update-2.sql 다음에 실행)
--  Supabase 대시보드 > SQL Editor 에 전체를 붙여 넣고 Run 한 번.
--  여러 번 실행해도 안전합니다. 중간에 오류가 나면 전부 취소됩니다.
--
--  하는 일
--   1) chapters.log_path 칸 추가 — 회차에 붙인 기록 파일의 위치
--   2) 저장소 버킷 logs 추가 (공개 읽기) — 변환된 기록(JSON)이 들어감
--   3) 저장소 업로드·수정·삭제는 관리자만 (characters, items, logs 세 버킷)
--      ※ 이름이 "comu admin …"인 저장소 정책 4개를 지우고 새로 겁니다 (setup.sql이 만든 것)
-- =====================================================================
begin;

alter table public.chapters add column if not exists log_path text;

insert into storage.buckets (id, name, public) values ('logs', 'logs', true)
on conflict (id) do update set public = true;

drop policy if exists "comu admin select" on storage.objects;
drop policy if exists "comu admin insert" on storage.objects;
drop policy if exists "comu admin update" on storage.objects;
drop policy if exists "comu admin delete" on storage.objects;
create policy "comu admin select" on storage.objects for select to authenticated using      (bucket_id in ('characters','items','logs') and public.is_admin());
create policy "comu admin insert" on storage.objects for insert to authenticated with check (bucket_id in ('characters','items','logs') and public.is_admin());
create policy "comu admin update" on storage.objects for update to authenticated using      (bucket_id in ('characters','items','logs') and public.is_admin())
                                                                                  with check (bucket_id in ('characters','items','logs') and public.is_admin());
create policy "comu admin delete" on storage.objects for delete to authenticated using      (bucket_id in ('characters','items','logs') and public.is_admin());

commit;

-- 확인: 아래 결과가 1, 1 이면 성공
-- select count(*) from information_schema.columns where table_schema='public' and table_name='chapters' and column_name='log_path';
-- select count(*) from storage.buckets where id='logs' and public;
