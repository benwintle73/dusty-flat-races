-- v2.54.0: the leaderboard's settled top picks split by the pick's pre-race market price (horses) and favourite or not.
create or replace view otr_tipster_bands as
with t as (
  select l.id,'nan'::text who,(l.picks->0)->>'name' name from otr_nan_log l
  union all select x.id,x.who,x.name from otr_tipster_log x),
g as (
  select l.date,l.code,t.who,k.key,((l.result->'pos')->>k.key)::int pos,
   coalesce((l.result->>'pp')::int, case when l.field>=8 then 3 when l.field>=5 then 2 else 1 end) pp,
   exists(select 1 from jsonb_array_elements_text(coalesce(l.result->'scr','[]'::jsonb)) s(v) where regexp_replace(lower(s.v),'[^a-z0-9]','','g')=k.key) scr,
   (select (f.value->>'win')::numeric from jsonb_array_elements(coalesce(l.result->'fin','[]'::jsonb)) f(value) where (f.value->>'pos')::int=1 limit 1) div,
   (select (p->>'mk')::numeric from jsonb_array_elements(l.picks) p where regexp_replace(lower(p->>'name'),'[^a-z0-9]','','g')=k.key and (p->>'mk')::numeric>1 limit 1) mk,
   (select min((p->>'mk')::numeric) from jsonb_array_elements(l.picks) p where (p->>'mk')::numeric>1) fmk
  from t join otr_nan_log l on l.id=t.id
  cross join lateral (select regexp_replace(lower(t.name),'[^a-z0-9]','','g') key) k
  where l.settled_at is not null and coalesce(l.result->>'status','')<>'abandoned')
select date, code, who,
  case when mk is null then 'na' when mk<2 then 'a' when mk<4 then 'b' when mk<8 then 'c' else 'd' end as band,
  case when mk is null then null else mk<=fmk end as fav,
  count(*) as bets, count(*) filter (where pos=1) as won, count(*) filter (where pos<=pp) as placed,
  coalesce(sum(case when pos=1 then coalesce(div,0) else 0 end),0) as back
from g where not scr group by 1,2,3,4,5;
revoke all on otr_tipster_bands from anon, authenticated;
