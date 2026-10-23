-- =====================================================================
--  update-7: 상점 구매 요청 → 관리자 승인 → 칩 차감 · 상품 지급 · 구매 기록
--  Supabase 대시보드 > SQL Editor 에 전체를 붙여 넣고 Run 한 번. (update-6.sql 다음)
--  여러 번 실행해도 안전합니다. 중간에 오류가 나면 전부 취소됩니다.
--
--  흐름
--   1) 멤버: 자기 캐릭터로 '구매 요청' (이때는 칩이 빠지지 않음)
--   2) 관리자: 관리 → 구매 요청 탭에서 승인 또는 거절
--   3) 승인하는 순간 한 번에 처리 — 칩 차감(chip_ledger) + 재고 감소 + 소지품 지급(inventory)
--      칩이나 재고가 모자라면 아무것도 바뀌지 않고 승인이 거절됨
--   4) 요청 한 줄 한 줄이 그대로 구매 기록 — 누가 · 언제 · 무엇을 · 몇 개 · 얼마에 · 누가 승인했는지
--
--  만드는 것
--   표   shop_requests            (구매 요청 = 구매 기록)
--   함수 shop_request()           멤버: 요청하기
--        shop_cancel()            멤버: 대기 중인 내 요청 취소
--        admin_shop_decide()      관리자: 승인 / 거절
--        chip_balance_locked()    칩 잔액 확인용 (다른 함수 안에서만 씀)
--   실시간 반영: shop_requests (멤버는 자기 것만, 관리자는 전부 받음)
-- =====================================================================
begin;

