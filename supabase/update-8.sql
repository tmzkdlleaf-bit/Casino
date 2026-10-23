-- =====================================================================
--  update-8: 러시안 룰렛 (update-7.sql 다음에 실행)
--  Supabase 대시보드 > SQL Editor 에 전체를 붙여 넣고 Run 한 번.
--  여러 번 실행해도 안전합니다. 중간에 오류가 나면 전부 취소됩니다.
--
--  규칙
--   - 방은 관리자만 엽니다. 멤버는 자기 캐릭터로 자리에 앉습니다 (2~8자리)
--   - 6칸 탄창에 1발. 몇 번째 칸인지는 서버만 압니다 (화면·개발자 도구로도 볼 수 없음)
--   - 내 차례: 쏘기(나 또는 다른 사람) / 넘기기
--       나에게 쏴서 빈 칸이면 → 다시 내 차례
--       다른 사람에게 쏘거나, 맞으면 → 다음 사람 차례
--       넘기기: 방 설정에 따라 '나에게 한 번 쏘고 살아남은 뒤에만' 또는 '언제든'
--   - 한 발이 나가면 탄창을 다시 채웁니다 (새 위치, 1발). 마지막 한 명이 남으면 끝
--   - 돈: ① 참가비 — 시작할 때 자리마다 걷어 판돈으로, 우승자가 전부 가져감
--         ② 생존자 베팅 — 누구나(자기 캐릭터로) 끝까지 살아남을 사람에게 걸 수 있음
--            게임 시작 뒤 ~ 첫 탈락자가 나오기 전까지만. 맞힌 사람들이 건 돈 전체를 건 비율대로 나눠 가짐
--            아무도 못 맞히면 전부 돌려줌
--   - 관리자가 게임을 취소하면 참가비와 베팅을 모두 돌려줌
--   - 끝나면 전적(game_records, update-5.sql)에 자동 기록
--
--  만드는 것
--   표   roulette_rooms · roulette_seats · roulette_bets · roulette_chat · roulette_avatars
--        roulette_secrets (탄 위치 — 아무도 직접 읽을 수 없음)
--   저장소 버킷 roulette (자리에 보일 이미지. 캐릭터 주인 또는 관리자가 올림)
--   실시간 반영: 위 표 4개 (rooms, seats, bets, chat)
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. 표
-- ---------------------------------------------------------------------
create table if not exists public.roulette_rooms (
  id             uuid primary key default gen_random_uuid(),
  title          text not null default '러시안 룰렛',
  status         text not null default 'waiting' check (status in ('waiting','playing','finished','cancelled')),
  max_seats      integer not null default 6 check (max_seats between 2 and 8),
  entry_fee      integer not null default 0 check (entry_fee >= 0),
  pass_rule      text not null default 'after_self' check (pass_rule in ('after_self','free')),
  pot            integer not null default 0,
  turn_seat      integer,
  shots          integer not null default 0,      -- 지금 탄창에서 쏜 횟수 (6칸)
  round          integer not null default 1,      -- 몇 번째 탄창인지
  self_survived  boolean not null default false,  -- 이번 차례에 나에게 쏴서 살아남았는지 (넘기기 조건)
  winner_seat    integer,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  ended_at       timestamptz,
  last_action_at timestamptz not null default now()
);
create index if not exists roulette_rooms_created_idx on public.roulette_rooms (created_at desc);

create table if not exists public.roulette_seats (
  room_id      uuid not null references public.roulette_rooms(id) on delete cascade,
  seat         integer not null check (seat between 0 and 7),
  character_id uuid not null references public.characters(id) on delete cascade,
  alive        boolean not null default true,
  joined_at    timestamptz not null default now(),
  out_at       timestamptz,
  primary key (room_id, seat),
  unique (room_id, character_id)
);

create table if not exists public.roulette_secrets (
  room_id uuid primary key references public.roulette_rooms(id) on delete cascade,
  bullet  integer not null check (bullet between 1 and 6)
);

create table if not exists public.roulette_bets (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.roulette_rooms(id) on delete cascade,
  seat         integer not null,
  character_id uuid not null references public.characters(id) on delete cascade,   -- 건 사람(캐릭터)
  amount       integer not null check (amount > 0),
  payout       integer,                                                           -- 끝난 뒤 받은 칩 (0 = 못 맞힘)
  created_at   timestamptz not null default now()
);
create index if not exists roulette_bets_room_idx on public.roulette_bets (room_id);

