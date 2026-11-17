-- v2.57.0 Family Tipping Championship. Additive only. Family members are the existing Nan's Tips accounts (otr_bets) that
-- have a leaderboard name; the sync code stays private and is checked by the otr-champ edge function, which calls
-- otr_champ_set() with the service role. Nothing here touches bets, balances, tipsters, The Mob, Best Bets or the Lab.

-- each person's current tip in a race (one per person per race)
create table if not exists otr_champ_tips (
  code text not null references otr_bets(code), race_id text not null references otr_nan_log(id),
  name text not null, no int, mk numeric, set_at timestamptz not null default now(), jump timestamptz not null,
  primary key (code, race_id));
-- every change, kept
create table if not exists otr_champ_tip_log (
  id bigserial primary key, code text not null, race_id text not null, action text not null check (action in ('set','clear')),
  name text, no int, mk numeric, jump timestamptz not null, at timestamptz not null default now());
-- the last market seen before each dog and harness race, for the tipsters' outsider bonus (horses carry theirs in Nan's log)
create table if not exists otr_race_mkt (race_id text primary key references otr_nan_log(id), mk jsonb not null, jump timestamptz not null, at timestamptz not null default now());
alter table otr_champ_tips enable row level security; alter table otr_champ_tip_log enable row level security; alter table otr_race_mkt enable row level security;
revoke all on otr_champ_tips, otr_champ_tip_log, otr_race_mkt from anon, authenticated;
revoke all on sequence otr_champ_tip_log_id_seq from anon, authenticated;

-- tips lock at the jump (server clock); the change log is append-only
create or replace function otr_champ_guard() returns trigger language plpgsql as $$
declare j timestamptz;
begin
  if tg_table_name = 'otr_champ_tip_log' and tg_op <> 'INSERT' then raise exception 'the tip log is append-only'; end if;
  select jump into j from otr_nan_log where id = coalesce(new.race_id, old.race_id);
  if j is null or j <= now() then raise exception 'tips for this race are locked: it has jumped'; end if;
  if tg_op = 'DELETE' then return old; end if;
  new.jump := j;
  if tg_table_name = 'otr_champ_tips' then new.set_at := now(); else new.at := now(); end if;
  return new;
end $$;
create trigger otr_champ_tips_guard before insert or update or delete on otr_champ_tips for each row execute function otr_champ_guard();
create trigger otr_champ_tip_log_guard before insert or update or delete on otr_champ_tip_log for each row execute function otr_champ_guard();
create or replace function otr_race_mkt_guard() returns trigger language plpgsql as $$
declare j timestamptz;
begin
  if tg_op = 'DELETE' then raise exception 'kept'; end if;
  select jump into j from otr_nan_log where id = new.race_id;
  if j is null or j <= now() then raise exception 'race has jumped'; end if;
  new.jump := j; new.at := now(); return new;
end $$;
create trigger otr_race_mkt_guard before insert or update or delete on otr_race_mkt for each row execute function otr_race_mkt_guard();

