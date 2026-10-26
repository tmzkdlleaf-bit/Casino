-- =====================================================================
--  update-12 : 칩 두 종류 — 블루 칩(blue) · 핑크 칩(pink)
--   · 서로 바꿀 수 없는 별개의 칩. 지금까지의 칩은 모두 블루 칩
--   · 상품 · 정산 요청 · 관리자 지급 · 룰렛 방마다 어느 칩인지 정함 (기본 블루)
--   update-11 다음에 한 번 실행. 여러 번 실행해도 안전합니다.
-- =====================================================================
begin;

-- 1. 칩 종류 칸 ---------------------------------------------------------
alter table public.chip_ledger    add column if not exists currency text not null default 'blue';
alter table public.items          add column if not exists currency text not null default 'blue';
alter table public.shop_requests  add column if not exists currency text not null default 'blue';
alter table public.chip_requests  add column if not exists currency text not null default 'blue';
alter table public.roulette_rooms add column if not exists currency text not null default 'blue';
do $$
declare t text;
begin
  foreach t in array array['chip_ledger', 'items', 'shop_requests', 'chip_requests', 'roulette_rooms'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_currency_chk') then
      execute format('alter table public.%I add constraint %I check (currency in (''blue'', ''pink''))', t, t || '_currency_chk');
    end if;
  end loop;
end $$;

-- 2. 잔액: balance = 블루, pink = 핑크 -----------------------------------
drop view if exists public.chip_balances;
create view public.chip_balances as
  select character_id,
         coalesce(sum(amount) filter (where currency = 'blue'), 0)::integer as balance,
         coalesce(sum(amount) filter (where currency = 'pink'), 0)::integer as pink
    from public.chip_ledger group by character_id;
alter view public.chip_balances set (security_invoker = true);
grant select on public.chip_balances to authenticated;

-- 3. 칩 기록·잔액 확인 (칩 종류를 받음, 안 주면 블루) ----------------------
drop function if exists public.chip_add(uuid, integer, text, text, uuid);
create or replace function public.chip_add(p_character uuid, p_amount integer, p_kind text, p_memo text, p_ref uuid default null, p_currency text default 'blue')
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_amount = 0 then return; end if;
  if p_currency not in ('blue', 'pink') then raise exception '칩 종류가 올바르지 않습니다'; end if;
  insert into public.chip_ledger (character_id, amount, reason, memo, ref_id, created_by, currency)
  values (p_character, p_amount, p_kind, left(coalesce(p_memo, ''), 200), p_ref, auth.uid(), p_currency);
end $$;
revoke all on function public.chip_add(uuid, integer, text, text, uuid, text) from public, anon, authenticated;

drop function if exists public.chip_balance_locked(uuid);
create or replace function public.chip_balance_locked(p_character uuid, p_currency text default 'blue')
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  perform pg_advisory_xact_lock(hashtext('chips:' || p_character::text));
  select coalesce(sum(amount), 0) into v from public.chip_ledger where character_id = p_character and currency = p_currency;
  return v;
end $$;
revoke all on function public.chip_balance_locked(uuid, text) from public, anon, authenticated;

create or replace function public.chip_name(p_currency text)
returns text language sql immutable as $$ select case when p_currency = 'pink' then '핑크 칩' else '블루 칩' end $$;

-- 4. 관리자 칩 조정 --------------------------------------------------------
drop function if exists public.admin_adjust_chips(uuid, integer, text);
create or replace function public.admin_adjust_chips(p_character uuid, p_amount integer, p_reason text default null, p_currency text default 'blue')
returns integer language plpgsql security definer set search_path = public as $$
declare v_balance integer;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  if p_amount is null or p_amount = 0 then raise exception '변경할 칩 수를 입력해 주세요'; end if;
  if p_currency not in ('blue', 'pink') then raise exception '칩 종류가 올바르지 않습니다'; end if;
  if not exists (select 1 from public.characters where id = p_character) then raise exception '캐릭터를 찾을 수 없습니다'; end if;
  v_balance := public.chip_balance_locked(p_character, p_currency);
  if v_balance + p_amount < 0 then raise exception '%이 부족합니다 (현재 %)', public.chip_name(p_currency), v_balance; end if;
  perform public.chip_add(p_character, p_amount, 'admin', coalesce(nullif(trim(p_reason), ''), '관리자 조정'), null, p_currency);
  return v_balance + p_amount;
end $$;
revoke all on function public.admin_adjust_chips(uuid, integer, text, text) from public, anon;
grant execute on function public.admin_adjust_chips(uuid, integer, text, text) to authenticated;

-- 5. 상점: 상품의 칩 종류로 계산 -------------------------------------------
create or replace function public.shop_request(p_character uuid, p_item uuid, p_quantity integer default 1, p_memo text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare it record; v_total integer; v_bal integer; v_pending integer; v_pending_qty integer; v_id uuid;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다' using errcode = '42501'; end if;
  if not exists (select 1 from public.characters where id = p_character and owner_id = auth.uid()) then
    raise exception '내 캐릭터로만 구매할 수 있습니다' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then raise exception '수량은 1~99개입니다'; end if;
  select id, name, price, stock, is_for_sale, currency into it from public.items where id = p_item;
  if not found or not it.is_for_sale then raise exception '판매 중인 상품이 아닙니다'; end if;
  if it.price is null then raise exception '가격이 정해지지 않은 상품입니다'; end if;
  v_total := it.price * p_quantity;
  v_bal := public.chip_balance_locked(p_character, it.currency);
  select coalesce(sum(total) filter (where currency = it.currency), 0), count(*) into v_pending, v_pending_qty
    from public.shop_requests where character_id = p_character and status = 'pending';
  if v_pending_qty >= 10 then raise exception '승인 대기 중인 요청이 너무 많습니다 (10개까지)'; end if;
  if v_bal - v_pending < v_total then
    raise exception '%이 부족합니다 (보유 %, 대기 중 %, 필요 %)', public.chip_name(it.currency), v_bal, v_pending, v_total;
  end if;
  if it.stock is not null then
    select coalesce(sum(quantity), 0) into v_pending_qty from public.shop_requests where item_id = p_item and status = 'pending';
    if it.stock - v_pending_qty < p_quantity then raise exception '재고가 부족합니다 (남은 수량 %)', greatest(it.stock - v_pending_qty, 0); end if;
  end if;
  insert into public.shop_requests (character_id, item_id, item_name, unit_price, quantity, total, memo, requested_by, currency)
  values (p_character, p_item, it.name, it.price, p_quantity, v_total, left(coalesce(trim(p_memo), ''), 200), auth.uid(), it.currency)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.admin_shop_decide(p_request uuid, p_approve boolean, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare r record; v_bal integer; v_stock integer; v_target tid; v_sort integer;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  select * into r from public.shop_requests where id = p_request for update;
  if not found then raise exception '요청을 찾을 수 없습니다'; end if;
  if r.status <> 'pending' then raise exception '이미 처리된 요청입니다'; end if;
  if not p_approve then
    update public.shop_requests set status = 'rejected', admin_note = left(coalesce(trim(p_note), ''), 200), decided_by = auth.uid(), decided_at = now() where id = p_request;
    return 'rejected';
  end if;
  if r.item_id is null then raise exception '상품이 삭제되어 승인할 수 없습니다. 거절해 주세요'; end if;
  v_bal := public.chip_balance_locked(r.character_id, r.currency);
  if v_bal < r.total then raise exception '%이 부족해 승인할 수 없습니다 (보유 %, 필요 %)', public.chip_name(r.currency), v_bal, r.total; end if;
  select stock into v_stock from public.items where id = r.item_id for update;
  if v_stock is not null then
    if v_stock < r.quantity then raise exception '재고가 부족해 승인할 수 없습니다 (남은 수량 %)', v_stock; end if;
    update public.items set stock = stock - r.quantity where id = r.item_id;
  end if;
  perform public.chip_add(r.character_id, -r.total, 'shop', '상점 구매: ' || r.item_name || ' ×' || r.quantity, r.id, r.currency);
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

-- 6. 칩 정산 요청: 칩 종류 선택 --------------------------------------------
drop function if exists public.chip_request(uuid, integer, text);
create or replace function public.chip_request(p_character uuid, p_amount integer, p_reason text, p_currency text default 'blue')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n integer;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다' using errcode = '42501'; end if;
  if not exists (select 1 from public.characters where id = p_character and owner_id = auth.uid()) then
    raise exception '내 캐릭터로만 요청할 수 있습니다' using errcode = '42501'; end if;
  if p_currency not in ('blue', 'pink') then raise exception '칩 종류가 올바르지 않습니다'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000 then raise exception '칩 수를 확인해 주세요 (0이 아닌 정수)'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception '사유를 적어 주세요 (예: 10월 활동 정산)'; end if;
  select count(*) into v_n from public.chip_requests where character_id = p_character and status = 'pending';
  if v_n >= 10 then raise exception '승인 대기 중인 요청이 너무 많습니다 (10개까지)'; end if;
  insert into public.chip_requests (character_id, amount, reason, currency) values (p_character, p_amount, left(trim(p_reason), 200), p_currency) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.chip_request(uuid, integer, text, text) from public, anon;
grant execute on function public.chip_request(uuid, integer, text, text) to authenticated;

create or replace function public.admin_chip_decide(p_request uuid, p_approve boolean, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare r record; v_bal integer;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  select * into r from public.chip_requests where id = p_request for update;
  if not found then raise exception '요청을 찾을 수 없습니다'; end if;
  if r.status <> 'pending' then raise exception '이미 처리된 요청입니다'; end if;
  if p_approve then
    v_bal := public.chip_balance_locked(r.character_id, r.currency);
    if v_bal + r.amount < 0 then raise exception '%이 부족해 승인할 수 없습니다 (현재 %)', public.chip_name(r.currency), v_bal; end if;
    perform public.chip_add(r.character_id, r.amount, 'admin', '정산 요청 승인: ' || r.reason, r.id, r.currency);
  end if;
  update public.chip_requests set status = case when p_approve then 'approved' else 'rejected' end,
    admin_note = left(coalesce(trim(p_note), ''), 200), decided_by = auth.uid(), decided_at = now() where id = p_request;
  return case when p_approve then 'approved' else 'rejected' end;
end $$;

-- 7. 러시안 룰렛: 방의 칩 종류로 ------------------------------------------
drop function if exists public.admin_roulette_create(text, integer, integer, text);
create or replace function public.admin_roulette_create(p_title text, p_max_seats integer default 6, p_entry_fee integer default 0, p_pass_rule text default 'after_self', p_currency text default 'blue')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  if p_max_seats is null or p_max_seats < 2 or p_max_seats > 8 then raise exception '자리는 2~8개입니다'; end if;
  if p_entry_fee is null or p_entry_fee < 0 then raise exception '참가비는 0 이상입니다'; end if;
  if p_pass_rule not in ('after_self','free') then raise exception '넘기기 규칙이 올바르지 않습니다'; end if;
  if p_currency not in ('blue', 'pink') then raise exception '칩 종류가 올바르지 않습니다'; end if;
  insert into public.roulette_rooms (title, max_seats, entry_fee, pass_rule, currency)
  values (coalesce(nullif(left(trim(p_title), 40), ''), '러시안 룰렛'), p_max_seats, p_entry_fee, p_pass_rule, p_currency)
  returning id into v_id;
  perform public.rl_system(v_id, '방이 열렸습니다. 자리에 앉아 주세요.');
  return v_id;
end $$;
revoke all on function public.admin_roulette_create(text, integer, integer, text, text) from public, anon;
grant execute on function public.admin_roulette_create(text, integer, integer, text, text) to authenticated;

create or replace function public.roulette_join(p_room uuid, p_character uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare rm record; v_seat integer;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다' using errcode = '42501'; end if;
  if not public.rl_owns(p_character) then raise exception '내 캐릭터로만 앉을 수 있습니다' using errcode = '42501'; end if;
  select * into rm from public.roulette_rooms where id = p_room for update;
  if not found then raise exception '방을 찾을 수 없습니다'; end if;
  if rm.status <> 'waiting' then raise exception '이미 시작했거나 끝난 방입니다'; end if;
  if exists (select 1 from public.roulette_seats s join public.characters c on c.id = s.character_id
             where s.room_id = p_room and c.owner_id = auth.uid()) then
    raise exception '이미 이 방에 앉아 있습니다';
  end if;
  select min(g) into v_seat from generate_series(0, rm.max_seats - 1) g
   where not exists (select 1 from public.roulette_seats where room_id = p_room and seat = g);
  if v_seat is null then raise exception '자리가 다 찼습니다'; end if;
  if rm.entry_fee > 0 and public.chip_balance_locked(p_character, rm.currency) < rm.entry_fee then
    raise exception '참가비(% %)보다 칩이 적습니다', public.chip_name(rm.currency), rm.entry_fee;
  end if;
  insert into public.roulette_seats (room_id, seat, character_id) values (p_room, v_seat, p_character);
  perform public.rl_system(p_room, public.rl_char_name(p_character) || ' 님이 앉았습니다.');
  return v_seat;
end $$;

create or replace function public.admin_roulette_start(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare rm record; s record; n integer; n_real integer; v_bal integer;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  select * into rm from public.roulette_rooms where id = p_room for update;
  if not found then raise exception '방을 찾을 수 없습니다'; end if;
  if rm.status <> 'waiting' then raise exception '대기 중인 방만 시작할 수 있습니다'; end if;
  select count(*), count(character_id) into n, n_real from public.roulette_seats where room_id = p_room;
  if n < 2 then raise exception '두 자리 이상 차야 시작할 수 있습니다'; end if;
  if rm.entry_fee > 0 then
    for s in select * from public.roulette_seats where room_id = p_room and character_id is not null order by seat loop
      v_bal := public.chip_balance_locked(s.character_id, rm.currency);
      if v_bal < rm.entry_fee then raise exception '%의 %이 부족합니다 (보유 %, 참가비 %)', public.rl_char_name(s.character_id), public.chip_name(rm.currency), v_bal, rm.entry_fee; end if;
      perform public.chip_add(s.character_id, -rm.entry_fee, 'game', '러시안 룰렛 참가비 — ' || rm.title, p_room, rm.currency);
    end loop;
  end if;
  insert into public.roulette_secrets (room_id, bullet) values (p_room, 1 + floor(random() * 6)::int)
  on conflict (room_id) do update set bullet = excluded.bullet;
  update public.roulette_seats set alive = true, out_at = null where room_id = p_room;
  update public.roulette_rooms set status = 'playing', pot = rm.entry_fee * n_real, shots = 0, round = 1, self_survived = false,
    turn_seat = (select seat from public.roulette_seats where room_id = p_room order by random() limit 1),
    started_at = now(), last_action_at = now()
  where id = p_room;
  select * into rm from public.roulette_rooms where id = p_room;
  perform public.rl_system(p_room, '게임 시작! 탄창 6칸에 1발. 첫 차례: ' || public.rl_seat_name(p_room, rm.turn_seat), 'system', jsonb_build_object('event', 'start'));
end $$;

create or replace function public.roulette_bet(p_room uuid, p_seat integer, p_character uuid, p_amount integer)
returns integer language plpgsql security definer set search_path = public as $$
declare rm record; v_bal integer;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다' using errcode = '42501'; end if;
  if not public.rl_owns(p_character) then raise exception '내 캐릭터의 칩으로만 걸 수 있습니다' using errcode = '42501'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 1000000 then raise exception '베팅은 1칩 이상입니다'; end if;
  select * into rm from public.roulette_rooms where id = p_room for update;
  if not found or rm.status <> 'playing' then raise exception '게임이 진행 중일 때만 걸 수 있습니다'; end if;
  if exists (select 1 from public.roulette_seats where room_id = p_room and not alive) then raise exception '첫 탈락자가 나와 베팅이 마감되었습니다'; end if;
  if not exists (select 1 from public.roulette_seats where room_id = p_room and seat = p_seat) then raise exception '빈 자리에는 걸 수 없습니다'; end if;
  v_bal := public.chip_balance_locked(p_character, rm.currency);
  if v_bal < p_amount then raise exception '%이 부족합니다 (보유 %)', public.chip_name(rm.currency), v_bal; end if;
  perform public.chip_add(p_character, -p_amount, 'game', '러시안 룰렛 베팅 — ' || rm.title, p_room, rm.currency);
  insert into public.roulette_bets (room_id, seat, character_id, amount) values (p_room, p_seat, p_character, p_amount);
  perform public.rl_system(p_room, public.rl_char_name(p_character) || ' 님이 ' || public.rl_seat_name(p_room, p_seat) || '에게 ' || p_amount || '칩을 걸었습니다.',
    'system', jsonb_build_object('event', 'bet'));
  return v_bal - p_amount;
end $$;

create or replace function public.rl_refund_all(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare rm record; s record; b record;
begin
  select * into rm from public.roulette_rooms where id = p_room;
  if rm.status = 'playing' and rm.entry_fee > 0 then
    for s in select * from public.roulette_seats where room_id = p_room and character_id is not null loop
      perform public.chip_add(s.character_id, rm.entry_fee, 'game', '러시안 룰렛 취소 — 참가비 환불', p_room, rm.currency);
    end loop;
  end if;
  for b in select * from public.roulette_bets where room_id = p_room and payout is null loop
    perform public.chip_add(b.character_id, b.amount, 'game', '러시안 룰렛 취소 — 베팅 환불', p_room, rm.currency);
    update public.roulette_bets set payout = b.amount where id = b.id;
  end loop;
end $$;

create or replace function public.rl_finish(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare rm record; w record; b record; s record;
  v_total integer; v_win integer; v_pay integer; v_ids uuid[]; v_wname text; v_dummies integer;
begin
  select * into rm from public.roulette_rooms where id = p_room;
  select * into w from public.roulette_seats where room_id = p_room and alive order by seat limit 1;
  v_wname := public.rl_seat_name(p_room, w.seat);

  if rm.pot > 0 then
    if w.character_id is not null then
      perform public.chip_add(w.character_id, rm.pot, 'game', '러시안 룰렛 우승 (판돈) — ' || rm.title, p_room, rm.currency);
    else
      for s in select * from public.roulette_seats where room_id = p_room and character_id is not null loop
        perform public.chip_add(s.character_id, rm.entry_fee, 'game', '러시안 룰렛 — 더미 우승으로 참가비 환불', p_room, rm.currency);
      end loop;
    end if;
  end if;

  select coalesce(sum(amount), 0) into v_total from public.roulette_bets where room_id = p_room;
  select coalesce(sum(amount), 0) into v_win   from public.roulette_bets where room_id = p_room and seat = w.seat;
  for b in select * from public.roulette_bets where room_id = p_room loop
    v_pay := case when v_win > 0 then case when b.seat = w.seat then floor(b.amount::numeric * v_total / v_win)::integer else 0 end else b.amount end;
    update public.roulette_bets set payout = v_pay where id = b.id;
    if v_pay > 0 then
      perform public.chip_add(b.character_id, v_pay, 'game', case when v_win > 0 then '룰렛 베팅 적중' else '룰렛 베팅 환불 (적중자 없음)' end, p_room, rm.currency);
    end if;
  end loop;

  update public.roulette_rooms set status = 'finished', winner_seat = w.seat, turn_seat = null, ended_at = now(), last_action_at = now() where id = p_room;
  delete from public.roulette_secrets where room_id = p_room;
  perform public.rl_system(p_room, v_wname || ' 우승!' ||
    case when rm.pot > 0 then case when w.character_id is null then ' (더미라 참가비는 환불)' else ' 판돈 ' || rm.pot || '칩' end else '' end ||
    case when v_total > 0 then ' · 베팅 ' || v_total || '칩 ' || case when v_win > 0 then '정산' else '전액 환불' end else '' end,
    'system', jsonb_build_object('event', 'finish', 'seat', w.seat));

  if to_regclass('public.game_records') is not null then
    select array_agg(character_id order by seat), count(*) filter (where character_id is null) into v_ids, v_dummies
      from public.roulette_seats where room_id = p_room;
    execute 'insert into public.game_records (played_at, game_name, winner_id, participant_ids, chips, note) values (now(), $1, $2, $3, $4, $5)'
      using '러시안 룰렛', w.character_id, array_remove(v_ids, null), case when w.character_id is null then 0 else rm.pot end,
            left(rm.title || case when rm.currency = 'pink' then ' · 핑크 칩' else '' end || case when v_dummies > 0 then ' (더미 ' || v_dummies || ' 포함' || case when w.character_id is null then ', 우승 ' || v_wname else '' end || ')' else '' end, 120);
  end if;
end $$;
revoke all on function public.rl_finish(uuid) from public, anon, authenticated;
revoke all on function public.rl_refund_all(uuid) from public, anon, authenticated;

-- 8. 룰렛 전적: 칩 종류별 득실 ------------------------------------------------
drop function if exists public.roulette_stats();
create or replace function public.roulette_stats()
returns table (character_id uuid, name text, played integer, wins integer, net integer, net_pink integer)
language sql stable security definer set search_path = public as $$
  with g as (
    select c.id, c.name,
      (select count(*) from public.game_records r where r.game_name = '러시안 룰렛' and c.id = any(r.participant_ids))::int as played,
      (select count(*) from public.game_records r where r.game_name = '러시안 룰렛' and r.winner_id = c.id)::int as wins,
      (select coalesce(sum(l.amount), 0) from public.chip_ledger l where l.character_id = c.id and l.reason = 'game' and l.memo like '%룰렛%' and l.currency = 'blue')::int as net,
      (select coalesce(sum(l.amount), 0) from public.chip_ledger l where l.character_id = c.id and l.reason = 'game' and l.memo like '%룰렛%' and l.currency = 'pink')::int as net_pink
    from public.characters c
  )
  select id, name, played, wins, net, net_pink from g where played > 0
  order by wins desc, net desc, played desc, name;
$$;
revoke all on function public.roulette_stats() from public;
grant execute on function public.roulette_stats() to anon, authenticated;

commit;

-- 확인
select (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'currency'
          and table_name in ('chip_ledger', 'items', 'shop_requests', 'chip_requests', 'roulette_rooms')) as currency_cols,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'chip_balances' and column_name = 'pink') as pink_view,
       (select pronargs from pg_proc where proname = 'chip_add') as chip_add_args;
