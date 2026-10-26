-- =====================================================================
--  update-16 : 블랙잭 — 카드 가리기 · 직원 캐릭터 딜러
--   · hide_cards: 켜면 판이 끝날 때까지 남의 카드는 뒷면 (몇 장인지만). 정산 때 공개
--     → 카드는 bj_view() 로만 읽게 하고, 거기서 남의 카드를 가려서 줌 (bj_seats 직접 읽기 막음)
--   · dealer_character_id: 직원 캐릭터가 딜러 자리에 앉음
--     딜러(관리자 또는 그 캐릭터의 주인)가 '카드 나누기'와 '딜러 카드 펼치기'를 누름
--     베팅은 첫 베팅 30초 뒤, 딜러 차례도 30초 뒤에 자동 진행
--     딜러가 없으면 지금처럼 컴퓨터가 자동 진행
--   update-15 다음에 한 번 실행. 여러 번 실행해도 안전합니다.
-- =====================================================================
begin;

alter table public.bj_tables add column if not exists hide_cards boolean not null default false;
alter table public.bj_tables add column if not exists dealer_character_id uuid references public.characters(id) on delete set null;

-- 자리 표는 직접 읽지 못하게 (카드를 가려야 하므로). 화면은 bj_view / bj_lobby 로 읽음
revoke select on public.bj_seats from anon, authenticated;
do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bj_seats') then
    execute 'alter publication supabase_realtime drop table public.bj_seats';
  end if;
end $$;

-- 딜러를 움직일 수 있는 사람: 관리자 또는 딜러 캐릭터의 주인
drop trigger if exists bj_seats_touch on public.bj_seats;
drop function if exists public.bj_touch();

create or replace function public.bj_dealer_ctl(p_table uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.bj_tables t join public.characters c on c.id = t.dealer_character_id
     where t.id = p_table and c.owner_id = auth.uid());
$$;

-- 자리 보기 (가린 테이블이면 진행 중엔 남의 카드를 -1(뒷면)로)
create or replace function public.bj_view(p_table uuid)
returns table (seat integer, character_id uuid, dummy_name text, bet integer, cards integer[], state text, doubled boolean, result text, payout integer)
language sql stable security definer set search_path = public as $$
  select s.seat, s.character_id, s.dummy_name, s.bet,
    case when t.hide_cards and t.phase = 'playing' and coalesce(c.owner_id <> auth.uid() or auth.uid() is null, true) and coalesce(array_length(s.cards, 1), 0) > 0
         then array_fill(-1, array[array_length(s.cards, 1)]) else s.cards end,
    case when t.hide_cards and t.phase = 'playing' and coalesce(c.owner_id <> auth.uid() or auth.uid() is null, true) and s.state in ('stood', 'bust', 'blackjack')
         then 'stood' else s.state end,
    s.doubled, s.result, s.payout
  from public.bj_seats s
  join public.bj_tables t on t.id = s.table_id
  left join public.characters c on c.id = s.character_id
  where s.table_id = p_table
  order by s.seat;
$$;

