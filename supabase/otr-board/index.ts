// Off To The Races: the tipster leaderboard's data for Nan's Tips.
// GET -> { today, rows, bands, recent }
//   rows:  each tipster's settled top-pick record by day and code (otr_tipster_board), last 180 days
//   bands: the same settled top picks split by the pick's market price when it was tipped and whether it was the favourite
//          (otr_tipster_bands). Horses only carry a saved pre-race price; dogs and harness come back as band "na".
//          band: a under $2, b $2-$4, c $4-$8, d $8 and over, na no saved price
//   recent: each tipster's settled top picks from the last 3 days, oldest first, for the banter (otr_tipster_recent)
const SB = Deno.env.get('SUPABASE_URL')!;
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'content-type': 'application/json', 'cache-control': 'public, max-age=60' };
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const db = (path: string) => fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: SR, authorization: `Bearer ${SR}` } });
const sydney = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(d);
const addDays = (date: string, n: number) => sydney(new Date(Date.parse(date + 'T02:00:00Z') + n * 864e5));
// the database hands back at most 1,000 rows a call, so longer periods are read a page at a time
async function allRows(path: string) {
  const res: any[] = [];
  for (let off = 0; off < 50000; off += 1000) {
    const page = await (await db(`${path}&limit=1000&offset=${off}`)).json();
    if (!Array.isArray(page)) throw new Error('read failed');
    res.push(...page); if (page.length < 1000) break;
  }
  return res;
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const today = sydney(), since = addDays(today, -180);
    const [rows, bands, recent] = await Promise.all([
      allRows(`otr_tipster_board?date=gte.${since}&select=*&order=date.desc,code,who`),
      allRows(`otr_tipster_bands?date=gte.${since}&select=*&order=date.desc,code,who,band,fav`).catch((e) => { console.error('bands', String(e)); return null; }),
      allRows(`otr_tipster_recent?select=who,race_id,jump,code,venue,race,runner,pos,scr,mk,fmk&order=jump.asc,who.asc`).catch((e) => { console.error('recent', String(e)); return null; }),
    ]);
    return out({ today, rows, bands, recent });
  } catch (e) { console.error(String(e)); return out({ error: 'The leaderboard is unavailable right now.' }, 502); }
});