-- set or clear a tip. The runner must be in Nan's field; the price is the one saved at that moment (horses: Nan's log,
-- dogs and harness: PuntersEdge quick prices), never one sent by the phone.
create or replace function otr_champ_set(p_code text, p_race text, p_no int, p_clear boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b record; l record; u jsonb; m numeric; who text;
begin
  select code, name into b from otr_bets where code = p_code;
  if not found then return jsonb_build_object('error','Save a bet first, then pick your name.'); end if;
  if b.name is null then return jsonb_build_object('error','Pick a leaderboard name in My bets to join the Family Championship.'); end if;
  select id, code, jump, picks into l from otr_nan_log where id = p_race;
  if not found then return jsonb_build_object('error','Nan isn''t keeping a record of this race, so it can''t count in the championship.'); end if;
  if l.jump <= now() then return jsonb_build_object('error','Too late: this race has jumped.'); end if;
  if p_clear then
    delete from otr_champ_tips where code = p_code and race_id = p_race;
    insert into otr_champ_tip_log(code, race_id, action, jump) values (p_code, p_race, 'clear', l.jump);
    return jsonb_build_object('ok', true, 'cleared', true);
  end if;
  select x into u from jsonb_array_elements(l.picks) x where (x->>'no')::int = p_no limit 1;
  if u is null then return jsonb_build_object('error','That runner isn''t in the field (it may be scratched).'); end if;
  m := case when l.code = 'H' then nullif((u->>'mk')::numeric, 0) else (otr_quick_mkt(p_race)->>otr_nk(u->>'name'))::numeric end;
  if m is not null and m <= 1 then m := null; end if;
  insert into otr_champ_tips(code, race_id, name, no, mk, jump) values (p_code, p_race, u->>'name', p_no, m, l.jump)
    on conflict (code, race_id) do update set name = excluded.name, no = excluded.no, mk = excluded.mk
    where (otr_champ_tips.name, otr_champ_tips.no) is distinct from (excluded.name, excluded.no);
  if found then insert into otr_champ_tip_log(code, race_id, action, name, no, mk, jump) values (p_code, p_race, 'set', u->>'name', p_no, m, l.jump); end if;
  return jsonb_build_object('ok', true, 'name', u->>'name', 'no', p_no, 'mk', m);
end $$;
revoke all on function otr_champ_set(text,text,int,boolean) from anon, authenticated, public;

-- points for one finish: 10 / 5 / 3, plus +5 for a winner at $5 or more, +10 (instead) at $10 or more
create or replace function otr_champ_points(pos int, mk numeric) returns int language sql immutable as $$
  select case when pos = 1 then 10 + case when mk >= 10 then 10 when mk >= 5 then 5 else 0 end when pos = 2 then 5 when pos = 3 then 3 else 0 end $$;

-- every scored selection: family tips, and the tipsters' saved pre-race top picks in the same races
-- (tipsters only play the races at least one family member tipped, so everyone is judged on the same races).
-- Settled races only; scratched picks and abandoned races don't count. Dead heats: official positions, so both score.
create or replace view otr_champ_rows as
with fam as (
  select b.name who, 'family'::text kind, t.race_id, t.name runner, t.no, t.mk, t.set_at at from otr_champ_tips t join otr_bets b on b.code = t.code where b.name is not null
), races as (select distinct race_id from otr_champ_tips),
tip as (
  select 'nan'::text who, 'tipster'::text kind, l.id race_id, l.picks->0->>'name' runner, (l.picks->0->>'no')::int no, null::numeric mk, l.recorded_at at from otr_nan_log l join races r on r.race_id = l.id
  union all
  select x.who, 'tipster', x.id, x.name, null::int, null::numeric, x.recorded_at from otr_tipster_log x join races r on r.race_id = x.id where x.who in ('pop','bob','gran','kev','panel')
), alls as (
  select f.*, null::boolean est from fam f
  union all
  select t.who, t.kind, t.race_id, t.runner, t.no,
    coalesce((select nullif((p->>'mk')::numeric,0) from otr_nan_log l, jsonb_array_elements(l.picks) p where l.id = t.race_id and l.code = 'H' and otr_nk(p->>'name') = otr_nk(t.runner) limit 1),
             (select (m.mk->>otr_nk(t.runner))::numeric from otr_race_mkt m where m.race_id = t.race_id)),
    t.at, null from tip t
)
select a.who, a.kind, a.race_id, l.date, l.code, l.venue, l.race, l.jump, a.runner, a.mk,
  ((l.result->'pos')->>otr_nk(a.runner))::int pos,
  otr_champ_points(((l.result->'pos')->>otr_nk(a.runner))::int, case when a.mk > 1 then a.mk end) pts
from alls a join otr_nan_log l on l.id = a.race_id
where l.settled_at is not null and coalesce(l.result->>'status','') <> 'abandoned'
  and not exists (select 1 from jsonb_array_elements_text(coalesce(l.result->'scr','[]'::jsonb)) s where otr_nk(s) = otr_nk(a.runner));
revoke all on otr_champ_rows from anon, authenticated;

-- the Lab's 10-minute job also keeps the last pre-race dog/harness market (for the tipsters' outsider bonus)
create or replace function otr_record_strategies() returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; s record; lrev int; lname text; added int := 0; races int := 0; m jsonb;
begin
  for r in select id, code, date, jump from otr_nan_log where jump > now() and jump < now() + interval '90 minutes' loop
    races := races + 1;
    insert into otr_strategy_seen(race_id, code, date, jump) values (r.id, r.code, r.date, r.jump) on conflict do nothing;
    m := case when r.code = 'H' then '{}'::jsonb else otr_quick_mkt(r.id) end;
    if r.code <> 'H' and m <> '{}'::jsonb then
      insert into otr_race_mkt(race_id, mk, jump) values (r.id, m, r.jump) on conflict (race_id) do update set mk = excluded.mk;
    end if;
    for s in select b.st, a.* from (select unnest(array['nan','form','market','consensus','value','bestbets']) st) b
             left join otr_strategy_picks(r.id, m) a on a.strategy = b.st loop
      lrev := null; lname := null;
      select l.rev, l.name into lrev, lname from otr_strategy_log l where l.race_id = r.id and l.strategy = s.st order by l.rev desc limit 1;
      if s.strategy is null then
        if lrev is not null and lname is not null then
          insert into otr_strategy_log(race_id, strategy, version, rev, name, jump, data) values (r.id, s.st, 1, lrev + 1, null, r.jump, '{"withdrawn":true}');
          added := added + 1; end if;
      elsif lrev is null or lname is distinct from s.name then
        insert into otr_strategy_log(race_id, strategy, version, rev, name, no, p, pi, mk, fair, edge, score, agree, groups, cat, labels, data, jump)
        values (r.id, s.st, 1, coalesce(lrev,0) + 1, s.name, s.no, s.p, s.pi, s.mk, s.fair, s.edge, s.score, s.agree, s.groups, s.cat, s.labels, s.data, r.jump);
        added := added + 1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('races', races, 'added', added);
end $$;
revoke all on function otr_record_strategies() from anon, authenticated, public;
