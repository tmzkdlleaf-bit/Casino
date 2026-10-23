-- =====================================================================
--  update-9 (update-8.sql 다음에 실행)
--  Supabase 대시보드 > SQL Editor 에 전체를 붙여 넣고 Run 한 번. 여러 번 실행해도 안전합니다.
--
--  1) 칩 지급·차감이 안 되던 문제 고침
--     chip_ledger.reason 칸에는 'admin' · 'shop' · 'game' · 'transfer' 넷 중 하나만 들어갈 수 있는데,
--     관리 화면의 사유 글을 그대로 넣어서 거절되고 있었음. → 종류는 reason, 사유 글은 memo 칸에 넣도록
--     칩을 움직이는 함수를 모두 다시 만듦 (관리자 칩 조정 · 상점 승인 · 룰렛 참가비/베팅/정산/환불)
--  2) 칩 정산 요청: 멤버가 "칩 100개 추가" 같은 요청을 올리고 관리자가 승인하면 반영
--  3) 관리자 지정: 관리 → 멤버에서 바로 (SQL 없이)
--  4) 캐릭터 역할 이름: characters.role_title (예: 바텐더, 벨 걸) — 큰 구분(직원/참가자)은 그대로
--  5) 룰렛 더미: 관리자가 대기 중인 방에 더미 자리를 넣고, 더미 차례는 관리자가 대신 진행
--     칩은 실제로 오가며 더미는 칩 계산에서 빠짐 (참가비 없음 · 더미가 이기면 판돈은 낸 사람들에게 환불)
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0. 칩 기록 한 줄 넣기 (모든 함수가 이것만 씀)
--    p_kind: 'admin' | 'shop' | 'game' | 'transfer'   p_memo: 사람이 읽는 설명 (200자까지)
-- ---------------------------------------------------------------------
create or replace function public.chip_add(p_character uuid, p_amount integer, p_kind text, p_memo text, p_ref uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_amount = 0 then return; end if;
  insert into public.chip_ledger (character_id, amount, reason, memo, ref_id, created_by)
  values (p_character, p_amount, p_kind, left(coalesce(p_memo, ''), 200), p_ref, auth.uid());
end $$;
revoke all on function public.chip_add(uuid, integer, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. 관리자 칩 조정 (관리 → 멤버)
-- ---------------------------------------------------------------------
create or replace function public.admin_adjust_chips(p_character uuid, p_amount integer, p_reason text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_balance integer;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  if p_amount is null or p_amount = 0 then raise exception '변경할 칩 수를 입력해 주세요'; end if;
  if not exists (select 1 from public.characters where id = p_character) then raise exception '캐릭터를 찾을 수 없습니다'; end if;
  v_balance := public.chip_balance_locked(p_character);
  if v_balance + p_amount < 0 then raise exception '잔액이 부족합니다 (현재 %)', v_balance; end if;
  perform public.chip_add(p_character, p_amount, 'admin', coalesce(nullif(trim(p_reason), ''), '관리자 조정'));
  return v_balance + p_amount;
end $$;
revoke all on function public.admin_adjust_chips(uuid, integer, text) from public, anon;
grant execute on function public.admin_adjust_chips(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. 상점 승인 (update-7.sql 과 같고 칩 기록 부분만 다름)
-- ---------------------------------------------------------------------
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
  v_bal := public.chip_balance_locked(r.character_id);
  if v_bal < r.total then raise exception '칩이 부족해 승인할 수 없습니다 (보유 %, 필요 %)', v_bal, r.total; end if;
  select stock into v_stock from public.items where id = r.item_id for update;
  if v_stock is not null then
    if v_stock < r.quantity then raise exception '재고가 부족해 승인할 수 없습니다 (남은 수량 %)', v_stock; end if;
    update public.items set stock = stock - r.quantity where id = r.item_id;
  end if;
  perform public.chip_add(r.character_id, -r.total, 'shop', '상점 구매: ' || r.item_name || ' ×' || r.quantity, r.id);
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

-- ---------------------------------------------------------------------
-- 3. 칩 정산 요청 (멤버가 올리고 관리자가 승인)
-- ---------------------------------------------------------------------
create table if not exists public.chip_requests (
  id           uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  amount       integer not null check (amount <> 0 and amount between -1000000 and 1000000),
  reason       text not null default '',
  status       text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  admin_note   text not null default '',
  requested_by uuid default auth.uid(),
  decided_by   uuid,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
create index if not exists chip_requests_status_idx on public.chip_requests (status, created_at desc);
create index if not exists chip_requests_char_idx   on public.chip_requests (character_id, created_at desc);
alter table public.chip_requests enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'chip_requests' loop
    execute format('drop policy %I on public.chip_requests', p.policyname);
  end loop;
end $$;
create policy "owner or admin read" on public.chip_requests for select to authenticated using (
  public.is_admin() or exists (select 1 from public.characters c where c.id = chip_requests.character_id and c.owner_id = auth.uid())
);
revoke all on public.chip_requests from anon, authenticated;
grant select on public.chip_requests to authenticated;

create or replace function public.chip_request(p_character uuid, p_amount integer, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n integer;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다' using errcode = '42501'; end if;
  if not exists (select 1 from public.characters where id = p_character and owner_id = auth.uid()) then
    raise exception '내 캐릭터로만 요청할 수 있습니다' using errcode = '42501'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000 then raise exception '칩 수를 확인해 주세요 (0이 아닌 정수)'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception '사유를 적어 주세요 (예: 10월 활동 정산)'; end if;
  select count(*) into v_n from public.chip_requests where character_id = p_character and status = 'pending';
  if v_n >= 10 then raise exception '승인 대기 중인 요청이 너무 많습니다 (10개까지)'; end if;
  insert into public.chip_requests (character_id, amount, reason) values (p_character, p_amount, left(trim(p_reason), 200)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.chip_request_cancel(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.chip_requests r set status = 'cancelled', decided_at = now(), decided_by = auth.uid()
   where r.id = p_request and r.status = 'pending'
     and exists (select 1 from public.characters c where c.id = r.character_id and c.owner_id = auth.uid());
  if not found then raise exception '취소할 수 있는 요청이 아닙니다'; end if;
end $$;

create or replace function public.admin_chip_decide(p_request uuid, p_approve boolean, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare r record; v_bal integer;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  select * into r from public.chip_requests where id = p_request for update;
  if not found then raise exception '요청을 찾을 수 없습니다'; end if;
  if r.status <> 'pending' then raise exception '이미 처리된 요청입니다'; end if;
  if p_approve then
    v_bal := public.chip_balance_locked(r.character_id);
    if v_bal + r.amount < 0 then raise exception '잔액이 부족해 승인할 수 없습니다 (현재 %)', v_bal; end if;
    perform public.chip_add(r.character_id, r.amount, 'admin', '정산 요청 승인: ' || r.reason, r.id);
  end if;
  update public.chip_requests set status = case when p_approve then 'approved' else 'rejected' end,
    admin_note = left(coalesce(trim(p_note), ''), 200), decided_by = auth.uid(), decided_at = now() where id = p_request;
  return case when p_approve then 'approved' else 'rejected' end;
end $$;

revoke all on function public.chip_request(uuid, integer, text)            from public, anon;
revoke all on function public.chip_request_cancel(uuid)                     from public, anon;
revoke all on function public.admin_chip_decide(uuid, boolean, text)        from public, anon;
grant execute on function public.chip_request(uuid, integer, text)         to authenticated;
grant execute on function public.chip_request_cancel(uuid)                  to authenticated;
grant execute on function public.admin_chip_decide(uuid, boolean, text)     to authenticated;

-- ---------------------------------------------------------------------
-- 4. 관리자 지정 (관리 → 멤버). 자기 자신은 바꿀 수 없음 (실수로 관리자가 0명이 되는 것 방지)
-- ---------------------------------------------------------------------
create or replace function public.admin_set_role(p_user uuid, p_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception '자기 자신의 관리자 권한은 바꿀 수 없습니다. 다른 관리자에게 부탁해 주세요'; end if;
  update public.profiles set role = case when p_admin then 'admin' else 'member' end where id = p_user;
  if not found then raise exception '멤버를 찾을 수 없습니다'; end if;
end $$;
revoke all on function public.admin_set_role(uuid, boolean) from public, anon;
grant execute on function public.admin_set_role(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 5. 캐릭터 역할 이름 (공개 읽기는 기존 characters 정책을 따름, 쓰기는 관리자)
-- ---------------------------------------------------------------------
alter table public.characters add column if not exists role_title text not null default '';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'characters_role_title_len') then
    alter table public.characters add constraint characters_role_title_len check (char_length(role_title) <= 20);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. 룰렛: 더미 자리 + 칩 기록 고침
-- ---------------------------------------------------------------------
alter table public.roulette_seats alter column character_id drop not null;
alter table public.roulette_seats add column if not exists dummy_name text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'roulette_seats_who') then
    alter table public.roulette_seats add constraint roulette_seats_who check ((character_id is null) <> (dummy_name is null));
  end if;
end $$;

-- 자리 이름 (캐릭터 이름 또는 '더미 이름')
create or replace function public.rl_seat_name(p_room uuid, p_seat integer)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select c.name from public.roulette_seats s join public.characters c on c.id = s.character_id where s.room_id = p_room and s.seat = p_seat),
                  (select s.dummy_name from public.roulette_seats s where s.room_id = p_room and s.seat = p_seat), '(빈 자리)');
$$;
-- 이 자리를 지금 조작할 수 있는가: 캐릭터 주인, 더미는 관리자
create or replace function public.rl_controls(p_character uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case when p_character is null then public.is_admin() else public.rl_owns(p_character) end;
$$;

create or replace function public.admin_roulette_add_dummy(p_room uuid, p_name text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare rm record; v_seat integer; v_name text;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  select * into rm from public.roulette_rooms where id = p_room for update;
  if not found then raise exception '방을 찾을 수 없습니다'; end if;
  if rm.status <> 'waiting' then raise exception '대기 중인 방에만 더미를 넣을 수 있습니다'; end if;
  select min(g) into v_seat from generate_series(0, rm.max_seats - 1) g
   where not exists (select 1 from public.roulette_seats where room_id = p_room and seat = g);
  if v_seat is null then raise exception '자리가 다 찼습니다'; end if;
  v_name := coalesce(nullif(left(trim(p_name), 20), ''), '더미 ' || (1 + (select count(*) from public.roulette_seats where room_id = p_room and dummy_name is not null)));
  insert into public.roulette_seats (room_id, seat, dummy_name) values (p_room, v_seat, v_name);
  perform public.rl_system(p_room, v_name || '(더미)가 앉았습니다.');
  return v_seat;
end $$;

create or replace function public.admin_roulette_kick(p_room uuid, p_seat integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  if not exists (select 1 from public.roulette_rooms where id = p_room and status = 'waiting') then raise exception '대기 중인 방에서만 자리를 비울 수 있습니다'; end if;
  v_name := public.rl_seat_name(p_room, p_seat);
  delete from public.roulette_seats where room_id = p_room and seat = p_seat;
  if not found then raise exception '빈 자리입니다'; end if;
  perform public.rl_system(p_room, v_name || ' 님의 자리를 비웠습니다.');
end $$;

create or replace function public.rl_refund_all(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare rm record; s record; b record;
begin
  select * into rm from public.roulette_rooms where id = p_room;
  if rm.status = 'playing' and rm.entry_fee > 0 then
    for s in select * from public.roulette_seats where room_id = p_room and character_id is not null loop
      perform public.chip_add(s.character_id, rm.entry_fee, 'game', '러시안 룰렛 취소 — 참가비 환불', p_room);
    end loop;
  end if;
  for b in select * from public.roulette_bets where room_id = p_room and payout is null loop
    perform public.chip_add(b.character_id, b.amount, 'game', '러시안 룰렛 취소 — 베팅 환불', p_room);
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
      perform public.chip_add(w.character_id, rm.pot, 'game', '러시안 룰렛 우승 (판돈) — ' || rm.title, p_room);
    else   -- 더미가 이기면 판돈은 낸 사람들에게 돌려줌
      for s in select * from public.roulette_seats where room_id = p_room and character_id is not null loop
        perform public.chip_add(s.character_id, rm.entry_fee, 'game', '러시안 룰렛 — 더미 우승으로 참가비 환불', p_room);
      end loop;
    end if;
  end if;

  select coalesce(sum(amount), 0) into v_total from public.roulette_bets where room_id = p_room;
  select coalesce(sum(amount), 0) into v_win   from public.roulette_bets where room_id = p_room and seat = w.seat;
  for b in select * from public.roulette_bets where room_id = p_room loop
    v_pay := case when v_win > 0 then case when b.seat = w.seat then floor(b.amount::numeric * v_total / v_win)::integer else 0 end else b.amount end;
    update public.roulette_bets set payout = v_pay where id = b.id;
    if v_pay > 0 then
      perform public.chip_add(b.character_id, v_pay, 'game', case when v_win > 0 then '룰렛 베팅 적중' else '룰렛 베팅 환불 (적중자 없음)' end, p_room);
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
            left(rm.title || case when v_dummies > 0 then ' (더미 ' || v_dummies || ' 포함' || case when w.character_id is null then ', 우승 ' || v_wname else '' end || ')' else '' end, 120);
  end if;
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
      v_bal := public.chip_balance_locked(s.character_id);
      if v_bal < rm.entry_fee then raise exception '%의 칩이 부족합니다 (보유 %, 참가비 %)', public.rl_char_name(s.character_id), v_bal, rm.entry_fee; end if;
      perform public.chip_add(s.character_id, -rm.entry_fee, 'game', '러시안 룰렛 참가비 — ' || rm.title, p_room);
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

create or replace function public.admin_roulette_skip(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare rm record; v_next integer;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  select * into rm from public.roulette_rooms where id = p_room for update;
  if not found or rm.status <> 'playing' then raise exception '진행 중인 방이 아닙니다'; end if;
  v_next := public.rl_next_seat(p_room, rm.turn_seat);
  update public.roulette_rooms set turn_seat = v_next, self_survived = false, last_action_at = now() where id = p_room;
  perform public.rl_system(p_room, '관리자가 차례를 넘겼습니다 → ' || public.rl_seat_name(p_room, v_next), 'system', jsonb_build_object('event', 'turn'));
end $$;

create or replace function public.roulette_shoot(p_room uuid, p_target integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rm record; me record; tg record;
  v_bullet integer; v_shots integer; v_live boolean; v_round integer; v_alive integer; v_turn integer; v_self boolean; v_data jsonb;
  v_me text; v_tg text;
begin
  select * into rm from public.roulette_rooms where id = p_room for update;
  if not found or rm.status <> 'playing' then raise exception '진행 중인 게임이 아닙니다'; end if;
  select * into me from public.roulette_seats where room_id = p_room and seat = rm.turn_seat;
  if not found or not public.rl_controls(me.character_id) then raise exception '내 차례가 아닙니다'; end if;
  select * into tg from public.roulette_seats where room_id = p_room and seat = p_target;
  if not found or not tg.alive then raise exception '쏠 수 없는 자리입니다'; end if;
  v_me := public.rl_seat_name(p_room, me.seat); v_tg := public.rl_seat_name(p_room, p_target);

  select bullet into v_bullet from public.roulette_secrets where room_id = p_room;
  v_shots := rm.shots + 1; v_live := v_shots = v_bullet; v_round := rm.round;
  if v_live then
    update public.roulette_seats set alive = false, out_at = now() where room_id = p_room and seat = p_target;
    update public.roulette_secrets set bullet = 1 + floor(random() * 6)::int where room_id = p_room;
    v_shots := 0; v_round := rm.round + 1;
  end if;
  v_data := jsonb_build_object('event', 'shot', 'shooter', me.seat, 'target', p_target, 'live', v_live, 'shot_no', rm.shots + 1, 'round', rm.round);
  perform public.rl_system(p_room, v_me ||
    case when p_target = me.seat then ' → 자신에게' else ' → ' || v_tg || '에게' end ||
    case when v_live then ' 파지직! 명중. ' || v_tg || ' 탈락' else ' 철컥… 빈 칸' end, 'shot', v_data);

  select count(*) into v_alive from public.roulette_seats where room_id = p_room and alive;
  if v_alive <= 1 then
    update public.roulette_rooms set shots = v_shots, round = v_round where id = p_room;
    perform public.rl_finish(p_room);
    return v_data || jsonb_build_object('finished', true);
  end if;
  if p_target = me.seat and not v_live then v_turn := me.seat; v_self := true;
  else v_turn := public.rl_next_seat(p_room, me.seat); v_self := false; end if;
  update public.roulette_rooms set shots = v_shots, round = v_round, turn_seat = v_turn, self_survived = v_self, last_action_at = now() where id = p_room;
  if v_live then perform public.rl_system(p_room, '탄창을 다시 채웠습니다 (' || v_round || '번째 탄창).', 'system', jsonb_build_object('event', 'reload')); end if;
  return v_data || jsonb_build_object('finished', false);
end $$;

create or replace function public.roulette_pass(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare rm record; me record; v_next integer;
begin
  select * into rm from public.roulette_rooms where id = p_room for update;
  if not found or rm.status <> 'playing' then raise exception '진행 중인 게임이 아닙니다'; end if;
  select * into me from public.roulette_seats where room_id = p_room and seat = rm.turn_seat;
  if not found or not public.rl_controls(me.character_id) then raise exception '내 차례가 아닙니다'; end if;
  if rm.pass_rule = 'after_self' and not rm.self_survived then raise exception '나에게 한 번 쏘고 살아남아야 넘길 수 있습니다'; end if;
  v_next := public.rl_next_seat(p_room, me.seat);
  update public.roulette_rooms set turn_seat = v_next, self_survived = false, last_action_at = now() where id = p_room;
  perform public.rl_system(p_room, public.rl_seat_name(p_room, me.seat) || ' 님이 차례를 넘겼습니다 → ' || public.rl_seat_name(p_room, v_next), 'system', jsonb_build_object('event', 'turn'));
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
  v_bal := public.chip_balance_locked(p_character);
  if v_bal < p_amount then raise exception '칩이 부족합니다 (보유 %)', v_bal; end if;
  perform public.chip_add(p_character, -p_amount, 'game', '러시안 룰렛 베팅 — ' || rm.title, p_room);
  insert into public.roulette_bets (room_id, seat, character_id, amount) values (p_room, p_seat, p_character, p_amount);
  perform public.rl_system(p_room, public.rl_char_name(p_character) || ' 님이 ' || public.rl_seat_name(p_room, p_seat) || '에게 ' || p_amount || '칩을 걸었습니다.',
    'system', jsonb_build_object('event', 'bet'));
  return v_bal - p_amount;
end $$;

-- 실행 권한
do $$
declare f text;
begin
  foreach f in array array['rl_seat_name(uuid, integer)', 'rl_controls(uuid)', 'rl_finish(uuid)', 'rl_refund_all(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['admin_roulette_add_dummy(uuid, text)', 'admin_roulette_kick(uuid, integer)', 'admin_roulette_start(uuid)',
    'admin_roulette_skip(uuid)', 'roulette_shoot(uuid, integer)', 'roulette_pass(uuid)', 'roulette_bet(uuid, integer, uuid, integer)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- 실시간 반영: 칩 정산 요청
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chip_requests') then
    execute 'alter publication supabase_realtime add table public.chip_requests';
  end if;
end $$;

commit;
