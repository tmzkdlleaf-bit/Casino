-- =====================================================================
--  update-13 : 블랙잭 (방에서 여럿이, 딜러는 컴퓨터)
--   규칙: 카드 6벌 · 카드 더 받기 / 멈추기 / 두 배 걸기(처음 두 장일 때) · 블랙잭은 1.5배
--         딜러는 17 이상에서 멈춤 · 딜러 첫 카드가 A나 10이면 블랙잭인지 먼저 확인
--   흐름: 앉기 → 베팅(첫 베팅 뒤 20초, 또는 모두 걸면 바로) → 카드 배분 → 자리 순서대로 진행
--         (차례당 30초, 넘기면 자동 멈추기) → 딜러 → 정산 → 다음 판 베팅
--   카드 더미와 딜러의 엎어 둔 카드는 비공개 표(bj_secrets)에만 있어 아무도 볼 수 없음
--   카드 번호: 0~51. 숫자 = 번호 % 13 (0=A, 1~9=2~10, 10=J, 11=Q, 12=K), 무늬 = 번호 / 13
--   update-12 다음에 한 번 실행. 여러 번 실행해도 안전합니다.
-- =====================================================================
begin;

-- 1. 표 ---------------------------------------------------------------
create table if not exists public.bj_tables (
  id             uuid primary key default gen_random_uuid(),
  title          text not null default '블랙잭',
  currency       text not null default 'blue' check (currency in ('blue', 'pink')),
  min_bet        integer not null default 10 check (min_bet >= 1),
  max_bet        integer not null default 500,
  max_seats      integer not null default 5 check (max_seats between 1 and 6),
  status         text not null default 'open' check (status in ('open', 'closed')),
  phase          text not null default 'betting' check (phase in ('betting', 'playing')),
  round          integer not null default 0,
  turn_seat      integer,
  dealer_cards   integer[] not null default '{}',
  bet_deadline   timestamptz,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  last_action_at timestamptz not null default now(),
  check (max_bet >= min_bet)
);
create table if not exists public.bj_secrets (
  table_id uuid primary key references public.bj_tables(id) on delete cascade,
  shoe     integer[] not null default '{}',
  hole     integer
);
create table if not exists public.bj_seats (
  table_id     uuid not null references public.bj_tables(id) on delete cascade,
  seat         integer not null,
  character_id uuid not null references public.characters(id) on delete cascade,
  bet          integer not null default 0,
  cards        integer[] not null default '{}',
  state        text not null default 'idle' check (state in ('idle', 'bet', 'playing', 'stood', 'bust', 'blackjack')),
  doubled      boolean not null default false,
  result       text check (result in ('win', 'lose', 'push', 'blackjack')),
  payout       integer not null default 0,
  joined_at    timestamptz not null default now(),
  primary key (table_id, seat),
  unique (table_id, character_id)
);
create table if not exists public.bj_chat (
  id         bigint generated always as identity primary key,
  table_id   uuid not null references public.bj_tables(id) on delete cascade,
  user_id    uuid,
  name       text not null default '',
  body       text not null default '',
  kind       text not null default 'chat' check (kind in ('chat', 'system', 'result')),
  data       jsonb,
  created_at timestamptz not null default now()
);
create index if not exists bj_chat_table_idx on public.bj_chat (table_id, id);

