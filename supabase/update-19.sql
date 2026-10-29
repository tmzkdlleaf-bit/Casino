-- =====================================================================
--  update-19 : 룰렛 '나에게 한 번 쏘고 살아남은 뒤에만' 규칙 강화
--   · 이 규칙의 방에서는 차례의 첫 발을 반드시 나에게 쏴야 함 (남을 겨눌 수 없음)
--   · 살아남은 뒤에는 남에게 쏘거나, 다시 나에게 쏘거나, 넘길 수 있음
--   · '언제든' 방은 그대로 (바로 넘기기·아무에게나 쏘기 가능)
--   지금 데이터베이스에 있는 roulette_shoot 에 검사 한 줄만 끼워 넣음 (나머지 동작은 그대로)
--   update-18 다음에 한 번 실행. 여러 번 실행해도 안전합니다.
-- =====================================================================
begin;

do $$
declare d text; anchor text := '''쏠 수 없는 자리입니다''; end if;';
begin
  d := pg_get_functiondef('public.roulette_shoot(uuid, integer)'::regprocedure);
  if position('첫 발은 나에게' in d) = 0 then
    if position(anchor in d) = 0 then raise exception 'roulette_shoot 모양이 예상과 달라 고치지 못했습니다'; end if;
    d := replace(d, anchor, anchor || E'\n  if rm.pass_rule = ''after_self'' and not rm.self_survived and p_target <> me.seat then raise exception ''첫 발은 나에게 쏴야 합니다''; end if;');
    execute d;
  end if;
end $$;

commit;

select position('첫 발은 나에게' in pg_get_functiondef('public.roulette_shoot(uuid, integer)'::regprocedure)) > 0 as rule_added;
