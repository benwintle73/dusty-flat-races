// Off To The Races: Nan's Tips Family Tipping Championship.
// GET ?board=1            -> { today, rows: [{ who, kind, date, code, venue, race, jump, runner, mk, pos, pts }] } settled, last 180 days
//                            (family members by leaderboard name; tipsters only in races a family member tipped)
// GET ?code=ABCD-EFGH     -> { name, tips: [{ race_id, name, no, mk, set_at }] } that account's tips from yesterday on
// POST { code, race_id, no }          set or change a tip (locks at the jump, checked by the database)
// POST { code, race_id, clear: true } take a tip back before the jump
// The sync code is the account key and never leaves this function; the board shows names only.
const SB = Deno.env.get('SUPABASE_URL')!;
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'content-type': 'application/json' };
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const db = (path: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: SR, authorization: `Bearer ${SR}`, 'content-type': 'application/json', ...(init.headers || {}) } });
const okCode = (c: unknown) => typeof c === 'string' && /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(c);
const okRace = (r: unknown) => typeof r === 'string' && r.length <= 80 && /^[HDN]\|[A-Za-z0-9_|\-]+$/.test(r);
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
    const u = new URL(req.url), today = sydney();
    if (req.method === 'GET' && u.searchParams.get('board')) {
      const rows = await allRows(`otr_champ_rows?date=gte.${addDays(today, -180)}&select=who,kind,date,code,venue,race,jump,runner,mk,pos,pts&order=jump.asc,who.asc`);
      return out({ today, rows });
    }
    if (req.method === 'GET') {
      const code = u.searchParams.get('code');
      if (!okCode(code)) return out({ error: 'bad code' }, 400);
      const acc = ((await (await db(`otr_bets?code=eq.${code}&select=name`)).json()) as any[])[0];
      const tips = await (await db(`otr_champ_tips?code=eq.${code}&jump=gte.${addDays(today, -1)}T00:00:00&select=race_id,name,no,mk,set_at`)).json();
      return out({ name: acc?.name ?? null, tips: Array.isArray(tips) ? tips : [] });
    }
    if (req.method === 'POST') {
      const b = JSON.parse((await req.text()).slice(0, 2000) || '{}');
      if (!okCode(b.code) || !okRace(b.race_id)) return out({ error: 'bad request' }, 400);
      const no = Number(b.no);
      if (!b.clear && !(Number.isInteger(no) && no > 0 && no < 40)) return out({ error: 'Pick a runner.' }, 400);
      const r = await db('rpc/otr_champ_set', { method: 'POST', body: JSON.stringify({ p_code: b.code, p_race: b.race_id, p_no: b.clear ? 0 : no, p_clear: !!b.clear }) });
      const j = await r.json();
      if (!r.ok) return out({ error: /locked|jumped/i.test(JSON.stringify(j)) ? 'Too late: this race has jumped.' : 'Could not save your tip.' }, r.ok ? 200 : 409);
      return out(j, j && j.error ? 400 : 200);
    }
    return out({ error: 'method' }, 405);
  } catch (e) { console.error(String(e)); return out({ error: 'The championship is unavailable right now.' }, 502); }
});
