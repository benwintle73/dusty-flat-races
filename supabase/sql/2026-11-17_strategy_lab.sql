-- Nan's Tips Strategy Lab (v2.56.0): research-only, additive. Records Best Bets and experimental strategies before each race,
-- keeps every revision, refuses writes after the jump, and settles them from the same official results as the leaderboard.
-- Nothing here touches any tipster's live picks, The Mob, Best Bets display, bets, balances or results.

create or replace function otr_nk(t text) returns text language sql immutable as $$ select regexp_replace(lower(coalesce(t,'')),'[^a-z0-9]','','g') $$;

create table if not exists otr_strategy_log (
  id bigserial primary key,
  race_id text not null,
  strategy text not null,          -- nan | form | market | consensus | value | bestbets
  version int not null,            -- strategy rule version
  rev int not null,                -- 1, 2, ... a new revision whenever the pick changes before the jump
  name text,                       -- null = withdrawn (no longer qualifies)
  no int,
  p numeric,                       -- the strategy's own chance for the pick, where it has one
  pi numeric,                      -- average of the independent model chances (Pop, Bob, Nan on dogs/harness)
  mk numeric,                      -- market price at selection time, where saved
  fair numeric, edge numeric, score numeric,
  agree int, groups int,
  cat text,                        -- bestbets: qualifier | value ; value: value
  labels text[],
  data jsonb,                      -- the inputs: who rated the race, each tipster's chance for the pick
  source text not null default 'live',   -- live = recorded before the jump by the scheduled job; backfill = rebuilt from saved pre-race picks
  jump timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique (race_id, strategy, rev)
);
create index if not exists otr_strategy_log_race on otr_strategy_log(race_id, strategy, rev desc);
alter table otr_strategy_log enable row level security;
revoke all on otr_strategy_log from anon, authenticated;
revoke all on sequence otr_strategy_log_id_seq from anon, authenticated;

-- every race the job looked at, for eligibility rates
create table if not exists otr_strategy_seen (race_id text primary key, code text, date date, jump timestamptz, source text not null default 'live', first_seen timestamptz not null default now());
alter table otr_strategy_seen enable row level security;
revoke all on otr_strategy_seen from anon, authenticated;

-- records are immutable, and live records can't be written once the race has jumped (server clock)
create or replace function otr_strategy_guard() returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then raise exception 'otr_strategy_log is append-only'; end if;
  new.recorded_at := now();
  if new.source = 'live' and new.jump <= now() then raise exception 'race % has jumped: no new selections', new.race_id; end if;
  if new.source not in ('live','backfill') then raise exception 'bad source'; end if;
  return new;
end $$;
create trigger otr_strategy_guard before insert or update or delete on otr_strategy_log for each row execute function otr_strategy_guard();

