-- =====================================================================
--  update-18 : 게임 채팅에 캐릭터 얼굴
--   · 룰렛·블랙잭 채팅을 보낼 때 어떤 캐릭터로 말했는지 함께 저장 (data.char)
--   · 화면은 그 캐릭터의 얼굴을 이름 옆에 보여 줌. 예전 채팅은 이름으로 찾아 보여 줌
--   update-17 다음에 한 번 실행. 여러 번 실행해도 안전합니다.
-- =====================================================================
begin;

create or replace function public.roulette_say(p_room uuid, p_body text, p_character uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_char uuid; v_body text := left(trim(coalesce(p_body, '')), 300);
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다' using errcode = '42501'; end if;
  if v_body = '' then raise exception '내용을 입력해 주세요'; end if;
  if not exists (select 1 from public.roulette_rooms where id = p_room) then raise exception '방을 찾을 수 없습니다'; end if;
  if p_character is not null and public.rl_owns(p_character) then
    v_char := p_character; v_name := public.rl_char_name(p_character);
  elsif public.is_admin() then
    v_name := coalesce((select nullif(display_name, '') from public.profiles where id = auth.uid()), '관리자');
  elsif exists (select 1 from public.characters where owner_id = auth.uid()) then
    select id, name into v_char, v_name from public.characters where owner_id = auth.uid() order by sort_order limit 1;
  else
    raise exception '캐릭터가 연결된 멤버만 채팅할 수 있습니다' using errcode = '42501';
  end if;
  if exists (select 1 from public.roulette_chat where room_id = p_room and user_id = auth.uid() and created_at > now() - interval '700 milliseconds') then
    raise exception '너무 빨라요. 잠시 후 다시 보내 주세요';
  end if;
  if (select count(*) from public.roulette_chat where room_id = p_room and user_id = auth.uid() and kind = 'chat' and created_at > now() - interval '10 seconds') >= 5 then
    raise exception '채팅이 너무 많아요. 몇 초 뒤에 보내 주세요';
  end if;
  insert into public.roulette_chat (room_id, user_id, name, body, kind, data) values (p_room, auth.uid(), v_name, v_body, 'chat', case when v_char is not null then jsonb_build_object('char', v_char) end);
end $$;

create or replace function public.bj_say(p_table uuid, p_body text, p_character uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_char uuid; v_body text := left(trim(coalesce(p_body, '')), 300);
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다' using errcode = '42501'; end if;
  if v_body = '' then raise exception '내용을 입력해 주세요'; end if;
  if not exists (select 1 from public.bj_tables where id = p_table) then raise exception '테이블을 찾을 수 없습니다'; end if;
  if p_character is not null and public.rl_owns(p_character) then v_char := p_character; v_name := public.rl_char_name(p_character);
  elsif public.is_admin() then v_name := coalesce((select nullif(display_name, '') from public.profiles where id = auth.uid()), '관리자');
  elsif exists (select 1 from public.characters where owner_id = auth.uid()) then
    select id, name into v_char, v_name from public.characters where owner_id = auth.uid() order by sort_order limit 1;
  else raise exception '캐릭터가 연결된 멤버만 채팅할 수 있습니다' using errcode = '42501'; end if;
  if exists (select 1 from public.bj_chat where table_id = p_table and user_id = auth.uid() and created_at > now() - interval '700 milliseconds') then
    raise exception '너무 빨라요. 잠시 후 다시 보내 주세요'; end if;
  if (select count(*) from public.bj_chat where table_id = p_table and user_id = auth.uid() and kind = 'chat' and created_at > now() - interval '10 seconds') >= 5 then
    raise exception '채팅이 너무 많아요. 몇 초 뒤에 보내 주세요'; end if;
  insert into public.bj_chat (table_id, user_id, name, body, kind, data) values (p_table, auth.uid(), v_name, v_body, 'chat', case when v_char is not null then jsonb_build_object('char', v_char) end);
end $$;

commit;

select count(*) as funcs from pg_proc where proname in ('roulette_say', 'bj_say') and prosrc like '%v_char%';
