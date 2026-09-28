-- =========================================================
-- update-4: 캐릭터 이미지 초점
--   characters.image_focus — 이미지를 자를 때 보여 줄 위치 "가로 세로" (0~100, 예: "50 12")
--   비어 있으면 사이트 기본 위치를 씀. 관리 → 캐릭터에서 슬라이더로 정함
-- 여러 번 실행해도 안전합니다.
-- =========================================================
alter table public.characters add column if not exists image_focus text;

-- 형식 검사: 비어 있거나 "0~100 0~100"
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'characters_image_focus_chk') then
    alter table public.characters add constraint characters_image_focus_chk
      check (image_focus is null or image_focus ~ '^(100|[0-9]{1,2}) (100|[0-9]{1,2})$');
  end if;
end $$;

-- 공개 읽기 권한은 기존 characters 정책을 그대로 따름 (컬럼 추가만)
