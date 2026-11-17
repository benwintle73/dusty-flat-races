// Off To The Races: Nan's Tips Strategy Lab (research only, read-only).
// GET -> { today, rows, seen }
//   rows: settled picks by day, code, strategy, source (live | backfill), price band and matched-race flag (otr_strategy_lab)
//   seen: races the recording job looked at, by day, code and source (for eligibility rates)
const SB = Deno.env.get('SUPABASE_URL')!;
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'content-type': 'application/json', 'cache-control': 'public, max-age=120' };
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const db = (path: string) => fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: SR, authorization: `Bearer ${SR}` } });
const sydney = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(d);
const addDays = (date: string, n: number) => sydney(new Date(Date.parse(date + 'T02:00:00Z') + n * 864e5));
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
    const [rows, seen] = await Promise.all([
      allRows(`otr_strategy_lab?date=gte.${since}&select=*&order=date.desc,code,strategy,source,band,matched`),
      allRows(`otr_strategy_seen_daily?date=gte.${since}&select=*&order=date.desc,code,source`),
    ]);
    return out({ today, rows, seen });
  } catch (e) { console.error(String(e)); return out({ error: 'The Strategy Lab is unavailable right now.' }, 502); }
});
