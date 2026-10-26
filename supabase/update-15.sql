-- =====================================================================
--  update-15 : 블랙잭 판 수 — 정한 판 수가 끝나면 자동으로 닫히고 최종 결과·전적 기록
--   · 테이블마다 max_rounds (기본 10판). 마지막 판 정산이 끝나면 닫힘
--   · 관리자가 일찍 닫아도 그때까지의 결과를 같은 방식으로 정리
--   · 최종 결과: 캐릭터별 이번 게임 칩 득실 (더미 제외), 게임 화면 전적에 '블랙잭'으로 남김
--   update-14 다음에 한 번 실행. 여러 번 실행해도 안전합니다.
-- =====================================================================
begin;

alter table public.bj_tables add column if not exists max_rounds integer not null default 10;
alter table public.bj_tables add column if not exists ended_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bj_tables_rounds_chk') then
    alter table public.bj_tables add constraint bj_tables_rounds_chk check (max_rounds between 1 and 100);
  end if;
end $$;

-- 이번 게임 결과: 캐릭터별 칩 득실 (이 테이블에서 오간 칩 기록 합계)
create or replace function public.bj_results(p_table uuid)
returns table (character_id uuid, name text, net integer)
language sql stable security definer set search_path = public as $$
  select l.character_id, public.rl_char_name(l.character_id), sum(l.amount)::integer
    from public.chip_ledger l
   where l.ref_id = p_table and l.reason = 'game' and l.memo like '블랙잭%'
   group by l.character_id
   order by sum(l.amount) desc, public.rl_char_name(l.character_id);
$$;
revoke all on function public.bj_results(uuid) from public;
grant execute on function public.bj_results(uuid) to anon, authenticated;

-- 게임 끝: 닫고, 결과를 채팅과 전적에 남김
create or replace function public.bj_finish(p_table uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t record; v_ids uuid[]; v_top record; v_lines text;
begin
  select * into t from public.bj_tables where id = p_table for update;
  update public.bj_tables set status = 'closed', phase = 'betting', turn_seat = null, bet_deadline = null, ended_at = now(), last_action_at = now() where id = p_table;
  delete from public.bj_secrets where table_id = p_table;
  select array_agg(r.character_id), string_agg(r.name || ' ' || case when r.net > 0 then '+' else '' end || r.net, ' · ' order by r.net desc)
    into v_ids, v_lines from public.bj_results(p_table) r;
  select * into v_top from public.bj_results(p_table) r limit 1;
  perform public.bj_system(p_table, coalesce(p_reason, '게임 끝!') || ' ' || t.round || '판 · 최종 ' || coalesce(v_lines, '참가자 없음'),
    'result', jsonb_build_object('event', 'finish'));
  if v_ids is not null and t.round > 0 and to_regclass('public.game_records') is not null then
    execute 'insert into public.game_records (played_at, game_name, winner_id, participant_ids, chips, note) values (now(), $1, $2, $3, $4, $5)'
      using '블랙잭', case when v_top.net > 0 then v_top.character_id end, v_ids, greatest(coalesce(v_top.net, 0), 0),
            left(t.title || ' · ' || t.round || '판' || case when t.currency = 'pink' then ' · 핑크 칩' else '' end, 120);
  end if;
end $$;
revoke all on function public.bj_finish(uuid, text) from public, anon, authenticated;

-- 정산 끝에 '마지막 판이었으면 게임 끝'
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
  perform public.bj_system(p_table, t.round || '/' || t.max_rounds || '판 · 딜러 ' || case when v_dbj then '블랙잭' when v_dt > 21 then v_dt || ' 버스트' else v_dt::text end ||
    case when array_length(v_lines, 1) > 0 then ' · ' || array_to_string(v_lines, ' · ') else '' end,
    'result', jsonb_build_object('event', 'settle', 'dealer', v_dt, 'dealer_bj', v_dbj));
  if t.round >= t.max_rounds then perform public.bj_finish(p_table); end if;
end $$;

-- 만들 때 판 수
drop function if exists public.admin_bj_create(text, text, integer, integer, integer);
create or replace function public.admin_bj_create(p_title text, p_currency text default 'blue', p_min integer default 10, p_max integer default 500, p_seats integer default 5, p_rounds integer default 10)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  if p_currency not in ('blue', 'pink') then raise exception '칩 종류가 올바르지 않습니다'; end if;
  if p_min is null or p_min < 1 or p_max is null or p_max < p_min then raise exception '최소·최대 베팅을 확인해 주세요'; end if;
  if p_seats is null or p_seats < 1 or p_seats > 6 then raise exception '자리는 1~6개입니다'; end if;
  if p_rounds is null or p_rounds < 1 or p_rounds > 100 then raise exception '판 수는 1~100입니다'; end if;
  insert into public.bj_tables (title, currency, min_bet, max_bet, max_seats, max_rounds)
  values (coalesce(nullif(left(trim(p_title), 40), ''), '블랙잭'), p_currency, p_min, p_max, p_seats, p_rounds) returning id into v_id;
  perform public.bj_system(v_id, '테이블이 열렸습니다. ' || p_rounds || '판을 합니다. 자리에 앉아 베팅해 주세요.');
  return v_id;
end $$;
revoke all on function public.admin_bj_create(text, text, integer, integer, integer, integer) from public, anon;
grant execute on function public.admin_bj_create(text, text, integer, integer, integer, integer) to authenticated;

-- 관리자가 일찍 닫기: 진행 중인 판은 돌려주고, 그때까지의 결과로 마무리
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
  update public.bj_seats set state = 'idle', bet = 0 where table_id = p_table and state <> 'idle';
  perform public.bj_finish(p_table, '관리자가 테이블을 닫았습니다. 진행 중이던 베팅은 돌려드렸습니다.');
end $$;

revoke all on function public.bj_settle(uuid) from public, anon, authenticated;

commit;

select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'bj_tables' and column_name in ('max_rounds', 'ended_at')) as cols,
       (select count(*) from pg_proc where proname in ('bj_results', 'bj_finish')) as funcs;
