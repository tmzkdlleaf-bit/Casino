-- =====================================================================
--  카지노 커뮤 — 인증·권한·보안 설정
--  Supabase 대시보드 > SQL Editor 에 전체를 붙여 넣고 Run 한 번.
--  여러 번 실행해도 안전합니다(idempotent). 중간에 오류가 나면 전부 취소됩니다.
--
--  하는 일
--   1) 기존 테이블 구조 확인 (예상과 다르면 아무것도 바꾸지 않고 멈춤)
--   2) profiles(회원) · chip_ledger(칩 기록) 테이블
--   3) 가입 시 profiles 자동 생성, 관리자 판별 함수
--   4) 모든 테이블 RLS: 누구나 읽기 / 쓰기는 관리자만
--      ※ 이 테이블들에 걸려 있던 기존 정책은 모두 지우고 새로 겁니다
--   5) 칩 증감·캐릭터 연결·소지품 교체는 관리자 전용 함수(RPC)로만
--   6) 이미지 버킷(characters, items) 업로드는 관리자만
--   7) 실시간 반영(Realtime) 대상 등록: notices, profiles
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. 구조 확인
-- ---------------------------------------------------------------------
do $$
declare
  need text[][] := array[
    ['characters','id'],['characters','slug'],['characters','name'],['characters','kind'],['characters','suit'],
    ['characters','chip_color'],['characters','image_path'],['characters','age'],['characters','height'],
    ['characters','keywords'],['characters','description'],['characters','sort_order'],
    ['inventory','character_id'],['inventory','item_id'],['inventory','quantity'],['inventory','note'],['inventory','sort_order'],
    ['items','id'],['items','name'],['items','description'],['items','image_path'],['items','price'],
    ['items','stock'],['items','is_for_sale'],['items','sort_order'],
    ['notices','id'],['notices','title'],['notices','body'],['notices','is_pinned'],['notices','pin_order'],
    ['notices','published_at'],['notices','category_id'],
    ['notice_categories','id'],['notice_categories','name'],['notice_categories','sort_order'],
    ['chapters','number'],['chapters','title'],['chapters','summary'],['chapters','played_on']
  ];
  missing text := '';
  i int;
  id_type text;
begin
  for i in 1 .. array_length(need, 1) loop
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = need[i][1] and column_name = need[i][2]) then
      missing := missing || need[i][1] || '.' || need[i][2] || ' ';
    end if;
  end loop;
  if missing <> '' then
    raise exception '예상한 컬럼이 없습니다: %  → 이 목록을 그대로 전달해 주세요. (아무것도 변경되지 않았습니다)', missing;
  end if;

  select data_type into id_type from information_schema.columns
   where table_schema = 'public' and table_name = 'characters' and column_name = 'id';
  if id_type <> 'uuid' then
    raise exception 'characters.id 형식이 uuid가 아닙니다(%). 이 메시지를 전달해 주세요.', id_type;
  end if;
  select data_type into id_type from information_schema.columns
   where table_schema = 'public' and table_name = 'items' and column_name = 'id';
  if id_type <> 'uuid' then
    raise exception 'items.id 형식이 uuid가 아닙니다(%). 이 메시지를 전달해 주세요.', id_type;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. 테이블
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade
);
alter table public.profiles
  add column if not exists email        text,
  add column if not exists display_name text,
  add column if not exists role         text        not null default 'member',
  add column if not exists chips        integer     not null default 0,
  add column if not exists character_id uuid        references public.characters(id) on delete set null,
  add column if not exists created_at   timestamptz not null default now();

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add  constraint profiles_role_check  check (role in ('admin', 'member'));
alter table public.profiles drop constraint if exists profiles_chips_check;
alter table public.profiles add  constraint profiles_chips_check check (chips >= 0);
alter table public.profiles drop constraint if exists profiles_name_len;
alter table public.profiles add  constraint profiles_name_len    check (display_name is null or char_length(display_name) <= 30);
create unique index if not exists profiles_character_unique on public.profiles(character_id) where character_id is not null;