-- 로비: 테이블 목록 + 앉은 수
create or replace function public.bj_lobby()
returns table (id uuid, title text, status text, phase text, currency text, min_bet integer, max_bet integer, max_seats integer,
               round integer, max_rounds integer, hide_cards boolean, dealer_character_id uuid, seats integer, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.title, t.status, t.phase, t.currency, t.min_bet, t.max_bet, t.max_seats, t.round, t.max_rounds, t.hide_cards, t.dealer_character_id,
         (select count(*) from public.bj_seats s where s.table_id = t.id)::integer, t.created_at
    from public.bj_tables t order by t.created_at desc limit 20;
$$;

-- 앉기·일어나기: 테이블 줄도 건드려서 실시간으로 다른 화면이 다시 읽게
create or replace function public.bj_join(p_table uuid, p_character uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare t record; v_seat integer;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다' using errcode = '42501'; end if;
  if not public.rl_owns(p_character) then raise exception '내 캐릭터로만 앉을 수 있습니다' using errcode = '42501'; end if;
  select * into t from public.bj_tables where id = p_table for update;
  if not found or t.status <> 'open' then raise exception '닫힌 테이블입니다'; end if;
  if t.dealer_character_id = p_character then raise exception '딜러 캐릭터는 손님 자리에 앉을 수 없습니다'; end if;
  if exists (select 1 from public.bj_seats s join public.characters c on c.id = s.character_id where s.table_id = p_table and c.owner_id = auth.uid()) then
    raise exception '이미 이 테이블에 앉아 있습니다';
  end if;
  select min(g) into v_seat from generate_series(0, t.max_seats - 1) g
   where not exists (select 1 from public.bj_seats where table_id = p_table and seat = g);
  if v_seat is null then raise exception '자리가 다 찼습니다'; end if;
  insert into public.bj_seats (table_id, seat, character_id) values (p_table, v_seat, p_character);
  update public.bj_tables set last_action_at = now() where id = p_table;
  perform public.bj_system(p_table, public.rl_char_name(p_character) || ' 님이 앉았습니다.');
  return v_seat;
end $$;

create or replace function public.bj_leave(p_table uuid, p_character uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t record; s record;
begin
  if not public.rl_owns(p_character) then raise exception '내 캐릭터만 일어날 수 있습니다' using errcode = '42501'; end if;
  select * into t from public.bj_tables where id = p_table for update;
  select * into s from public.bj_seats where table_id = p_table and character_id = p_character;
  if not found then return; end if;
  if s.state in ('playing', 'stood', 'bust', 'blackjack') then raise exception '이번 판이 끝난 뒤에 일어날 수 있습니다'; end if;
  if s.state = 'bet' and s.bet > 0 then
    perform public.chip_add(p_character, s.bet, 'game', '블랙잭 베팅 취소 — ' || t.title, p_table, t.currency);
  end if;
  delete from public.bj_seats where table_id = p_table and character_id = p_character;
  update public.bj_tables set last_action_at = now() where id = p_table;
  perform public.bj_system(p_table, public.rl_char_name(p_character) || ' 님이 일어났습니다.');
end $$;

-- 베팅: 딜러가 있으면 모두 걸어도 기다림(딜러가 나눔), 마감은 첫 베팅 30초 뒤
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
  update public.bj_tables set bet_deadline = coalesce(bet_deadline, now() + case when t.dealer_character_id is null then interval '20 seconds' else interval '30 seconds' end),
    last_action_at = now() where id = p_table;
  perform public.bj_system(p_table, public.rl_char_name(p_character) || ' ' || p_amount || '칩 베팅', 'system', jsonb_build_object('event', 'bet'));
  if t.dealer_character_id is null and not exists (select 1 from public.bj_seats where table_id = p_table and state = 'idle' and character_id is not null) then
    perform public.bj_deal(p_table);
  end if;
  return v_bal - p_amount;
end $$;

-- 다음 자리. 손님이 다 끝나면: 딜러가 있으면 '딜러 차례'(turn_seat = -1), 없으면 바로 정산
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
      if t.dealer_character_id is not null then
        update public.bj_tables set turn_seat = -1, last_action_at = now() where id = p_table;
        perform public.bj_system(p_table, '딜러 차례', 'system', jsonb_build_object('event', 'dealer'));
      else
        perform public.bj_settle(p_table);
      end if;
      return;
    end if;
    update public.bj_tables set turn_seat = v_next, last_action_at = now() where id = p_table;
    select * into s from public.bj_seats where table_id = p_table and seat = v_next;
    if s.character_id is not null then return; end if;
    v_cards := s.cards;
    while public.bj_total(v_cards) < 17 loop v_cards := v_cards || public.bj_draw(p_table); end loop;
    v_t := public.bj_total(v_cards);
    update public.bj_seats set cards = v_cards, state = case when v_t > 21 then 'bust' else 'stood' end where table_id = p_table and seat = v_next;
    if v_t > 21 and not t.hide_cards then
      perform public.bj_system(p_table, public.bj_seat_name(p_table, v_next) || ' ' || v_t || ' 버스트', 'system', jsonb_build_object('event', 'bust', 'seat', v_next));
    end if;
  end loop;
end $$;

-- 손님 행동: 가린 테이블이면 합계·버스트를 채팅에 쓰지 않음
create or replace function public.bj_hit(p_table uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare s public.bj_seats; v_cards integer[]; v_t integer; v_hide boolean;
begin
  s := public.bj_my_turn(p_table);
  select hide_cards into v_hide from public.bj_tables where id = p_table;
  v_cards := s.cards || public.bj_draw(p_table);
  v_t := public.bj_total(v_cards);
  update public.bj_seats set cards = v_cards, state = case when v_t > 21 then 'bust' when v_t = 21 then 'stood' else 'playing' end
   where table_id = p_table and seat = s.seat;
  update public.bj_tables set last_action_at = now() where id = p_table;
  if v_t > 21 and not v_hide then perform public.bj_system(p_table, public.rl_char_name(s.character_id) || ' ' || v_t || ' 버스트', 'system', jsonb_build_object('event', 'bust', 'seat', s.seat)); end if;
  if v_t >= 21 then perform public.bj_advance(p_table); end if;
  return v_t;
end $$;

create or replace function public.bj_double(p_table uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare s public.bj_seats; t record; v_cards integer[]; v_t integer; v_bal integer;
begin
  s := public.bj_my_turn(p_table);
  select * into t from public.bj_tables where id = p_table;
  if array_length(s.cards, 1) <> 2 then raise exception '처음 두 장일 때만 두 배로 걸 수 있습니다'; end if;
  v_bal := public.chip_balance_locked(s.character_id, t.currency);
  if v_bal < s.bet then raise exception '%이 부족합니다 (보유 %, 필요 %)', public.chip_name(t.currency), v_bal, s.bet; end if;
  perform public.chip_add(s.character_id, -s.bet, 'game', '블랙잭 두 배 걸기 — ' || t.title, p_table, t.currency);
  v_cards := s.cards || public.bj_draw(p_table);
  v_t := public.bj_total(v_cards);
  update public.bj_seats set cards = v_cards, bet = bet * 2, doubled = true, state = case when v_t > 21 then 'bust' else 'stood' end
   where table_id = p_table and seat = s.seat;
  perform public.bj_system(p_table, public.rl_char_name(s.character_id) || ' 두 배 걸기' ||
    case when t.hide_cards then '' else ' → ' || v_t || case when v_t > 21 then ' 버스트' else '' end end,
    'system', jsonb_build_object('event', 'double', 'seat', s.seat));
  perform public.bj_advance(p_table);
  return v_t;
end $$;

-- 딜러: 카드 나누기 / 딜러 카드 펼치기
create or replace function public.bj_dealer_deal(p_table uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if not public.bj_dealer_ctl(p_table) then raise exception '딜러만 할 수 있습니다' using errcode = '42501'; end if;
  select * into t from public.bj_tables where id = p_table for update;
  if not found or t.status <> 'open' then raise exception '닫힌 테이블입니다'; end if;
  if t.phase <> 'betting' then raise exception '이번 판이 끝난 뒤에 나눌 수 있습니다'; end if;
  if not exists (select 1 from public.bj_seats where table_id = p_table and (state = 'bet' or character_id is null)) then
    raise exception '베팅한 자리가 없습니다';
  end if;
  perform public.bj_deal(p_table);
end $$;

create or replace function public.bj_dealer_play(p_table uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if not public.bj_dealer_ctl(p_table) then raise exception '딜러만 할 수 있습니다' using errcode = '42501'; end if;
  select * into t from public.bj_tables where id = p_table for update;
  if t.phase <> 'playing' or t.turn_seat is distinct from -1 then raise exception '아직 딜러 차례가 아닙니다'; end if;
  perform public.bj_settle(p_table);
end $$;

-- 시간 확인: 딜러 차례 30초가 지나면 자동으로 펼침
create or replace function public.bj_tick(p_table uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if auth.uid() is null then return false; end if;
  select * into t from public.bj_tables where id = p_table for update;
  if not found or t.status <> 'open' then return false; end if;
  if t.phase = 'betting' and t.bet_deadline is not null and t.bet_deadline <= now() then
    perform public.bj_deal(p_table);
    return true;
  end if;
  if t.phase = 'playing' and t.turn_seat = -1 and t.last_action_at <= now() - interval '30 seconds' then
    perform public.bj_settle(p_table);
    return true;
  end if;
  if t.phase = 'playing' and t.turn_seat >= 0 and t.last_action_at <= now() - interval '30 seconds' then
    update public.bj_seats set state = 'stood' where table_id = p_table and seat = t.turn_seat and state = 'playing';
    perform public.bj_system(p_table, '시간 초과 — ' || coalesce(public.bj_seat_name(p_table, t.turn_seat), '') || ' 자동으로 멈춤');
    perform public.bj_advance(p_table);
    return true;
  end if;
  return false;
end $$;

-- 관리자: 만들기 (카드 가리기 · 딜러 캐릭터), 딜러 바꾸기
drop function if exists public.admin_bj_create(text, text, integer, integer, integer, integer);
create or replace function public.admin_bj_create(p_title text, p_currency text default 'blue', p_min integer default 10, p_max integer default 500,
  p_seats integer default 5, p_rounds integer default 10, p_hide boolean default false, p_dealer uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  if p_currency not in ('blue', 'pink') then raise exception '칩 종류가 올바르지 않습니다'; end if;
  if p_min is null or p_min < 1 or p_max is null or p_max < p_min then raise exception '최소·최대 베팅을 확인해 주세요'; end if;
  if p_seats is null or p_seats < 1 or p_seats > 6 then raise exception '자리는 1~6개입니다'; end if;
  if p_rounds is null or p_rounds < 1 or p_rounds > 100 then raise exception '판 수는 1~100입니다'; end if;
  if p_dealer is not null and not exists (select 1 from public.characters where id = p_dealer and kind = 'dealer') then
    raise exception '딜러는 직원 캐릭터만 앉을 수 있습니다';
  end if;
  insert into public.bj_tables (title, currency, min_bet, max_bet, max_seats, max_rounds, hide_cards, dealer_character_id)
  values (coalesce(nullif(left(trim(p_title), 40), ''), '블랙잭'), p_currency, p_min, p_max, p_seats, p_rounds, coalesce(p_hide, false), p_dealer)
  returning id into v_id;
  perform public.bj_system(v_id, '테이블이 열렸습니다. ' || p_rounds || '판' ||
    case when p_dealer is not null then ' · 딜러 ' || public.rl_char_name(p_dealer) else '' end ||
    case when p_hide then ' · 남의 카드는 정산 때 공개' else '' end);
  return v_id;
end $$;

create or replace function public.admin_bj_set_dealer(p_table uuid, p_dealer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  select * into t from public.bj_tables where id = p_table for update;
  if not found or t.status <> 'open' then raise exception '닫힌 테이블입니다'; end if;
  if t.phase <> 'betting' then raise exception '판이 끝난 뒤에 바꿀 수 있습니다'; end if;
  if p_dealer is not null and not exists (select 1 from public.characters where id = p_dealer and kind = 'dealer') then
    raise exception '딜러는 직원 캐릭터만 앉을 수 있습니다';
  end if;
  if p_dealer is not null and exists (select 1 from public.bj_seats where table_id = p_table and character_id = p_dealer) then
    raise exception '손님 자리에 앉아 있는 캐릭터입니다';
  end if;
  update public.bj_tables set dealer_character_id = p_dealer, last_action_at = now() where id = p_table;
  perform public.bj_system(p_table, case when p_dealer is null then '딜러가 자리를 떠났습니다. 컴퓨터가 진행합니다.' else public.rl_char_name(p_dealer) || ' 님이 딜러 자리에 앉았습니다.' end);
end $$;

-- 더미 앉히기·자리 비우기도 테이블 줄을 건드려 실시간 반영
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
  update public.bj_tables set last_action_at = now() where id = p_table;
  perform public.bj_system(p_table, v_name || '(더미)가 앉았습니다.');
  return v_seat;
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
  update public.bj_tables set last_action_at = now() where id = p_table;
  perform public.bj_system(p_table, v_name || ' 님의 자리를 비웠습니다.');
  if t.phase = 'playing' and t.turn_seat = p_seat then perform public.bj_advance(p_table);
  elsif t.phase = 'playing' and not exists (select 1 from public.bj_seats where table_id = p_table and state = 'playing') then perform public.bj_settle(p_table);
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['bj_dealer_ctl(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['bj_view(uuid)', 'bj_lobby()'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
  foreach f in array array['bj_join(uuid, uuid)', 'bj_leave(uuid, uuid)', 'bj_bet(uuid, uuid, integer)', 'bj_hit(uuid)', 'bj_double(uuid)', 'bj_tick(uuid)',
    'bj_dealer_deal(uuid)', 'bj_dealer_play(uuid)', 'admin_bj_create(text, text, integer, integer, integer, integer, boolean, uuid)', 'admin_bj_set_dealer(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['bj_advance(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

commit;

select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'bj_tables' and column_name in ('hide_cards', 'dealer_character_id')) as cols,
       has_table_privilege('anon', 'public.bj_seats', 'select') as anon_can_read_seats,
       (select count(*) from pg_proc where proname in ('bj_view', 'bj_lobby', 'bj_dealer_deal', 'bj_dealer_play', 'admin_bj_set_dealer')) as funcs;
