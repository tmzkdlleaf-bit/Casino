-- =========================================================
-- update-6: 캐릭터 링크 · 캐릭터 음악 · 본인이 직접 수정
--   characters.links   — 프로필 소지품 아래에 보이는 링크 목록 [{"label":"…","url":"https://…"}] (최대 10개)
--   characters.bgm_url — 프로필에서 재생하는 유튜브 링크 (비우면 재생 버튼 없음)
--   owner_update_character() — 캐릭터 주인(또는 관리자)이 자기 캐릭터의
--       나이 · 키 · 성격 키워드 · 설명 · 링크 · 음악만 고칠 수 있는 함수
--       이름 · 구분 · 이미지 · 칩 · 소지품은 지금처럼 관리자만
-- 여러 번 실행해도 안전합니다.
-- =========================================================
begin;

alter table public.characters add column if not exists links   jsonb not null default '[]'::jsonb;
alter table public.characters add column if not exists bgm_url text  not null default '';

create or replace function public.owner_update_character(
  p_id uuid, p_age text, p_height text, p_keywords jsonb, p_description text, p_links jsonb, p_bgm_url text
) returns void language plpgsql security definer set search_path = public as $$
declare
  kw_type text;
  l jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다' using errcode = '42501'; end if;
  if not exists (select 1 from public.characters c where c.id = p_id and (c.owner_id = auth.uid() or public.is_admin())) then
    raise exception '내 캐릭터만 수정할 수 있습니다' using errcode = '42501';
  end if;

  -- 입력 검사
  if jsonb_typeof(coalesce(p_keywords, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_keywords, '[]'::jsonb)) > 20 then
    raise exception '성격 키워드는 20개까지 넣을 수 있습니다'; end if;
  if jsonb_typeof(coalesce(p_links, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_links, '[]'::jsonb)) > 10 then
    raise exception '링크는 10개까지 넣을 수 있습니다'; end if;
  for l in select * from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) loop
    if coalesce(l->>'url', '') !~* '^https?://' then raise exception '링크 주소는 http:// 또는 https:// 로 시작해야 합니다'; end if;
    if length(coalesce(l->>'label', '')) > 40 or length(l->>'url') > 500 then raise exception '링크 이름은 40자, 주소는 500자까지입니다'; end if;
  end loop;
  if coalesce(p_bgm_url, '') <> '' and p_bgm_url !~* '^https://(www\.|m\.|music\.)?(youtube\.com|youtu\.be)/' then
    raise exception '음악은 유튜브 링크만 넣을 수 있습니다'; end if;
  if length(coalesce(p_description, '')) > 5000 then raise exception '설명은 5000자까지입니다'; end if;

  update public.characters set
    age = left(coalesce(p_age, ''), 20),
    height = left(coalesce(p_height, ''), 20),
    description = coalesce(p_description, ''),
    links = coalesce(p_links, '[]'::jsonb),
    bgm_url = coalesce(p_bgm_url, '')
  where id = p_id;

  -- 성격 키워드 칸은 DB에 따라 text[] 또는 jsonb — 둘 다 받음
  select data_type into kw_type from information_schema.columns
   where table_schema = 'public' and table_name = 'characters' and column_name = 'keywords';
  if kw_type = 'jsonb' then
    update public.characters set keywords = coalesce(p_keywords, '[]'::jsonb) where id = p_id;
  else
    update public.characters set keywords = array(select left(jsonb_array_elements_text(coalesce(p_keywords, '[]'::jsonb)), 30)) where id = p_id;
  end if;
end $$;

revoke all on function public.owner_update_character(uuid, text, text, jsonb, text, jsonb, text) from public, anon;
grant execute on function public.owner_update_character(uuid, text, text, jsonb, text, jsonb, text) to authenticated;

commit;

-- 확인: 아래가 2 이면 정상 (links, bgm_url)
-- select count(*) from information_schema.columns where table_schema='public' and table_name='characters' and column_name in ('links','bgm_url');