-- The strategies for one race, from what was saved before the jump. mkt: {runner key: market price} for dogs/harness.
-- Rules (version 1):
--   nan       Nan's top pick, unchanged.
--   form      Highest average of the independent models (Pop, Bob, plus Nan on dogs/harness full form; a model that rated the
--             race but hasn't the runner in its top four counts 0). Needs Pop or Bob.
--   market    Shortest market price. Needs a saved price (horses always; dogs/harness from PuntersEdge quick prices, live only).
--   consensus Most opinion groups with it on top (market = Gran, plus Nan on horses; Pop; Bob; Kev; Nan on dogs/harness).
--             Needs 3+ groups and 2+ votes; ties to The Mob's chance, then Nan's.
--   value     The Best Bets value rule: 2+ independent models rate it, average >= 10%, market $1.50-$12, overlay 20%-100%,
--             each model on its own beats the market by 10%+. Biggest overlay. Occasional.
--   bestbets  The Best Bets qualifier (v2.55 formula): The Mob's top pick with 3+ tipsters incl. Pop or Bob, Mob chance >= 20%,
--             agreement >= 50%. Score = 100(0.45 min(p/0.5,1) + 0.30 a + 0.15 min(max(edge,0),0.5)/0.5 + 0.10 d).
create or replace function otr_strategy_picks(rid text, mkt jsonb default '{}'::jsonb)
returns table(strategy text, name text, no int, p numeric, pi numeric, mk numeric, fair numeric, edge numeric, score numeric, agree int, groups int, cat text, labels text[], data jsonb)
language plpgsql stable as $$
#variable_conflict use_column
declare
  rr record; rs jsonb := '[]'; tm jsonb := '{}'; u jsonb; best jsonb; v numeric; n int; grp text[] := '{}'; gi text;
  nan_ind boolean; inds text[]; have text[]; k text; tops jsonb := '{}'; tip record; pis numeric[]; pp numeric; e numeric;
begin
  select * into rr from otr_nan_log where id = rid; if not found or rr.picks is null or jsonb_array_length(rr.picks) = 0 then return; end if;
  nan_ind := rr.code <> 'H' and not coalesce(rr.est,false);
  for tip in select t.who, t.top from otr_tipster_log t where t.id = rid and jsonb_typeof(t.top)='array' and jsonb_array_length(t.top)>0 loop
    tm := tm || jsonb_build_object(tip.who, (select coalesce(jsonb_object_agg(otr_nk(x->>'name'), (x->>'p')::numeric), '{}') from jsonb_array_elements(tip.top) x));
    tops := tops || jsonb_build_object(tip.who, otr_nk(tip.top->0->>'name'));
  end loop;
  tm := tm || jsonb_build_object('nan', (select coalesce(jsonb_object_agg(otr_nk(x->>'name'), (x->>'p')::numeric), '{}') from jsonb_array_elements(rr.picks) x));
  tops := tops || jsonb_build_object('nan', otr_nk(rr.picks->0->>'name'));
  have := array(select x from unnest(array['nan','pop','bob','gran','kev']) x where tm ? x);
  inds := array(select x from unnest(array['pop','bob']) x where tm ? x) || case when nan_ind then array['nan'] else '{}'::text[] end;
  if tm ? 'gran' or not nan_ind then grp := grp || 'market'::text; end if;
  foreach gi in array array['pop','bob','kev'] loop if tm ? gi then grp := grp || gi; end if; end loop;
  if nan_ind then grp := grp || 'nanv'::text; end if;
  -- one entry per runner with everything the rules need
  for u in select x from jsonb_array_elements(rr.picks) x loop
    k := otr_nk(u->>'name');
    pis := array(select (tm->w->>k)::numeric from unnest(inds) w where tm->w ? k);
    n := (select count(*) from unnest(grp) gg where (gg='market' and (tops->>'gran'=k or (not nan_ind and tops->>'nan'=k))) or (gg in ('pop','bob','kev') and tops->>gg=k) or (gg='nanv' and tops->>'nan'=k));
    rs := rs || jsonb_build_array(jsonb_build_object('k',k,'name',u->>'name','no',(u->>'no')::int,'nan',(u->>'p')::numeric,
      'mk', case when rr.code='H' then nullif((u->>'mk')::numeric,0) else (mkt->>k)::numeric end,
      'form', case when coalesce(array_length(inds,1),0)>0 then (select avg(coalesce((tm->w->>k)::numeric,0)) from unnest(inds) w) end,
      'pis', to_jsonb(pis), 'pi', (select avg(x) from unnest(pis) x), 'votes', n, 'mob', (tm->'panel'->>k)::numeric,
      'ch', (select jsonb_object_agg(w, tm->w->k) from unnest(have || array['panel']) w where tm ? w)));
    -- the value rule, per runner
    pp := (rs->-1->>'pi')::numeric; v := (rs->-1->>'mk')::numeric;
    if coalesce(array_length(pis,1),0) >= 2 and pp >= .10 and v between 1.5 and 12 then
      e := pp*v - 1;
      if e >= .20 and e <= 1.0 and not exists (select 1 from unnest(pis) q where q*v < 1.1) then rs := jsonb_set(rs, array[(jsonb_array_length(rs)-1)::text,'val'], to_jsonb(round(e,3))); end if;
    end if;
  end loop;
  -- nan
  u := rs->0; return query select 'nan'::text, u->>'name', (u->>'no')::int, (u->>'nan')::numeric, (u->>'pi')::numeric, (u->>'mk')::numeric, null::numeric, null::numeric, null::numeric, null::int, null::int, null::text, null::text[], jsonb_build_object('have',have,'ch',u->'ch');
  -- form
  if tm ? 'pop' or tm ? 'bob' then
    select x into best from jsonb_array_elements(rs) x order by (x->>'form')::numeric desc nulls last, (x->>'nan')::numeric desc limit 1;
    return query select 'form'::text, best->>'name', (best->>'no')::int, (best->>'form')::numeric, (best->>'pi')::numeric, (best->>'mk')::numeric, null::numeric, null::numeric, null::numeric, null::int, null::int, null::text, null::text[], jsonb_build_object('have',have,'inds',inds,'ch',best->'ch');
  end if;
  best := null;
  -- market
  select x into best from jsonb_array_elements(rs) x where (x->>'mk')::numeric > 1 order by (x->>'mk')::numeric, (x->>'nan')::numeric desc limit 1;
  if best is not null then return query select 'market'::text, best->>'name', (best->>'no')::int, round(1/(best->>'mk')::numeric,3), (best->>'pi')::numeric, (best->>'mk')::numeric, null::numeric, null::numeric, null::numeric, null::int, null::int, null::text, null::text[], jsonb_build_object('have',have,'ch',best->'ch'); end if;
  -- consensus
  if coalesce(array_length(grp,1),0) >= 3 then
    select x into best from jsonb_array_elements(rs) x order by (x->>'votes')::int desc, (x->>'mob')::numeric desc nulls last, (x->>'nan')::numeric desc limit 1;
    if (best->>'votes')::int >= 2 then return query select 'consensus'::text, best->>'name', (best->>'no')::int, (best->>'mob')::numeric, (best->>'pi')::numeric, (best->>'mk')::numeric, null::numeric, null::numeric, null::numeric, (best->>'votes')::int, array_length(grp,1), null::text, null::text[], jsonb_build_object('have',have,'groups',grp,'ch',best->'ch'); end if;
  end if;
  best := null;
  -- value
  select x into best from jsonb_array_elements(rs) x where x ? 'val' order by (x->>'val')::numeric desc limit 1;
  if best is not null then return query select 'value'::text, best->>'name', (best->>'no')::int, (best->>'pi')::numeric, (best->>'pi')::numeric, (best->>'mk')::numeric, round(1/(best->>'pi')::numeric,2), (best->>'val')::numeric, null::numeric, null::int, null::int, 'value'::text, null::text[], jsonb_build_object('have',have,'inds',inds,'ch',best->'ch'); end if;
  -- bestbets qualifier
  if tm ? 'panel' and coalesce(array_length(have,1),0) >= 3 and (tm ? 'pop' or tm ? 'bob') then
    u := null;
    select x into u from jsonb_array_elements(rs) x where x->>'k' = tops->>'panel';
    if u is not null then
      pp := (u->>'mob')::numeric; v := (u->>'votes')::numeric / greatest(array_length(grp,1),1);
      e := coalesce((u->>'val')::numeric, 0);
      if pp >= .20 and v >= .5 then
        return query select 'bestbets'::text, u->>'name', (u->>'no')::int, pp, (u->>'pi')::numeric, (u->>'mk')::numeric,
          case when (u->>'pi') is not null then round(1/nullif((u->>'pi')::numeric,0),2) end,
          case when (u->>'pi') is not null and (u->>'mk') is not null then round((u->>'pi')::numeric*(u->>'mk')::numeric-1,3) end,
          round(100*(.45*least(pp/.5,1) + .30*v + .15*least(greatest(e,0),.5)/.5 + .10*array_length(have,1)/5.0),1),
          (u->>'votes')::int, array_length(grp,1), 'qualifier'::text, case when e > 0 then array['value'] else '{}'::text[] end, jsonb_build_object('have',have,'groups',grp,'ch',u->'ch');
      end if;
    end if;
  end if;
end $$;

-- dogs/harness market prices from PuntersEdge quick prices (same match as Gran: race number, venue's first word, start within 30 min)
create or replace function otr_quick_mkt(rid text) returns jsonb language sql stable as $$
  with r as (select * from otr_nan_log where id = rid),
  q as (select x from r, otr_race_cache c, jsonb_array_elements(c.payload->'races') x
        where c.day = case r.code when 'D' then 'pe:quick:greyhound' when 'N' then 'pe:quick:harness' end
          and (x->>'n')::int = r.race
          and split_part(regexp_replace(lower(x->>'venue'),'[^a-z]+',' ','g'),' ',1) = split_part(regexp_replace(lower(r.venue),'[^a-z]+',' ','g'),' ',1)
          and abs(extract(epoch from ((x->>'jump')::timestamptz - r.jump))) < 1800 limit 1)
  select coalesce((select jsonb_object_agg(otr_nk(u->>'name'), (u->>'win')::numeric) from q, jsonb_array_elements(q.x->'runners') u where (u->>'win')::numeric > 1), '{}'::jsonb)
$$;

-- The scheduled job: every race jumping in the next 90 minutes, each strategy's pick; a new revision only when it changes.
create or replace function otr_record_strategies() returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; s record; lrev int; lname text; added int := 0; races int := 0; m jsonb;
begin
  for r in select id, code, date, jump from otr_nan_log where jump > now() and jump < now() + interval '90 minutes' loop
    races := races + 1;
    insert into otr_strategy_seen(race_id, code, date, jump) values (r.id, r.code, r.date, r.jump) on conflict do nothing;
    m := case when r.code = 'H' then '{}'::jsonb else otr_quick_mkt(r.id) end;
    for s in select b.st, a.* from (select unnest(array['nan','form','market','consensus','value','bestbets']) st) b
             left join otr_strategy_picks(r.id, m) a on a.strategy = b.st loop
      lrev := null; lname := null;
      select l.rev, l.name into lrev, lname from otr_strategy_log l where l.race_id = r.id and l.strategy = s.st order by l.rev desc limit 1;
      if s.strategy is null then  -- no pick now: withdraw an earlier one
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

-- Settled results: each strategy's last pre-race pick (withdrawn = no bet), judged like the leaderboard ($1 win, official
-- dividends, scratched = refund, abandoned races left out). Dead heats: the dividend paid on that runner when listed.
create or replace view otr_strategy_results as
with last as (
  select distinct on (race_id, strategy) * from otr_strategy_log order by race_id, strategy, rev desc
), g as (
  select s.race_id, s.strategy, s.source, s.mk, s.cat, l.date, l.code,
    ((l.result->'pos')->>otr_nk(s.name))::int pos,
    coalesce((l.result->>'pp')::int, case when l.field >= 8 then 3 when l.field >= 5 then 2 else 1 end) pp,
    exists(select 1 from jsonb_array_elements_text(coalesce(l.result->'scr','[]'::jsonb)) x where otr_nk(x) = otr_nk(s.name)) scr,
    coalesce((select (f->>'win')::numeric from jsonb_array_elements(coalesce(l.result->'fin','[]'::jsonb)) f where (f->>'pos')::int = 1 and otr_nk(f->>'name') = otr_nk(s.name) and (f->>'win') is not null limit 1),
             (select (f->>'win')::numeric from jsonb_array_elements(coalesce(l.result->'fin','[]'::jsonb)) f where (f->>'pos')::int = 1 limit 1)) div
  from last s join otr_nan_log l on l.id = s.race_id
  where s.name is not null and l.settled_at is not null and coalesce(l.result->>'status','') <> 'abandoned'
)
select race_id, strategy, source, date, code, cat, mk,
  case when mk is null then 'na' when mk < 2 then 'a' when mk < 4 then 'b' when mk < 8 then 'c' else 'd' end band,
  scr, pos, coalesce(pos = 1 and not scr, false) won, coalesce(pos <= pp and not scr, false) placed, case when pos = 1 and not scr then coalesce(div, 0) else 0 end back
from g;
revoke all on otr_strategy_results from anon, authenticated;

-- Daily totals for the Strategy Lab. matched = races where nan, form, market and consensus all made a pick.
create or replace view otr_strategy_lab as
with r as (select * from otr_strategy_results where not scr),
m as (select race_id from r where strategy in ('nan','form','market','consensus') group by race_id having count(distinct strategy) = 4)
select date, code, strategy, source, band, (race_id in (select race_id from m)) matched,
  count(*) bets, count(*) filter (where won) won, count(*) filter (where placed) placed, sum(back) back
from r group by 1,2,3,4,5,6;
revoke all on otr_strategy_lab from anon, authenticated;

create or replace view otr_strategy_seen_daily as
select date, code, source, count(*) races from otr_strategy_seen group by 1,2,3;
revoke all on otr_strategy_seen_daily from anon, authenticated;

-- schedule (applied 17 Nov): every 10 minutes, after Nan's log (:x0) and the tipsters' log (:x3)
-- select cron.schedule('otr-strategy-record','7-59/10 * * * *', $$select public.otr_record_strategies()$$);
-- one-off backfill (applied 17 Nov): source = 'backfill' for races 12-17 Nov already run, from tips saved before each race