create table if not exists public.roulette_chat (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.roulette_rooms(id) on delete cascade,
  user_id    uuid,
  name       text not null default '',
  body       text not null default '',
  kind       text not null default 'chat' check (kind in ('chat','system','shot')),
  data       jsonb,
  created_at timestamptz not null default now()
);
create index if not exists roulette_chat_room_idx on public.roulette_chat (room_id, id desc);

create table if not exists public.roulette_avatars (
  character_id uuid primary key references public.characters(id) on delete cascade,
  path         text not null,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. 권한 — 누구나 읽기(구경 가능), 쓰기는 아래 함수로만. 탄 위치 표는 아무도 못 읽음
-- ---------------------------------------------------------------------
do $$
declare t text; p record;
begin
  foreach t in array array['roulette_rooms','roulette_seats','roulette_bets','roulette_chat','roulette_avatars','roulette_secrets'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('revoke all on public.%I from anon, authenticated', t);
    if t <> 'roulette_secrets' then
      execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
      execute format('grant select on public.%I to anon, authenticated', t);
    end if;
  end loop;
end $$;
-- 관리자: 끝난 방 지우기 (진행 중인 방은 '취소'로)
create policy "admin delete ended" on public.roulette_rooms for delete to authenticated using (public.is_admin() and status in ('finished','cancelled'));
grant delete on public.roulette_rooms to authenticated;

-- ---------------------------------------------------------------------
-- 3. 내부 도우미 (직접 부를 수 없음)
-- ---------------------------------------------------------------------
-- 칩 잔액 (update-7.sql 과 같은 함수 — 이 파일만 실행해도 되도록 다시 정의)
create or replace function public.chip_balance_locked(p_character uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  perform pg_advisory_xact_lock(hashtext('chips:' || p_character::text));
  select coalesce(sum(amount), 0) into v from public.chip_ledger where character_id = p_character;
  return v;
end $$;

create or replace function public.rl_owns(p_character uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.characters where id = p_character and owner_id = auth.uid());
$$;

create or replace function public.rl_char_name(p_character uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select name from public.characters where id = p_character), '(알 수 없음)');
$$;

create or replace function public.rl_system(p_room uuid, p_body text, p_kind text default 'system', p_data jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.roulette_chat (room_id, name, body, kind, data) values (p_room, '', p_body, p_kind, p_data);
$$;

-- from 자리 다음의 살아 있는 자리 (자리 번호 순서로 돎)
create or replace function public.rl_next_seat(p_room uuid, p_from integer)
returns integer language sql stable security definer set search_path = public as $$
  select seat from public.roulette_seats where room_id = p_room and alive
  order by (seat - p_from - 1 + 8) % 8 limit 1;
$$;

-- 게임 끝: 판돈 · 베팅 정산, 전적 기록
create or replace function public.rl_finish(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  rm record; w record; b record;
  v_total integer; v_win integer; v_pay integer;
  v_names uuid[];
begin
  select * into rm from public.roulette_rooms where id = p_room;
  select * into w from public.roulette_seats where room_id = p_room and alive order by seat limit 1;

  if rm.pot > 0 then
    insert into public.chip_ledger (character_id, amount, reason, created_by)
    values (w.character_id, rm.pot, '러시안 룰렛 우승 (판돈)', auth.uid());
  end if;

  select coalesce(sum(amount), 0) into v_total from public.roulette_bets where room_id = p_room;
  select coalesce(sum(amount), 0) into v_win   from public.roulette_bets where room_id = p_room and seat = w.seat;
  for b in select * from public.roulette_bets where room_id = p_room loop
    if v_win > 0 then
      v_pay := case when b.seat = w.seat then floor(b.amount::numeric * v_total / v_win)::integer else 0 end;
    else
      v_pay := b.amount;   -- 아무도 못 맞힘 → 돌려줌
    end if;
    update public.roulette_bets set payout = v_pay where id = b.id;
    if v_pay > 0 then
      insert into public.chip_ledger (character_id, amount, reason, created_by)
      values (b.character_id, v_pay, case when v_win > 0 then '룰렛 베팅 적중' else '룰렛 베팅 환불 (적중자 없음)' end, auth.uid());
    end if;
  end loop;

  update public.roulette_rooms set status = 'finished', winner_seat = w.seat, turn_seat = null, ended_at = now(), last_action_at = now() where id = p_room;
  delete from public.roulette_secrets where room_id = p_room;

  perform public.rl_system(p_room, public.rl_char_name(w.character_id) || ' 우승!' ||
    case when rm.pot > 0 then ' 판돈 ' || rm.pot || '칩' else '' end ||
    case when v_total > 0 then ' · 베팅 ' || v_total || '칩 ' || case when v_win > 0 then '정산' else '전액 환불' end else '' end,
    'system', jsonb_build_object('event', 'finish', 'seat', w.seat));

  -- 전적 (update-5.sql 을 실행한 경우에만)
  if to_regclass('public.game_records') is not null then
    select array_agg(character_id order by seat) into v_names from public.roulette_seats where room_id = p_room;
    execute 'insert into public.game_records (played_at, game_name, winner_id, participant_ids, chips, note) values (now(), $1, $2, $3, $4, $5)'
      using '러시안 룰렛', w.character_id, v_names, rm.pot, left(rm.title, 120);
  end if;
end $$;

-- 돌려주기 (취소)
create or replace function public.rl_refund_all(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare rm record; s record; b record;
begin
  select * into rm from public.roulette_rooms where id = p_room;
  if rm.status = 'playing' and rm.entry_fee > 0 then
    for s in select * from public.roulette_seats where room_id = p_room loop
      insert into public.chip_ledger (character_id, amount, reason, created_by) values (s.character_id, rm.entry_fee, '러시안 룰렛 취소 — 참가비 환불', auth.uid());
    end loop;
  end if;
  for b in select * from public.roulette_bets where room_id = p_room and payout is null loop
    insert into public.chip_ledger (character_id, amount, reason, created_by) values (b.character_id, b.amount, '러시안 룰렛 취소 — 베팅 환불', auth.uid());
    update public.roulette_bets set payout = b.amount where id = b.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. 관리자 함수
-- ---------------------------------------------------------------------
create or replace function public.admin_roulette_create(p_title text, p_max_seats integer default 6, p_entry_fee integer default 0, p_pass_rule text default 'after_self')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  if p_max_seats is null or p_max_seats < 2 or p_max_seats > 8 then raise exception '자리는 2~8개입니다'; end if;
  if p_entry_fee is null or p_entry_fee < 0 then raise exception '참가비는 0 이상입니다'; end if;
  if p_pass_rule not in ('after_self','free') then raise exception '넘기기 규칙이 올바르지 않습니다'; end if;
  insert into public.roulette_rooms (title, max_seats, entry_fee, pass_rule)
  values (coalesce(nullif(left(trim(p_title), 40), ''), '러시안 룰렛'), p_max_seats, p_entry_fee, p_pass_rule)
  returning id into v_id;
  perform public.rl_system(v_id, '방이 열렸습니다. 자리에 앉아 주세요.');
  return v_id;
end $$;

create or replace function public.admin_roulette_start(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare rm record; s record; n integer; v_bal integer;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  select * into rm from public.roulette_rooms where id = p_room for update;
  if not found then raise exception '방을 찾을 수 없습니다'; end if;
  if rm.status <> 'waiting' then raise exception '대기 중인 방만 시작할 수 있습니다'; end if;
  select count(*) into n from public.roulette_seats where room_id = p_room;
  if n < 2 then raise exception '두 명 이상 앉아야 시작할 수 있습니다'; end if;

  if rm.entry_fee > 0 then
    for s in select * from public.roulette_seats where room_id = p_room order by seat loop
      v_bal := public.chip_balance_locked(s.character_id);
      if v_bal < rm.entry_fee then raise exception '%의 칩이 부족합니다 (보유 %, 참가비 %)', public.rl_char_name(s.character_id), v_bal, rm.entry_fee; end if;
      insert into public.chip_ledger (character_id, amount, reason, created_by) values (s.character_id, -rm.entry_fee, '러시안 룰렛 참가비', auth.uid());
    end loop;
  end if;

  insert into public.roulette_secrets (room_id, bullet) values (p_room, 1 + floor(random() * 6)::int)
  on conflict (room_id) do update set bullet = excluded.bullet;
  update public.roulette_seats set alive = true, out_at = null where room_id = p_room;
  update public.roulette_rooms set status = 'playing', pot = rm.entry_fee * n, shots = 0, round = 1, self_survived = false,
    turn_seat = (select seat from public.roulette_seats where room_id = p_room order by random() limit 1),
    started_at = now(), last_action_at = now()
  where id = p_room;
  select * into rm from public.roulette_rooms where id = p_room;
  perform public.rl_system(p_room, '게임 시작! 탄창 6칸에 1발. 첫 차례: ' ||
    public.rl_char_name((select character_id from public.roulette_seats where room_id = p_room and seat = rm.turn_seat)),
    'system', jsonb_build_object('event', 'start'));
end $$;

create or replace function public.admin_roulette_cancel(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare rm record;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  select * into rm from public.roulette_rooms where id = p_room for update;
  if not found then raise exception '방을 찾을 수 없습니다'; end if;
  if rm.status not in ('waiting','playing') then raise exception '이미 끝난 방입니다'; end if;
  perform public.rl_refund_all(p_room);
  update public.roulette_rooms set status = 'cancelled', turn_seat = null, ended_at = now(), last_action_at = now() where id = p_room;
  delete from public.roulette_secrets where room_id = p_room;
  perform public.rl_system(p_room, '관리자가 게임을 취소했습니다.' || case when rm.status = 'playing' then ' 참가비와 베팅은 모두 돌려드렸습니다.' else '' end,
    'system', jsonb_build_object('event', 'cancel'));
end $$;

-- 차례 강제로 넘기기 (자리를 비운 사람이 있을 때)
create or replace function public.admin_roulette_skip(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare rm record; v_next integer;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  select * into rm from public.roulette_rooms where id = p_room for update;
  if not found or rm.status <> 'playing' then raise exception '진행 중인 방이 아닙니다'; end if;
  v_next := public.rl_next_seat(p_room, rm.turn_seat);
  update public.roulette_rooms set turn_seat = v_next, self_survived = false, last_action_at = now() where id = p_room;
  perform public.rl_system(p_room, '관리자가 차례를 넘겼습니다 → ' ||
    public.rl_char_name((select character_id from public.roulette_seats where room_id = p_room and seat = v_next)),
    'system', jsonb_build_object('event', 'turn'));
end $$;

-- 대기 중에 자리 비우기
create or replace function public.admin_roulette_kick(p_room uuid, p_seat integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_char uuid;
begin
  if not public.is_admin() then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  if not exists (select 1 from public.roulette_rooms where id = p_room and status = 'waiting') then raise exception '대기 중인 방에서만 자리를 비울 수 있습니다'; end if;
  delete from public.roulette_seats where room_id = p_room and seat = p_seat returning character_id into v_char;
  if v_char is null then raise exception '빈 자리입니다'; end if;
  perform public.rl_system(p_room, public.rl_char_name(v_char) || ' 님의 자리를 비웠습니다.');
end $$;

-- ---------------------------------------------------------------------
-- 5. 멤버 함수
-- ---------------------------------------------------------------------
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
  if rm.entry_fee > 0 and public.chip_balance_locked(p_character) < rm.entry_fee then
    raise exception '참가비(%칩)보다 칩이 적습니다', rm.entry_fee;
  end if;
  insert into public.roulette_seats (room_id, seat, character_id) values (p_room, v_seat, p_character);
  perform public.rl_system(p_room, public.rl_char_name(p_character) || ' 님이 앉았습니다.');
  return v_seat;
end $$;

create or replace function public.roulette_leave(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_char uuid;
begin
  if not exists (select 1 from public.roulette_rooms where id = p_room and status = 'waiting') then raise exception '대기 중일 때만 일어날 수 있습니다'; end if;
  delete from public.roulette_seats s using public.characters c
   where s.room_id = p_room and c.id = s.character_id and c.owner_id = auth.uid()
  returning s.character_id into v_char;
  if v_char is null then raise exception '앉아 있지 않습니다'; end if;
  perform public.rl_system(p_room, public.rl_char_name(v_char) || ' 님이 일어났습니다.');
end $$;

-- 쏘기: p_target = 쏠 자리 (내 자리면 나에게)
create or replace function public.roulette_shoot(p_room uuid, p_target integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  rm record; me record; tg record;
  v_bullet integer; v_shots integer; v_live boolean;
  v_round integer; v_alive integer; v_turn integer; v_self boolean;
  v_data jsonb;
begin
  select * into rm from public.roulette_rooms where id = p_room for update;
  if not found or rm.status <> 'playing' then raise exception '진행 중인 게임이 아닙니다'; end if;
  select * into me from public.roulette_seats where room_id = p_room and seat = rm.turn_seat;
  if not found or not public.rl_owns(me.character_id) then raise exception '내 차례가 아닙니다'; end if;
  select * into tg from public.roulette_seats where room_id = p_room and seat = p_target;
  if not found or not tg.alive then raise exception '쏠 수 없는 자리입니다'; end if;

  select bullet into v_bullet from public.roulette_secrets where room_id = p_room;
  v_shots := rm.shots + 1;
  v_live  := v_shots = v_bullet;
  v_round := rm.round;

  if v_live then
    update public.roulette_seats set alive = false, out_at = now() where room_id = p_room and seat = p_target;
    update public.roulette_secrets set bullet = 1 + floor(random() * 6)::int where room_id = p_room;   -- 새 탄창
    v_shots := 0; v_round := rm.round + 1;
  end if;

  v_data := jsonb_build_object('event', 'shot', 'shooter', me.seat, 'target', p_target, 'live', v_live, 'shot_no', rm.shots + 1, 'round', rm.round);
  perform public.rl_system(p_room,
    public.rl_char_name(me.character_id) ||
    case when p_target = me.seat then ' → 자신에게' else ' → ' || public.rl_char_name(tg.character_id) || '에게' end ||
    case when v_live then ' 파지직! 명중. ' || public.rl_char_name(tg.character_id) || ' 탈락' else ' 철컥… 빈 칸' end,
    'shot', v_data);

  select count(*) into v_alive from public.roulette_seats where room_id = p_room and alive;
  if v_alive <= 1 then
    update public.roulette_rooms set shots = v_shots, round = v_round where id = p_room;
    perform public.rl_finish(p_room);
    return v_data || jsonb_build_object('finished', true);
  end if;

  if p_target = me.seat and not v_live then
    v_turn := me.seat; v_self := true;          -- 나에게 쏴서 살았으면 다시 내 차례
  else
    v_turn := public.rl_next_seat(p_room, me.seat); v_self := false;
  end if;
  update public.roulette_rooms set shots = v_shots, round = v_round, turn_seat = v_turn, self_survived = v_self, last_action_at = now() where id = p_room;
  if v_live then
    perform public.rl_system(p_room, '탄창을 다시 채웠습니다 (' || v_round || '번째 탄창).', 'system', jsonb_build_object('event', 'reload'));
  end if;
  return v_data || jsonb_build_object('finished', false);
end $$;

create or replace function public.roulette_pass(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare rm record; me record; v_next integer;
begin
  select * into rm from public.roulette_rooms where id = p_room for update;
  if not found or rm.status <> 'playing' then raise exception '진행 중인 게임이 아닙니다'; end if;
  select * into me from public.roulette_seats where room_id = p_room and seat = rm.turn_seat;
  if not found or not public.rl_owns(me.character_id) then raise exception '내 차례가 아닙니다'; end if;
  if rm.pass_rule = 'after_self' and not rm.self_survived then raise exception '나에게 한 번 쏘고 살아남아야 넘길 수 있습니다'; end if;
  v_next := public.rl_next_seat(p_room, me.seat);
  update public.roulette_rooms set turn_seat = v_next, self_survived = false, last_action_at = now() where id = p_room;
  perform public.rl_system(p_room, public.rl_char_name(me.character_id) || ' 님이 차례를 넘겼습니다 → ' ||
    public.rl_char_name((select character_id from public.roulette_seats where room_id = p_room and seat = v_next)),
    'system', jsonb_build_object('event', 'turn'));
end $$;

-- 생존자 베팅: 게임 시작 뒤 ~ 첫 탈락 전까지
create or replace function public.roulette_bet(p_room uuid, p_seat integer, p_character uuid, p_amount integer)
returns integer language plpgsql security definer set search_path = public as $$
declare rm record; tg record; v_bal integer;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다' using errcode = '42501'; end if;
  if not public.rl_owns(p_character) then raise exception '내 캐릭터의 칩으로만 걸 수 있습니다' using errcode = '42501'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 1000000 then raise exception '베팅은 1칩 이상입니다'; end if;
  select * into rm from public.roulette_rooms where id = p_room for update;
  if not found or rm.status <> 'playing' then raise exception '게임이 진행 중일 때만 걸 수 있습니다'; end if;
  if exists (select 1 from public.roulette_seats where room_id = p_room and not alive) then raise exception '첫 탈락자가 나와 베팅이 마감되었습니다'; end if;
  select * into tg from public.roulette_seats where room_id = p_room and seat = p_seat;
  if not found then raise exception '빈 자리에는 걸 수 없습니다'; end if;
  v_bal := public.chip_balance_locked(p_character);
  if v_bal < p_amount then raise exception '칩이 부족합니다 (보유 %)', v_bal; end if;
  insert into public.chip_ledger (character_id, amount, reason, created_by) values (p_character, -p_amount, '러시안 룰렛 베팅', auth.uid());
  insert into public.roulette_bets (room_id, seat, character_id, amount) values (p_room, p_seat, p_character, p_amount);
  perform public.rl_system(p_room, public.rl_char_name(p_character) || ' 님이 ' || public.rl_char_name(tg.character_id) || '에게 ' || p_amount || '칩을 걸었습니다.',
    'system', jsonb_build_object('event', 'bet'));
  return v_bal - p_amount;
end $$;

-- 채팅: 캐릭터가 있는 멤버 또는 관리자. 300자, 0.7초에 한 번
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
  insert into public.roulette_chat (room_id, user_id, name, body, kind) values (p_room, auth.uid(), v_name, v_body, 'chat');
end $$;

-- 자리 이미지 지정 (캐릭터 주인 또는 관리자). p_path = null 이면 지움 → 캐릭터 기본 이미지
create or replace function public.roulette_set_avatar(p_character uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.rl_owns(p_character) or public.is_admin()) then raise exception '내 캐릭터만 바꿀 수 있습니다' using errcode = '42501'; end if;
  if p_path is null or p_path = '' then
    delete from public.roulette_avatars where character_id = p_character;
    return;
  end if;
  if p_path not like p_character::text || '/%' then raise exception '이미지 위치가 올바르지 않습니다'; end if;
  insert into public.roulette_avatars (character_id, path, updated_at) values (p_character, p_path, now())
  on conflict (character_id) do update set path = excluded.path, updated_at = now();
end $$;

-- 실행 권한: 내부 도우미는 막고, 화면에서 부르는 함수만 열기
do $$
declare f text;
begin
  foreach f in array array[
    'chip_balance_locked(uuid)', 'rl_owns(uuid)', 'rl_char_name(uuid)', 'rl_system(uuid, text, text, jsonb)',
    'rl_next_seat(uuid, integer)', 'rl_finish(uuid)', 'rl_refund_all(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'admin_roulette_create(text, integer, integer, text)', 'admin_roulette_start(uuid)', 'admin_roulette_cancel(uuid)',
    'admin_roulette_skip(uuid)', 'admin_roulette_kick(uuid, integer)',
    'roulette_join(uuid, uuid)', 'roulette_leave(uuid)', 'roulette_shoot(uuid, integer)', 'roulette_pass(uuid)',
    'roulette_bet(uuid, integer, uuid, integer)', 'roulette_say(uuid, text, uuid)', 'roulette_set_avatar(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. 저장소 — 자리 이미지 (roulette/캐릭터ID/파일). 올리기는 캐릭터 주인 또는 관리자
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('roulette', 'roulette', true)
on conflict (id) do update set public = true;

drop policy if exists "roulette avatar insert" on storage.objects;
drop policy if exists "roulette avatar update" on storage.objects;
drop policy if exists "roulette avatar delete" on storage.objects;
drop policy if exists "roulette avatar select" on storage.objects;
create policy "roulette avatar select" on storage.objects for select to authenticated using (
  bucket_id = 'roulette' and (public.is_admin() or exists (select 1 from public.characters c where c.id::text = (storage.foldername(name))[1] and c.owner_id = auth.uid())));
create policy "roulette avatar insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'roulette' and (public.is_admin() or exists (select 1 from public.characters c where c.id::text = (storage.foldername(name))[1] and c.owner_id = auth.uid())));
create policy "roulette avatar update" on storage.objects for update to authenticated using (
  bucket_id = 'roulette' and (public.is_admin() or exists (select 1 from public.characters c where c.id::text = (storage.foldername(name))[1] and c.owner_id = auth.uid())));
create policy "roulette avatar delete" on storage.objects for delete to authenticated using (
  bucket_id = 'roulette' and (public.is_admin() or exists (select 1 from public.characters c where c.id::text = (storage.foldername(name))[1] and c.owner_id = auth.uid())));

-- ---------------------------------------------------------------------
-- 7. 실시간 반영
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['roulette_rooms','roulette_seats','roulette_bets','roulette_chat','roulette_avatars'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

commit;

-- 확인: 아래가 6 이면 정상 (표 6개)
-- select count(*) from information_schema.tables where table_schema='public' and table_name like 'roulette_%';
