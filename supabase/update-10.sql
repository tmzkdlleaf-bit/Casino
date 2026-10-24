-- =========================================================
-- update-10 : 룰렛 차례 60초 제한 · 채팅 도배 제한 · 룰렛 전적
--   update-9 다음에 한 번 실행. 여러 번 실행해도 안전합니다.
-- =========================================================

-- 1) 차례 시간 초과: 마지막 행동 후 60초가 지나면 누구든(방을 보고 있는 사람의 화면이) 호출해 다음 차례로 넘김
create or replace function public.roulette_timeout(p_room uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare rm record; v_next integer;
begin
  if auth.uid() is null then return false; end if;
  select * into rm from public.roulette_rooms where id = p_room for update;
  if not found or rm.status <> 'playing' or rm.turn_seat is null then return false; end if;
  if rm.last_action_at > now() - interval '60 seconds' then return false; end if;
  v_next := public.rl_next_seat(p_room, rm.turn_seat);
  update public.roulette_rooms set turn_seat = v_next, self_survived = false, last_action_at = now() where id = p_room;
  perform public.rl_system(p_room, '시간 초과 — ' || public.rl_seat_name(p_room, rm.turn_seat) || ' → ' || public.rl_seat_name(p_room, v_next),
    'system', jsonb_build_object('event', 'turn', 'timeout', true));
  return true;
end $$;
revoke all on function public.roulette_timeout(uuid) from public, anon;
grant execute on function public.roulette_timeout(uuid) to authenticated;

-- 2) 채팅 도배 제한: 0.7초 간격 + 10초에 5개까지
create or replace function public.roulette_say(p_room uuid, p_body text, p_character uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_body text := left(trim(coalesce(p_body, '')), 300);
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다' using errcode = '42501'; end if;
  if v_body = '' then raise exception '내용을 입력해 주세요'; end if;
  if not exists (select 1 from public.roulette_rooms where id = p_room) then raise exception '방을 찾을 수 없습니다'; end if;
  if p_character is not null and public.rl_owns(p_character) then
    v_name := public.rl_char_name(p_character);
  elsif public.is_admin() then
    v_name := coalesce((select nullif(display_name, '') from public.profiles where id = auth.uid()), '관리자');
  elsif exists (select 1 from public.characters where owner_id = auth.uid()) then
    v_name := (select name from public.characters where owner_id = auth.uid() order by sort_order limit 1);
  else
    raise exception '캐릭터가 연결된 멤버만 채팅할 수 있습니다' using errcode = '42501';
  end if;
  if exists (select 1 from public.roulette_chat where room_id = p_room and user_id = auth.uid() and created_at > now() - interval '700 milliseconds') then
    raise exception '너무 빨라요. 잠시 후 다시 보내 주세요';
  end if;
  if (select count(*) from public.roulette_chat where room_id = p_room and user_id = auth.uid() and kind = 'chat' and created_at > now() - interval '10 seconds') >= 5 then
    raise exception '채팅이 너무 많아요. 몇 초 뒤에 보내 주세요';
  end if;
  insert into public.roulette_chat (room_id, user_id, name, body, kind) values (p_room, auth.uid(), v_name, v_body, 'chat');
end $$;

-- 3) 룰렛 전적: 캐릭터별 판 수 · 우승 · 룰렛으로 늘거나 준 칩 (더미 제외)
create or replace function public.roulette_stats()
returns table (character_id uuid, name text, played integer, wins integer, net integer)
language sql stable security definer set search_path = public as $$
  with g as (
    select c.id, c.name,
      (select count(*) from public.game_records r where r.game_name = '러시안 룰렛' and c.id = any(r.participant_ids))::int as played,
      (select count(*) from public.game_records r where r.game_name = '러시안 룰렛' and r.winner_id = c.id)::int as wins,
      (select coalesce(sum(l.amount), 0) from public.chip_ledger l where l.character_id = c.id and l.reason = 'game' and l.memo like '%룰렛%')::int as net
    from public.characters c
  )
  select id, name, played, wins, net from g where played > 0
  order by wins desc, net desc, played desc, name;
$$;
revoke all on function public.roulette_stats() from public;
grant execute on function public.roulette_stats() to anon, authenticated;

-- 확인
select
  (select count(*) from pg_proc where proname in ('roulette_timeout', 'roulette_stats')) as new_funcs,
  (select prosrc like '%10 seconds%' from pg_proc where proname = 'roulette_say') as say_limit;