create table if not exists public.chip_ledger (
  id         bigint generated always as identity primary key,
  profile_id uuid        not null references public.profiles(id) on delete cascade,
  delta      integer     not null,
  balance    integer     not null,
  reason     text,
  actor      uuid        default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists chip_ledger_profile on public.chip_ledger(profile_id, created_at desc);

-- 캐릭터 목록용 작은 이미지 (관리 페이지 업로드 시 자동 생성)
alter table public.characters add column if not exists thumb_path text;
alter table public.notices alter column published_at set default now();

-- ---------------------------------------------------------------------
-- 3. 함수
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 이미 있는 계정도 profiles 생성
insert into public.profiles (id, email, display_name)
select id, email, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

-- 칩 지급(+) / 차감(-) — 관리자만. 잔액이 음수가 되면 거절
create or replace function public.admin_adjust_chips(p_profile uuid, p_delta integer, p_reason text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_balance integer;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  if p_delta is null or p_delta = 0 then raise exception '변경할 칩 수를 입력해 주세요'; end if;

  select chips into v_balance from public.profiles where id = p_profile for update;
  if not found then raise exception '멤버를 찾을 수 없습니다'; end if;
  if v_balance + p_delta < 0 then raise exception '잔액이 부족합니다 (현재 %)', v_balance; end if;

  update public.profiles set chips = chips + p_delta where id = p_profile returning chips into v_balance;
  insert into public.chip_ledger (profile_id, delta, balance, reason) values (p_profile, p_delta, v_balance, nullif(trim(p_reason), ''));
  return v_balance;
end $$;

-- 멤버 ↔ 캐릭터 연결 — 관리자만 (멤버가 남의 캐릭터를 가져가지 못하게)
create or replace function public.admin_set_character(p_profile uuid, p_character uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  update public.profiles set character_id = p_character where id = p_profile;
  if not found then raise exception '멤버를 찾을 수 없습니다'; end if;
end $$;

-- 캐릭터 소지품 통째로 교체 — 관리자만. 한 번에 처리돼 중간에 끊겨도 반쪽 저장이 없음
-- p_rows 예: [{"item_id":"…","quantity":2,"note":"메모"}, …]  (배열 순서 = 표시 순서)
create or replace function public.admin_set_inventory(p_character uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  if not exists (select 1 from public.characters where id = p_character) then raise exception '캐릭터를 찾을 수 없습니다'; end if;
  delete from public.inventory where character_id = p_character;
  insert into public.inventory (character_id, item_id, quantity, note, sort_order)
  select p_character, (r->>'item_id')::uuid, greatest(coalesce((r->>'quantity')::int, 1), 1), nullif(trim(r->>'note'), ''), (ord - 1)::int
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as t(r, ord)
  where nullif(r->>'item_id', '') is not null;
end $$;

revoke all on function public.admin_set_inventory(uuid, jsonb) from public, anon;
grant execute on function public.admin_set_inventory(uuid, jsonb) to authenticated;
revoke all on function public.admin_adjust_chips(uuid, integer, text) from public, anon;
revoke all on function public.admin_set_character(uuid, uuid)        from public, anon;
grant execute on function public.admin_adjust_chips(uuid, integer, text) to authenticated;
grant execute on function public.admin_set_character(uuid, uuid)        to authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. 권한(열 단위) — 멤버는 자기 표시 이름만 수정 가능. 역할·칩·캐릭터는 불가
-- ---------------------------------------------------------------------
revoke insert, update, delete on public.profiles    from anon, authenticated;
grant  update (display_name)  on public.profiles    to authenticated;
revoke insert, update, delete on public.chip_ledger from anon, authenticated;
grant  select on public.profiles, public.chip_ledger to authenticated;

-- ---------------------------------------------------------------------
-- 5. RLS — 대상 테이블의 기존 정책 전부 제거 후 재설정
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public'
             and tablename in ('characters','inventory','items','notices','notice_categories','chapters','profiles','chip_ledger')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['characters','inventory','items','notices','notice_categories','chapters'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    execute format('create policy "admin write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

alter table public.profiles    enable row level security;
alter table public.chip_ledger enable row level security;
create policy "own or admin read" on public.profiles    for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "own update"        on public.profiles    for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "own or admin read" on public.chip_ledger for select to authenticated using (profile_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- 6. 스토리지 — 공개 버킷, 업로드·수정·삭제는 관리자만
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('characters', 'characters', true), ('items', 'items', true)
on conflict (id) do update set public = true;

drop policy if exists "comu admin select" on storage.objects;
drop policy if exists "comu admin insert" on storage.objects;
drop policy if exists "comu admin update" on storage.objects;
drop policy if exists "comu admin delete" on storage.objects;
create policy "comu admin select" on storage.objects for select to authenticated using      (bucket_id in ('characters','items') and public.is_admin());
create policy "comu admin insert" on storage.objects for insert to authenticated with check (bucket_id in ('characters','items') and public.is_admin());
create policy "comu admin update" on storage.objects for update to authenticated using      (bucket_id in ('characters','items') and public.is_admin())
                                                                                  with check (bucket_id in ('characters','items') and public.is_admin());
create policy "comu admin delete" on storage.objects for delete to authenticated using      (bucket_id in ('characters','items') and public.is_admin());

-- ---------------------------------------------------------------------
-- 7. 실시간 반영
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['notices','profiles'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

commit;

-- =====================================================================
--  첫 관리자 지정 — 본인 계정으로 한 번 로그인(또는 초대 수락)한 뒤,
--  아래 줄의 이메일을 바꿔서 따로 실행하세요.
-- =====================================================================
-- update public.profiles set role = 'admin' where email = '관리자 이메일';
