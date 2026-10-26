-- =====================================================================
--  update-14 : 블랙잭 더미
--   · 관리자가 빈 자리에 더미를 앉힘 (테스트·인원 채우기용)
--   · 더미는 실제 칩을 쓰지 않음: 판마다 최소 베팅으로 자동 참여, 결과만 표시
--   · 더미 차례는 자동 진행: 16 이하면 카드를 받고 17 이상이면 멈춤
--   · 더미만 있을 때는 관리자가 '카드 나누기'로 판을 시작
--   update-13 다음에 한 번 실행. 여러 번 실행해도 안전합니다.
-- =====================================================================
begin;

alter table public.bj_seats alter column character_id drop not null;
alter table public.bj_seats add column if not exists dummy_name text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bj_seats_who') then
    alter table public.bj_seats add constraint bj_seats_who check (character_id is not null or dummy_name is not null);
  end if;
end $$;

-- 자리 이름 (캐릭터 또는 더미)
create or replace function public.bj_seat_name(p_table uuid, p_seat integer)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(case when s.character_id is not null then public.rl_char_name(s.character_id) end, s.dummy_name || '(더미)', '?')
    from public.bj_seats s where s.table_id = p_table and s.seat = p_seat;
$$;

-- 다음 자리로. 더미 차례면 그 자리에서 바로 자동 진행하고 계속 넘어감
create or replace function public.bj_advance(p_table uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t record; s record; v_next integer; v_cards integer[]; v_t integer;
begin
  loop
    select * into t from public.bj_tables where id = p_table;
    select seat into v_next from public.bj_seats where table_id = p_table and state = 'playing' and seat > coalesce(t.turn_seat, -1) order by seat limit 1;
    if v_next is null then
      select seat into v_next from public.bj_seats where table_id = p_table and state = 'playing' order by seat limit 1;
    end if;
    if v_next is null then
      perform public.bj_settle(p_table);
      return;
    end if;
    update public.bj_tables set turn_seat = v_next, last_action_at = now() where id = p_table;
    select * into s from public.bj_seats where table_id = p_table and seat = v_next;
    if s.character_id is not null then return; end if;
    -- 더미: 17이 될 때까지 받기
    v_cards := s.cards;
    while public.bj_total(v_cards) < 17 loop v_cards := v_cards || public.bj_draw(p_table); end loop;
    v_t := public.bj_total(v_cards);
    update public.bj_seats set cards = v_cards, state = case when v_t > 21 then 'bust' else 'stood' end where table_id = p_table and seat = v_next;
    if v_t > 21 then perform public.bj_system(p_table, public.bj_seat_name(p_table, v_next) || ' ' || v_t || ' 버스트', 'system', jsonb_build_object('event', 'bust', 'seat', v_next)); end if;
  end loop;
end $$;

-- 정산: 더미는 칩 없이 결과만
create or replace function public.bj_settle(p_table uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t record; s record; v_hole integer; v_dealer integer[]; v_dt integer; v_dbj boolean; v_pt integer;
  v_res text; v_pay integer; v_lines text[] := '{}';
begin
  select * into t from public.bj_tables where id = p_table for update;
  select hole into v_hole from public.bj_secrets where table_id = p_table;
  v_dealer := t.dealer_cards || v_hole;
  v_dbj := public.bj_is_blackjack(v_dealer);
  if not v_dbj and exists (select 1 from public.bj_seats where table_id = p_table and state = 'stood') then
    while public.bj_total(v_dealer) < 17 loop
      v_dealer := v_dealer || public.bj_draw(p_table);
    end loop;
  end if;
  v_dt := public.bj_total(v_dealer);
  update public.bj_secrets set hole = null where table_id = p_table;

  for s in select * from public.bj_seats where table_id = p_table and state in ('stood', 'bust', 'blackjack') order by seat loop
    v_pt := public.bj_total(s.cards);
    if s.state = 'bust' then v_res := 'lose'; v_pay := 0;
    elsif s.state = 'blackjack' then
      if v_dbj then v_res := 'push'; v_pay := s.bet;
      else v_res := 'blackjack'; v_pay := s.bet + floor(s.bet * 1.5)::integer; end if;
    elsif v_dbj then v_res := 'lose'; v_pay := 0;
    elsif v_dt > 21 or v_pt > v_dt then v_res := 'win'; v_pay := s.bet * 2;
    elsif v_pt = v_dt then v_res := 'push'; v_pay := s.bet;
    else v_res := 'lose'; v_pay := 0; end if;
    if v_pay > 0 and s.character_id is not null then
      perform public.chip_add(s.character_id, v_pay, 'game',
        case v_res when 'push' then '블랙잭 무승부 (돌려받음) — ' else '블랙잭 승리 — ' end || t.title, p_table, t.currency);
    end if;
    update public.bj_seats set result = v_res, payout = v_pay, state = 'idle' where table_id = p_table and seat = s.seat;
    v_lines := v_lines || (public.bj_seat_name(p_table, s.seat) || ' ' ||
      case when s.character_id is null then case v_res when 'blackjack' then '블랙잭!' when 'win' then '승' when 'push' then '무승부' else '패' end
      else case v_res when 'blackjack' then '블랙잭! +' || (v_pay - s.bet) when 'win' then '승 +' || (v_pay - s.bet) when 'push' then '무승부' else '패 -' || s.bet end end);
  end loop;
  update public.bj_seats set state = 'idle' where table_id = p_table and state <> 'idle';
  update public.bj_tables set dealer_cards = v_dealer, phase = 'betting', turn_seat = null, bet_deadline = null, last_action_at = now() where id = p_table;
  perform public.bj_system(p_table, '딜러 ' || case when v_dbj then '블랙잭' when v_dt > 21 then v_dt || ' 버스트' else v_dt::text end ||
    case when array_length(v_lines, 1) > 0 then ' · ' || array_to_string(v_lines, ' · ') else '' end,
    'result', jsonb_build_object('event', 'settle', 'dealer', v_dt, 'dealer_bj', v_dbj));
end $$;

-- 카드 나누기: 더미는 최소 베팅으로 자동 참여
create or replace function public.bj_deal(p_table uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t record; s record; v_up integer; v_hole integer; v_dbj boolean; n integer;
begin
  select * into t from public.bj_tables where id = p_table for update;
  if t.phase <> 'betting' then return; end if;
  update public.bj_seats set state = 'bet', bet = t.min_bet, doubled = false, result = null, payout = 0
   where table_id = p_table and character_id is null;
  select count(*) into n from public.bj_seats where table_id = p_table and state = 'bet';
  if n = 0 then return; end if;
  update public.bj_secrets set shoe = '{}' where table_id = p_table and coalesce(array_length(shoe, 1), 0) < 60;
  update public.bj_seats set cards = '{}', result = null, payout = 0, bet = 0, doubled = false where table_id = p_table and state = 'idle';
  update public.bj_seats set cards = '{}' where table_id = p_table and state = 'bet';
  for s in select seat from public.bj_seats where table_id = p_table and state = 'bet' order by seat loop
    update public.bj_seats set cards = array[public.bj_draw(p_table)] where table_id = p_table and seat = s.seat;
  end loop;
  v_up := public.bj_draw(p_table);
  for s in select seat from public.bj_seats where table_id = p_table and state = 'bet' order by seat loop
    update public.bj_seats set cards = cards || public.bj_draw(p_table) where table_id = p_table and seat = s.seat;
  end loop;
  v_hole := public.bj_draw(p_table);
  update public.bj_secrets set hole = v_hole where table_id = p_table;
  update public.bj_seats set state = case when public.bj_is_blackjack(cards) then 'blackjack' else 'playing' end
   where table_id = p_table and state = 'bet';
  update public.bj_tables set phase = 'playing', round = round + 1, dealer_cards = array[v_up], turn_seat = null,
    bet_deadline = null, last_action_at = now() where id = p_table;
  perform public.bj_system(p_table, (t.round + 1) || '번째 판 — 카드를 나눴습니다. 딜러 ' || public.bj_card_name(v_up), 'system', jsonb_build_object('event', 'deal'));
  v_dbj := public.bj_value(v_up) >= 10 and public.bj_is_blackjack(array[v_up, v_hole]);
  if v_dbj then
    update public.bj_seats set state = 'stood' where table_id = p_table and state = 'playing';
    perform public.bj_settle(p_table);
  else
    perform public.bj_advance(p_table);
  end if;
end $$;

-- 베팅: '모두 걸었는지'는 사람 자리만 봄
create or replace function public.bj_bet(p_table uuid, p_character uuid, p_amount integer)
returns integer language plpgsql security definer set search_path = public as $$
declare t record; s record; v_bal integer;
begin
  if not public.rl_owns(p_character) then raise exception '내 캐릭터의 칩으로만 걸 수 있습니다' using errcode = '42501'; end if;
  select * into t from public.bj_tables where id = p_table for update;
  if not found or t.status <> 'open' then raise exception '닫힌 테이블입니다'; end if;
  if t.phase <> 'betting' then raise exception '이번 판이 끝난 뒤에 걸 수 있습니다'; end if;
  select * into s from public.bj_seats where table_id = p_table and character_id = p_character;
  if not found then raise exception '먼저 자리에 앉아 주세요'; end if;
  if s.state = 'bet' then raise exception '이번 판에는 이미 걸었습니다'; end if;
  if p_amount is null or p_amount < t.min_bet or p_amount > t.max_bet then raise exception '베팅은 %~%칩입니다', t.min_bet, t.max_bet; end if;
  v_bal := public.chip_balance_locked(p_character, t.currency);
  if v_bal < p_amount then raise exception '%이 부족합니다 (보유 %)', public.chip_name(t.currency), v_bal; end if;
  perform public.chip_add(p_character, -p_amount, 'game', '블랙잭 베팅 — ' || t.title, p_table, t.currency);
  update public.bj_seats set bet = p_amount, state = 'bet', doubled = false, result = null, payout = 0, cards = '{}'
   where table_id = p_table and character_id = p_character;
  update public.bj_tables set bet_deadline = coalesce(bet_deadline, now() + interval '20 seconds'), last_action_at = now() where id = p_table;
  perform public.bj_system(p_table, public.rl_char_name(p_character) || ' ' || p_amount || '칩 베팅', 'system', jsonb_build_object('event', 'bet'));
  if not exists (select 1 from public.bj_seats where table_id = p_table and state = 'idle' and character_id is not null) then
    perform public.bj_deal(p_table);
  end if;
  return v_bal - p_amount;
end $$;

-- 관리자: 더미 앉히기
create or replace function public.admin_bj_add_dummy(p_table uuid, p_name text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare t record; v_seat integer; v_name text;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  select * into t from public.bj_tables where id = p_table for update;
  if not found or t.status <> 'open' then raise exception '닫힌 테이블입니다'; end if;
  select min(g) into v_seat from generate_series(0, t.max_seats - 1) g
   where not exists (select 1 from public.bj_seats where table_id = p_table and seat = g);
  if v_seat is null then raise exception '자리가 다 찼습니다'; end if;
  v_name := coalesce(nullif(left(trim(p_name), 12), ''), '더미 ' || (select count(*) + 1 from public.bj_seats where table_id = p_table and character_id is null));
  insert into public.bj_seats (table_id, seat, character_id, dummy_name) values (p_table, v_seat, null, v_name);
  perform public.bj_system(p_table, v_name || '(더미)가 앉았습니다.');
  return v_seat;
end $$;

-- 관리자: 지금 카드 나누기 (더미만 있을 때나 기다리기 싫을 때)
create or replace function public.admin_bj_deal_now(p_table uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  select * into t from public.bj_tables where id = p_table for update;
  if not found or t.status <> 'open' then raise exception '닫힌 테이블입니다'; end if;
  if t.phase <> 'betting' then raise exception '이번 판이 끝난 뒤에 나눌 수 있습니다'; end if;
  if not exists (select 1 from public.bj_seats where table_id = p_table and (state = 'bet' or character_id is null)) then
    raise exception '베팅한 자리가 없습니다';
  end if;
  perform public.bj_deal(p_table);
end $$;

-- 닫기·자리 비우기: 더미는 칩이 없으니 환불 없음
create or replace function public.admin_bj_close(p_table uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t record; s record;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  select * into t from public.bj_tables where id = p_table for update;
  if not found or t.status = 'closed' then return; end if;
  for s in select * from public.bj_seats where table_id = p_table and state <> 'idle' and bet > 0 and character_id is not null loop
    perform public.chip_add(s.character_id, s.bet, 'game', '블랙잭 테이블 닫힘 — 베팅 환불', p_table, t.currency);
  end loop;
  update public.bj_seats set state = 'idle', bet = 0 where table_id = p_table;
  update public.bj_tables set status = 'closed', phase = 'betting', turn_seat = null, bet_deadline = null, last_action_at = now() where id = p_table;
  delete from public.bj_secrets where table_id = p_table;
  perform public.bj_system(p_table, '테이블이 닫혔습니다. 진행 중이던 베팅은 돌려드렸습니다.');
end $$;

create or replace function public.admin_bj_kick(p_table uuid, p_seat integer)
returns void language plpgsql security definer set search_path = public as $$
declare t record; s record; v_name text;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  select * into t from public.bj_tables where id = p_table for update;
  select * into s from public.bj_seats where table_id = p_table and seat = p_seat;
  if not found then return; end if;
  v_name := public.bj_seat_name(p_table, p_seat);
  if s.state <> 'idle' and s.bet > 0 and s.character_id is not null then
    perform public.chip_add(s.character_id, s.bet, 'game', '블랙잭 — 관리자가 자리를 비워 베팅 환불', p_table, t.currency);
  end if;
  delete from public.bj_seats where table_id = p_table and seat = p_seat;
  perform public.bj_system(p_table, v_name || ' 님의 자리를 비웠습니다.');
  if t.phase = 'playing' and t.turn_seat = p_seat then perform public.bj_advance(p_table);
  elsif t.phase = 'playing' and not exists (select 1 from public.bj_seats where table_id = p_table and state = 'playing') then perform public.bj_settle(p_table);
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['bj_seat_name(uuid, integer)', 'bj_advance(uuid)', 'bj_settle(uuid)', 'bj_deal(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['bj_bet(uuid, uuid, integer)', 'admin_bj_add_dummy(uuid, text)', 'admin_bj_deal_now(uuid)', 'admin_bj_close(uuid)', 'admin_bj_kick(uuid, integer)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;

select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'bj_seats' and column_name = 'dummy_name') as dummy_col,
       (select count(*) from pg_proc where proname in ('admin_bj_add_dummy', 'admin_bj_deal_now', 'bj_seat_name')) as funcs;