do $$
declare t text; p record;
begin
  foreach t in array array['bj_tables', 'bj_seats', 'bj_chat', 'bj_secrets'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  foreach t in array array['bj_tables', 'bj_seats', 'bj_chat'] loop
    execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end $$;
grant delete on public.bj_tables to authenticated;
create policy "admin delete" on public.bj_tables for delete to authenticated using (public.is_admin() and status = 'closed');

-- 2. 카드 계산 ----------------------------------------------------------
create or replace function public.bj_value(p_card integer)
returns integer language sql immutable as $$
  select case when p_card % 13 = 0 then 11 when p_card % 13 >= 9 then 10 else p_card % 13 + 1 end;
$$;
-- 가장 좋은 합 (A는 11 또는 1)
create or replace function public.bj_total(p_cards integer[])
returns integer language plpgsql immutable as $$
declare t integer := 0; aces integer := 0; c integer;
begin
  foreach c in array coalesce(p_cards, '{}') loop
    t := t + public.bj_value(c);
    if c % 13 = 0 then aces := aces + 1; end if;
  end loop;
  while t > 21 and aces > 0 loop t := t - 10; aces := aces - 1; end loop;
  return t;
end $$;
create or replace function public.bj_is_blackjack(p_cards integer[])
returns boolean language sql immutable as $$
  select coalesce(array_length(p_cards, 1), 0) = 2 and public.bj_total(p_cards) = 21;
$$;
create or replace function public.bj_card_name(p_card integer)
returns text language sql immutable as $$
  select (array['♠', '♥', '♦', '♣'])[p_card / 13 + 1] ||
         (array['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'])[p_card % 13 + 1];
$$;

-- 3. 내부 도우미 (밖에서 못 부름) ----------------------------------------
create or replace function public.bj_system(p_table uuid, p_body text, p_kind text default 'system', p_data jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.bj_chat (table_id, name, body, kind, data) values (p_table, '', p_body, p_kind, p_data);
$$;

-- 카드 한 장 뽑기 (더미가 얼마 안 남았으면 6벌을 새로 섞음)
create or replace function public.bj_draw(p_table uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_shoe integer[]; v integer;
begin
  select shoe into v_shoe from public.bj_secrets where table_id = p_table for update;
  if v_shoe is null or coalesce(array_length(v_shoe, 1), 0) = 0 then
    select array_agg(c order by random()) into v_shoe from (select g % 52 as c from generate_series(0, 311) g) x;
    insert into public.bj_secrets (table_id, shoe) values (p_table, v_shoe)
    on conflict (table_id) do update set shoe = excluded.shoe;
  end if;
  v := v_shoe[1];
  update public.bj_secrets set shoe = v_shoe[2:] where table_id = p_table;
  return v;
end $$;

-- 다음에 진행할 자리 (자리 번호 순서). 없으면 딜러 차례 → 정산
create or replace function public.bj_advance(p_table uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t record; v_next integer;
begin
  select * into t from public.bj_tables where id = p_table;
  select seat into v_next from public.bj_seats where table_id = p_table and state = 'playing' and seat > coalesce(t.turn_seat, -1) order by seat limit 1;
  if v_next is null then
    select seat into v_next from public.bj_seats where table_id = p_table and state = 'playing' order by seat limit 1;
  end if;
  if v_next is not null then
    update public.bj_tables set turn_seat = v_next, last_action_at = now() where id = p_table;
  else
    perform public.bj_settle(p_table);
  end if;
end $$;

-- 딜러 진행 + 정산 → 다음 판 베팅으로
create or replace function public.bj_settle(p_table uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t record; s record; v_hole integer; v_dealer integer[]; v_dt integer; v_dbj boolean; v_pt integer;
  v_res text; v_pay integer; v_lines text[] := '{}';
begin
  select * into t from public.bj_tables where id = p_table for update;
  select hole into v_hole from public.bj_secrets where table_id = p_table;
  v_dealer := t.dealer_cards || v_hole;
  v_dbj := public.bj_is_blackjack(v_dealer);
  -- 아직 승부가 남은 손(멈춘 손)이 있을 때만 딜러가 카드를 더 받음
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
    if v_pay > 0 then
      perform public.chip_add(s.character_id, v_pay, 'game',
        case v_res when 'push' then '블랙잭 무승부 (돌려받음) — ' else '블랙잭 승리 — ' end || t.title, p_table, t.currency);
    end if;
    update public.bj_seats set result = v_res, payout = v_pay, state = 'idle' where table_id = p_table and seat = s.seat;
    v_lines := v_lines || (public.rl_char_name(s.character_id) || ' ' ||
      case v_res when 'blackjack' then '블랙잭! +' || (v_pay - s.bet) when 'win' then '승 +' || (v_pay - s.bet) when 'push' then '무승부' else '패 -' || s.bet end);
  end loop;
  update public.bj_seats set state = 'idle' where table_id = p_table and state <> 'idle';
  update public.bj_tables set dealer_cards = v_dealer, phase = 'betting', turn_seat = null, bet_deadline = null, last_action_at = now() where id = p_table;
  perform public.bj_system(p_table, '딜러 ' || case when v_dbj then '블랙잭' when v_dt > 21 then v_dt || ' 버스트' else v_dt::text end ||
    case when array_length(v_lines, 1) > 0 then ' · ' || array_to_string(v_lines, ' · ') else '' end,
    'result', jsonb_build_object('event', 'settle', 'dealer', v_dt, 'dealer_bj', v_dbj));
end $$;

-- 카드 나누기 (베팅한 자리만)
create or replace function public.bj_deal(p_table uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t record; s record; v_up integer; v_hole integer; v_dbj boolean; n integer;
begin
  select * into t from public.bj_tables where id = p_table for update;
  if t.phase <> 'betting' then return; end if;
  select count(*) into n from public.bj_seats where table_id = p_table and state = 'bet';
  if n = 0 then return; end if;
  -- 카드 더미가 60장 아래로 남았으면 새로 섞음
  update public.bj_secrets set shoe = '{}' where table_id = p_table and coalesce(array_length(shoe, 1), 0) < 60;
  -- 이번 판에 안 건 자리는 지난 판 카드를 치움
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
  -- 딜러 첫 카드가 A나 10점이면 블랙잭인지 먼저 확인 → 블랙잭이면 바로 정산
  v_dbj := public.bj_value(v_up) >= 10 and public.bj_is_blackjack(array[v_up, v_hole]);
  if v_dbj then
    update public.bj_seats set state = 'stood' where table_id = p_table and state = 'playing';
    perform public.bj_settle(p_table);
  else
    perform public.bj_advance(p_table);
  end if;
end $$;

-- 내 자리 찾기 (지금 차례인 내 캐릭터)
create or replace function public.bj_my_turn(p_table uuid)
returns public.bj_seats language plpgsql security definer set search_path = public as $$
declare t record; s public.bj_seats;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다' using errcode = '42501'; end if;
  select * into t from public.bj_tables where id = p_table for update;
  if not found then raise exception '테이블을 찾을 수 없습니다'; end if;
  if t.phase <> 'playing' or t.turn_seat is null then raise exception '지금은 카드를 진행할 때가 아닙니다'; end if;
  select bs.* into s from public.bj_seats bs where bs.table_id = p_table and bs.seat = t.turn_seat;
  if not public.rl_owns(s.character_id) then raise exception '내 차례가 아닙니다'; end if;
  if s.state <> 'playing' then raise exception '이미 끝난 손입니다'; end if;
  return s;
end $$;

-- 4. 멤버가 쓰는 함수 ----------------------------------------------------
create or replace function public.bj_join(p_table uuid, p_character uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare t record; v_seat integer;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다' using errcode = '42501'; end if;
  if not public.rl_owns(p_character) then raise exception '내 캐릭터로만 앉을 수 있습니다' using errcode = '42501'; end if;
  select * into t from public.bj_tables where id = p_table for update;
  if not found or t.status <> 'open' then raise exception '닫힌 테이블입니다'; end if;
  if exists (select 1 from public.bj_seats s join public.characters c on c.id = s.character_id where s.table_id = p_table and c.owner_id = auth.uid()) then
    raise exception '이미 이 테이블에 앉아 있습니다';
  end if;
  select min(g) into v_seat from generate_series(0, t.max_seats - 1) g
   where not exists (select 1 from public.bj_seats where table_id = p_table and seat = g);
  if v_seat is null then raise exception '자리가 다 찼습니다'; end if;
  insert into public.bj_seats (table_id, seat, character_id) values (p_table, v_seat, p_character);
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
  perform public.bj_system(p_table, public.rl_char_name(p_character) || ' 님이 일어났습니다.');
end $$;

-- 베팅: 다음 판에 걸기. 모두 걸면 바로, 아니면 첫 베팅 20초 뒤 카드를 나눔
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
  if not exists (select 1 from public.bj_seats where table_id = p_table and state = 'idle') then
    perform public.bj_deal(p_table);
  end if;
  return v_bal - p_amount;
end $$;

create or replace function public.bj_hit(p_table uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare s public.bj_seats; v_cards integer[]; v_t integer;
begin
  s := public.bj_my_turn(p_table);
  v_cards := s.cards || public.bj_draw(p_table);
  v_t := public.bj_total(v_cards);
  update public.bj_seats set cards = v_cards, state = case when v_t > 21 then 'bust' when v_t = 21 then 'stood' else 'playing' end
   where table_id = p_table and seat = s.seat;
  update public.bj_tables set last_action_at = now() where id = p_table;
  if v_t > 21 then perform public.bj_system(p_table, public.rl_char_name(s.character_id) || ' ' || v_t || ' 버스트', 'system', jsonb_build_object('event', 'bust', 'seat', s.seat)); end if;
  if v_t >= 21 then perform public.bj_advance(p_table); end if;
  return v_t;
end $$;

create or replace function public.bj_stand(p_table uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.bj_seats;
begin
  s := public.bj_my_turn(p_table);
  update public.bj_seats set state = 'stood' where table_id = p_table and seat = s.seat;
  perform public.bj_advance(p_table);
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
  perform public.bj_system(p_table, public.rl_char_name(s.character_id) || ' 두 배 걸기 → ' || v_t || case when v_t > 21 then ' 버스트' else '' end,
    'system', jsonb_build_object('event', 'double', 'seat', s.seat));
  perform public.bj_advance(p_table);
  return v_t;
end $$;

-- 시간 확인: 보고 있는 사람 아무나 부름. 차례 30초 넘기면 자동 멈추기, 베팅 마감 시간이 지나면 카드 배분
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
  if t.phase = 'playing' and t.turn_seat is not null and t.last_action_at <= now() - interval '30 seconds' then
    update public.bj_seats set state = 'stood' where table_id = p_table and seat = t.turn_seat and state = 'playing';
    perform public.bj_system(p_table, '시간 초과 — ' || coalesce((select public.rl_char_name(character_id) from public.bj_seats where table_id = p_table and seat = t.turn_seat), '') || ' 자동으로 멈춤');
    perform public.bj_advance(p_table);
    return true;
  end if;
  return false;
end $$;

create or replace function public.bj_say(p_table uuid, p_body text, p_character uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_body text := left(trim(coalesce(p_body, '')), 300);
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다' using errcode = '42501'; end if;
  if v_body = '' then raise exception '내용을 입력해 주세요'; end if;
  if not exists (select 1 from public.bj_tables where id = p_table) then raise exception '테이블을 찾을 수 없습니다'; end if;
  if p_character is not null and public.rl_owns(p_character) then v_name := public.rl_char_name(p_character);
  elsif public.is_admin() then v_name := coalesce((select nullif(display_name, '') from public.profiles where id = auth.uid()), '관리자');
  elsif exists (select 1 from public.characters where owner_id = auth.uid()) then
    v_name := (select name from public.characters where owner_id = auth.uid() order by sort_order limit 1);
  else raise exception '캐릭터가 연결된 멤버만 채팅할 수 있습니다' using errcode = '42501'; end if;
  if exists (select 1 from public.bj_chat where table_id = p_table and user_id = auth.uid() and created_at > now() - interval '700 milliseconds') then
    raise exception '너무 빨라요. 잠시 후 다시 보내 주세요'; end if;
  if (select count(*) from public.bj_chat where table_id = p_table and user_id = auth.uid() and kind = 'chat' and created_at > now() - interval '10 seconds') >= 5 then
    raise exception '채팅이 너무 많아요. 몇 초 뒤에 보내 주세요'; end if;
  insert into public.bj_chat (table_id, user_id, name, body, kind) values (p_table, auth.uid(), v_name, v_body, 'chat');
end $$;

-- 5. 관리자 ------------------------------------------------------------
create or replace function public.admin_bj_create(p_title text, p_currency text default 'blue', p_min integer default 10, p_max integer default 500, p_seats integer default 5)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  if p_currency not in ('blue', 'pink') then raise exception '칩 종류가 올바르지 않습니다'; end if;
  if p_min is null or p_min < 1 or p_max is null or p_max < p_min then raise exception '최소·최대 베팅을 확인해 주세요'; end if;
  if p_seats is null or p_seats < 1 or p_seats > 6 then raise exception '자리는 1~6개입니다'; end if;
  insert into public.bj_tables (title, currency, min_bet, max_bet, max_seats)
  values (coalesce(nullif(left(trim(p_title), 40), ''), '블랙잭'), p_currency, p_min, p_max, p_seats) returning id into v_id;
  perform public.bj_system(v_id, '테이블이 열렸습니다. 자리에 앉아 베팅해 주세요.');
  return v_id;
end $$;

-- 닫기: 진행 중인 판은 건 칩을 모두 돌려줌
create or replace function public.admin_bj_close(p_table uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t record; s record;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  select * into t from public.bj_tables where id = p_table for update;
  if not found or t.status = 'closed' then return; end if;
  for s in select * from public.bj_seats where table_id = p_table and state <> 'idle' and bet > 0 loop
    perform public.chip_add(s.character_id, s.bet, 'game', '블랙잭 테이블 닫힘 — 베팅 환불', p_table, t.currency);
  end loop;
  update public.bj_seats set state = 'idle', bet = 0 where table_id = p_table;
  update public.bj_tables set status = 'closed', phase = 'betting', turn_seat = null, bet_deadline = null, last_action_at = now() where id = p_table;
  delete from public.bj_secrets where table_id = p_table;
  perform public.bj_system(p_table, '테이블이 닫혔습니다. 진행 중이던 베팅은 돌려드렸습니다.');
end $$;

-- 자리 비우기 (자리를 오래 비운 사람). 판 진행 중인 손은 칩을 돌려주고 뺌
create or replace function public.admin_bj_kick(p_table uuid, p_seat integer)
returns void language plpgsql security definer set search_path = public as $$
declare t record; s record;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  select * into t from public.bj_tables where id = p_table for update;
  select * into s from public.bj_seats where table_id = p_table and seat = p_seat;
  if not found then return; end if;
  if s.state <> 'idle' and s.bet > 0 then
    perform public.chip_add(s.character_id, s.bet, 'game', '블랙잭 — 관리자가 자리를 비워 베팅 환불', p_table, t.currency);
  end if;
  delete from public.bj_seats where table_id = p_table and seat = p_seat;
  perform public.bj_system(p_table, public.rl_char_name(s.character_id) || ' 님의 자리를 비웠습니다.');
  if t.phase = 'playing' and t.turn_seat = p_seat then perform public.bj_advance(p_table);
  elsif t.phase = 'playing' and not exists (select 1 from public.bj_seats where table_id = p_table and state = 'playing') then perform public.bj_settle(p_table);
  end if;
end $$;

-- 6. 권한 --------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['bj_system(uuid, text, text, jsonb)', 'bj_draw(uuid)', 'bj_advance(uuid)', 'bj_settle(uuid)', 'bj_deal(uuid)', 'bj_my_turn(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['bj_join(uuid, uuid)', 'bj_leave(uuid, uuid)', 'bj_bet(uuid, uuid, integer)', 'bj_hit(uuid)', 'bj_stand(uuid)', 'bj_double(uuid)',
    'bj_tick(uuid)', 'bj_say(uuid, text, uuid)', 'admin_bj_create(text, text, integer, integer, integer)', 'admin_bj_close(uuid)', 'admin_bj_kick(uuid, integer)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- 7. 실시간 반영 ----------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['bj_tables', 'bj_seats', 'bj_chat'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

commit;

-- 확인
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('bj_tables', 'bj_seats', 'bj_chat', 'bj_secrets')) as tables,
       (select count(*) from pg_proc where proname like 'bj\_%' or proname like 'admin\_bj\_%') as funcs;