create table if not exists public.shop_requests (
  id           uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  item_id      uuid references public.items(id) on delete set null,
  item_name    text not null default '',        -- 요청 당시 이름 (아이템을 지워도 기록은 남음)
  unit_price   integer not null default 0,
  quantity     integer not null default 1 check (quantity between 1 and 99),
  total        integer not null default 0,
  status       text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  memo         text not null default '',        -- 요청한 사람이 남긴 말
  admin_note   text not null default '',        -- 관리자가 남긴 말 (거절 사유 등)
  requested_by uuid default auth.uid(),
  decided_by   uuid,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
create index if not exists shop_requests_status_idx on public.shop_requests (status, created_at desc);
create index if not exists shop_requests_char_idx   on public.shop_requests (character_id, created_at desc);

alter table public.shop_requests enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'shop_requests' loop
    execute format('drop policy %I on public.shop_requests', p.policyname);
  end loop;
end $$;
-- 읽기: 내 캐릭터의 요청 + 관리자는 전부. 쓰기는 아래 함수로만
create policy "owner or admin read" on public.shop_requests for select to authenticated using (
  public.is_admin() or exists (select 1 from public.characters c where c.id = shop_requests.character_id and c.owner_id = auth.uid())
);
revoke all on public.shop_requests from anon, authenticated;
grant select on public.shop_requests to authenticated;

-- ---------------------------------------------------------------------
-- 칩 잔액: 같은 캐릭터를 동시에 처리하지 못하게 잠근 뒤 합계를 돌려줌
-- ---------------------------------------------------------------------
create or replace function public.chip_balance_locked(p_character uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  perform pg_advisory_xact_lock(hashtext('chips:' || p_character::text));   -- admin_adjust_chips 와 같은 잠금
  select coalesce(sum(amount), 0) into v from public.chip_ledger where character_id = p_character;
  return v;
end $$;
revoke all on function public.chip_balance_locked(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 멤버: 구매 요청
--   - 내 캐릭터만 / 상점에 있는 아이템만 / 1~99개
--   - 요청 시점에도 확인: (잔액 - 이미 대기 중인 요청 합계) 가 모자라면 거절, 재고도 확인
--   - 대기 중인 요청은 캐릭터당 10개까지
-- ---------------------------------------------------------------------
create or replace function public.shop_request(p_character uuid, p_item uuid, p_quantity integer default 1, p_memo text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  it record;
  v_total integer;
  v_bal integer;
  v_pending integer;
  v_pending_qty integer;
  v_id uuid;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다' using errcode = '42501'; end if;
  if not exists (select 1 from public.characters where id = p_character and owner_id = auth.uid()) then
    raise exception '내 캐릭터로만 구매할 수 있습니다' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then raise exception '수량은 1~99개입니다'; end if;

  select id, name, price, stock, is_for_sale into it from public.items where id = p_item;
  if not found or not it.is_for_sale then raise exception '판매 중인 상품이 아닙니다'; end if;
  if it.price is null then raise exception '가격이 정해지지 않은 상품입니다'; end if;
  v_total := it.price * p_quantity;

  v_bal := public.chip_balance_locked(p_character);
  select coalesce(sum(total), 0), count(*) into v_pending, v_pending_qty
    from public.shop_requests where character_id = p_character and status = 'pending';
  if v_pending_qty >= 10 then raise exception '승인 대기 중인 요청이 너무 많습니다 (10개까지)'; end if;
  if v_bal - v_pending < v_total then
    raise exception '칩이 부족합니다 (보유 %, 대기 중 %, 필요 %)', v_bal, v_pending, v_total;
  end if;

  if it.stock is not null then
    select coalesce(sum(quantity), 0) into v_pending_qty from public.shop_requests where item_id = p_item and status = 'pending';
    if it.stock - v_pending_qty < p_quantity then raise exception '재고가 부족합니다 (남은 수량 %)', greatest(it.stock - v_pending_qty, 0); end if;
  end if;

  insert into public.shop_requests (character_id, item_id, item_name, unit_price, quantity, total, memo, requested_by)
  values (p_character, p_item, it.name, it.price, p_quantity, v_total, left(coalesce(trim(p_memo), ''), 200), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- 멤버: 대기 중인 내 요청 취소
create or replace function public.shop_cancel(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.shop_requests r set status = 'cancelled', decided_at = now(), decided_by = auth.uid()
   where r.id = p_request and r.status = 'pending'
     and exists (select 1 from public.characters c where c.id = r.character_id and c.owner_id = auth.uid());
  if not found then raise exception '취소할 수 있는 요청이 아닙니다 (이미 처리됐거나 내 요청이 아님)'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 관리자: 승인 / 거절
--   승인 = 칩 차감 + 재고 감소 + 소지품에 추가 (같은 아이템이 있으면 수량만 늘림) — 한 번에
-- ---------------------------------------------------------------------
create or replace function public.admin_shop_decide(p_request uuid, p_approve boolean, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_bal integer;
  v_stock integer;
  v_target tid;
  v_sort integer;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  select * into r from public.shop_requests where id = p_request for update;   -- 두 관리자가 동시에 눌러도 한 번만 처리
  if not found then raise exception '요청을 찾을 수 없습니다'; end if;
  if r.status <> 'pending' then raise exception '이미 처리된 요청입니다'; end if;

  if not p_approve then
    update public.shop_requests set status = 'rejected', admin_note = left(coalesce(trim(p_note), ''), 200), decided_by = auth.uid(), decided_at = now() where id = p_request;
    return 'rejected';
  end if;

  if r.item_id is null then raise exception '상품이 삭제되어 승인할 수 없습니다. 거절해 주세요'; end if;

  v_bal := public.chip_balance_locked(r.character_id);
  if v_bal < r.total then raise exception '칩이 부족해 승인할 수 없습니다 (보유 %, 필요 %)', v_bal, r.total; end if;

  select stock into v_stock from public.items where id = r.item_id for update;
  if v_stock is not null then
    if v_stock < r.quantity then raise exception '재고가 부족해 승인할 수 없습니다 (남은 수량 %)', v_stock; end if;
    update public.items set stock = stock - r.quantity where id = r.item_id;
  end if;

  if r.total <> 0 then
    insert into public.chip_ledger (character_id, amount, reason, created_by)
    values (r.character_id, -r.total, '상점 구매: ' || r.item_name || ' ×' || r.quantity, auth.uid());
  end if;

  -- 소지품: 같은 아이템 칸이 있으면 수량 추가, 없으면 맨 뒤에 새 칸
  select ctid into v_target from public.inventory where character_id = r.character_id and item_id = r.item_id order by sort_order limit 1;
  if v_target is not null then
    update public.inventory set quantity = quantity + r.quantity where ctid = v_target;
  else
    select coalesce(max(sort_order) + 1, 0) into v_sort from public.inventory where character_id = r.character_id;
    insert into public.inventory (character_id, item_id, quantity, note, sort_order) values (r.character_id, r.item_id, r.quantity, '', v_sort);
  end if;

  update public.shop_requests set status = 'approved', admin_note = left(coalesce(trim(p_note), ''), 200), decided_by = auth.uid(), decided_at = now() where id = p_request;
  return 'approved';
end $$;

revoke all on function public.shop_request(uuid, uuid, integer, text)      from public, anon;
revoke all on function public.shop_cancel(uuid)                            from public, anon;
revoke all on function public.admin_shop_decide(uuid, boolean, text)       from public, anon;
grant execute on function public.shop_request(uuid, uuid, integer, text)   to authenticated;
grant execute on function public.shop_cancel(uuid)                         to authenticated;
grant execute on function public.admin_shop_decide(uuid, boolean, text)    to authenticated;

-- 실시간 반영
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shop_requests') then
    execute 'alter publication supabase_realtime add table public.shop_requests';
  end if;
end $$;

commit;

-- 확인: 아래가 3 이면 정상 (함수 3개)
-- select count(*) from pg_proc where proname in ('shop_request','shop_cancel','admin_shop_decide');
