// Off To The Races: FormFav backup for official results on Nan's page.
// PuntersEdge (the main results feed) misses some meetings entirely (e.g. Mount Isa) and is slow on others, so a bet's
// race can sit on "Waiting on results" for ever. When a race has had no result for 30 minutes after the jump, Nan's page
// asks here. GET ?code=H|D|N&date=YYYY-MM-DD&venue=<the venue as the bet shows it>&race=<n>
//   -> { track, races: [{ n, st: 'final'|'interim'|'abandoned'|'pending', fin: [{no,name,pos,win}], scr: [{no,name}] }] }
// The venue is matched loosely: sponsor names ("Sportsbet", "Ladbrokes", ...) and extra words ("Hillside") don't stop a match.
// FormFav calls are cached in otr_form_cache (meetings list per code and day, results per race), and none are made when
// the shared FormFav allowance guard (ffmeta) says it's running low. Public and read-only; the key stays a server secret.
const SB = Deno.env.get('SUPABASE_URL')!;
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KEY = Deno.env.get('FORMFAV_API_KEY') || '';
const API = 'https://api.formfav.com/v1', FLOOR = 60;
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'content-type': 'application/json' };
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const db = (path: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: SR, authorization: `Bearer ${SR}`, 'content-type': 'application/json', ...(init.headers || {}) } });
const get = async (day: string) => ((await (await db(`otr_form_cache?day=eq.${encodeURIComponent(day)}&select=payload,fetched_at`)).json()) as any[])[0] || null;
const put = (day: string, payload: unknown) => db('otr_form_cache?on_conflict=day', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ day, payload, fetched_at: new Date().toISOString() }) });
const sydney = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(d);
const CODE: Record<string, string> = { H: 'gallops', D: 'greyhounds', N: 'harness' };
// words that are sponsors or decoration, never the place itself
const STOP = new Set(['sportsbet', 'ladbrokes', 'tab', 'tabtouch', 'bet365', 'picklebet', 'neds', 'pointsbet', 'betr', 'unibet', 'palmerbet', 'bluebet', 'topsport', 'playup', 'betfair', 'racing', 'raceway', 'paceway', 'racecourse', 'the', 'at']);
const words = (s: string) => String(s || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(' ').filter((w) => w && !STOP.has(w));

async function ff(path: string) {
  const meta = (await get('ffmeta'))?.payload;
  if (!KEY) throw new Error('no key');
  if (meta && meta.rem < FLOOR && Date.now() < meta.until) throw new Error('allowance');
  const r = await fetch(API + path, { headers: { 'X-API-Key': KEY } });
  const hdr = r.headers.get('X-RateLimit-Remaining-Day'), rem = hdr == null ? NaN : Number(hdr), lim = Number(r.headers.get('X-RateLimit-Limit-Day'));
  if (Number.isFinite(rem)) await put('ffmeta', { ...(meta || {}), rem, limit: Number.isFinite(lim) && lim > 0 ? lim : meta?.limit, until: Date.now() + 5 * 60e3 });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return await r.json();
}

// FormFav's meetings for the day (cached: 15 minutes for today, a day for earlier days)
async function meetings(code: string, date: string, today: string) {
  const key = `ffmeet:${code}:${date}`, row = await get(key), age = row ? Date.now() - Date.parse(row.fetched_at) : Infinity;
  if (row && age < (date < today ? 864e5 : 15 * 60e3)) return row.payload as any[];
  try {
    const j = await ff(`/form/meetings?${new URLSearchParams({ date, race_code: CODE[code], country: 'au' })}`);
    const list = (j?.meetings || []).filter((m: any) => (m.country || 'au') === 'au').map((m: any) => ({ track: m.track, slug: m.slug, abandoned: !!m.abandoned }));
    await put(key, list);
    return list;
  } catch (e) { console.error('meetings', String(e)); return (row?.payload || []) as any[]; }
}
function pick(list: any[], venue: string) {
  const v = new Set(words(venue)), joined = [...v].join('');
  let best: any = null, score = 0;
  for (const m of list) {
    const w = words(m.track); if (!w.length) continue;
    const all = w.every((x) => v.has(x)) || joined.includes(w.join(''));
    if (!all) continue;
    if (w.length > score) { score = w.length; best = m; }
  }
  return best;
}
const done = (st: string) => /final|abandon/i.test(st || '');
function norm(x: any, meetingAbandoned: boolean) {
  const ab = meetingAbandoned || x.abandoned || /abandon/i.test(x.resultStatus || '');
  const st = ab ? 'abandoned' : String(x.resultStatus || 'pending').toLowerCase();
  const pl = x.placings || x.runners || [];
  const fin = ab ? [] : pl.filter((u: any) => u.position != null && Number(u.position) > 0 && !u.scratched && u.outcome !== 'scratched')
    .map((u: any) => ({ no: Number(u.number), name: String(u.name || ''), pos: Number(u.position), win: Number(u.position) === 1 && Number(u.startingPrice) > 0 ? Number(u.startingPrice) : null }))
    .sort((a: any, b: any) => a.pos - b.pos);
  const scr = pl.filter((u: any) => u.scratched || u.outcome === 'scratched').map((u: any) => ({ no: Number(u.number), name: String(u.name || '') }));
  return { n: Number(x.raceNumber), st, fin, scr, sp: true };
}
// one race (FormFav's per-race results), kept once it's final or abandoned, otherwise re-read after 10 minutes
async function result(code: string, date: string, m: any, race: number) {
  const key = `ffres:${code}:${date}:${m.slug}:${race}`, row = await get(key), age = row ? Date.now() - Date.parse(row.fetched_at) : Infinity;
  const old = row?.payload?.race || null;
  if (row && (age < 10 * 60e3 || (old && done(old.st)))) return old;
  try {
    const j = await ff(`/results?${new URLSearchParams({ date, track: m.slug, race: String(race), race_code: CODE[code], country: 'au' })}`);
    if (!j || !(Number(j.raceNumber) > 0)) { await put(key, { race: old }); return old; }
    const got = norm(j, m.abandoned);
    await put(key, { race: got });
    return got;
  } catch (e) { console.error('results', String(e)); return old; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const q = new URL(req.url).searchParams, code = q.get('code') || '', date = q.get('date') || '', venue = q.get('venue') || '', race = Number(q.get('race'));
  const today = sydney(), oldest = sydney(new Date(Date.now() - 7 * 864e5));
  if (!CODE[code] || !/^\d{4}-\d\d-\d\d$/.test(date) || date > today || date < oldest || !venue || venue.length > 80) return out({ error: 'Bad request.' }, 400);
  try {
    const m = pick(await meetings(code, date, today), venue);
    if (!m) return out({ track: null, races: [] });
    if (!(race > 0 && race <= 20)) return out({ error: 'Bad request.' }, 400);
    const r = await result(code, date, m, race);
    return out({ track: m.track, races: r ? [r] : [] });
  } catch (e) {
    console.error(String(e));
    return out({ track: null, races: [], error: 'unavailable' });
  }
});
