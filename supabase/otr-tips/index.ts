// Off To The Races: other tipsters beside Nan, from the model predictions the paid feeds publish.
//  Bob's Tips: Krok's racing predictions model (KrokBot), every AU race of a day in one call per code (1 Krok credit each),
//              refreshed every 30 minutes. Venues are split out only when a code's day overflows Krok's 1,000-row limit.
//  Pop's Tips: FormFav's ML predictions (Pro), one race per call (1 FormFav credit), saved for an hour and never after the jump.
//  Kev's Tips: Uncle Kev asks around. He tips whatever the most tipsters are on: PuntHub's public "Most Tipped" page
//              (tip counts for the day's races still to run, all codes), read at most every 15 minutes from 7am to 11pm
//              and kept for the day, so races stay once they've dropped off the page.
// GET ?date=YYYY-MM-DD                    -> { bob: { 'H|venue|race': [{ name, p, rank }] }, kev: { 'H|venue|race': [{ no, name, n }] }, w: { H: { nan, pop, bob, gran, kev }, ... }, at }
// GET ?picks=YYYY-MM-DD -> { picks: { raceId: { pop: [name, ...], bob, gran, kev, panel } } }
// GET ?board=1 -> each tipster's settled record by day and code (last 60 days); ?record=1 is the cron job.
// GET ?map=H|venue name|race,...          -> { map: { key: { leaders, bias, runners: [{ no, name, style, esi, settle, bar, mf, bf, f }] } | null } }
// GET ?mob=YYYY-MM-DD -> { races: { raceId: { code, venue, race, ch: { name: p }, mk: { name: p }, op: { name: p }, map: [{ name, style, settle }] } } }
//   The Mob's chances for each race (everyone's tips blended), the market now and when we first saw it (who's being backed), and
//   Krok's speed map, kept for races from 90 minutes before the jump. The game runs its simulations of real races off these.
// GET ?pop=H|venue name|race,D|...&date=   -> { pop: { 'H|venue|race': { conf, runners: [{ no, name, p, rank }] } | null } } (12 races at most)
const SB = Deno.env.get('SUPABASE_URL')!;
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KROK = Deno.env.get('KROK_API_KEY') || '';
const FF = Deno.env.get('FORMFAV_API_KEY') || '';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'content-type': 'application/json' };
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const db = (path: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: SR, authorization: `Bearer ${SR}`, 'content-type': 'application/json', ...(init.headers || {}) } });
const get = async (t: string, day: string) => ((await (await db(`${t}?day=eq.${encodeURIComponent(day)}&select=payload,fetched_at`)).json()) as any[])[0] || null;
const put = (t: string, day: string, payload: unknown) => db(`${t}?on_conflict=day`, { method: 'POST', headers: { prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ day, payload, fetched_at: new Date().toISOString() }) });
const sydney = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(d);
const sydHour = () => Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
const addDays = (date: string, n: number) => sydney(new Date(Date.parse(date + 'T02:00:00Z') + n * 864e5));
const vk = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const age = (row: any) => row ? Date.now() - Date.parse(row.fetched_at) : Infinity;
const CODES: [string, string][] = [['H', 'thoroughbred'], ['D', 'greyhound'], ['N', 'harness']];

async function krok(path: string) {
  const r = await fetch(`https://krokodds.com.au/api/v1${path}`, { headers: { 'X-API-Key': KROK } });
  const left = r.headers.get('x-credits-remaining');
  if (left !== null && Number.isFinite(Number(left))) {
    const meta = (await get('otr_race_cache', 'meta'))?.payload || {};
    await put('otr_race_cache', 'meta', { ...meta, rem: Number(left), reset: r.headers.get('x-credits-reset') || meta.reset, limit: Number(r.headers.get('x-credits-limit')) || meta.limit });
  }
  if (!r.ok) throw new Error(`krok ${r.status}`);
  return await r.json();
}
async function bob(date: string) {
  const key = `tips:bob:${date}`, row = await get('otr_race_cache', key);
  if (row && age(row) < 30 * 60e3) return row.payload;
  const meta = (await get('otr_race_cache', 'meta'))?.payload;
  if (!KROK || (meta && Number(meta.rem) < 400)) return row?.payload || { races: {} };
  const races: Record<string, any[]> = {};
  // Krok can hold a race under two ids (two model runs); each race keeps the fullest set, the one adding up closest to 100%
  const groups: Record<string, Record<string, any[]>> = {};
  const add = (rows: any[], c: string) => { for (const x of rows || []) { const k = `${c}|${vk(x.venue)}|${x.race_no}`, id = String(x.id || ''), g = id.includes('_') ? id.slice(0, id.lastIndexOf('_')) : 'x';
    ((groups[k] ||= {})[g] ||= []).push({ name: x.horse_name, p: r3(Number(x.win_probability) || 0), rank: x.model_rank, agree: x.ensemble_agreement_count ?? null, pick: x.ensemble_pick ?? null }); } };
  try {
    for (const [c, code] of CODES) {
      const j = await krok(`/racing/predictions?date=${date}&code=${code}&limit=1000`), rows = j.data || [];
      if (rows.length < 1000) { add(rows, c); continue; }
      // a full day overflowed: ask venue by venue so every runner is there
      const vs = [...new Set(rows.map((x: any) => String(x.venue)))];
      for (let i = 0; i < vs.length; i += 8) await Promise.all(vs.slice(i, i + 8).map(async (v) => {
        try { add((await krok(`/racing/predictions?date=${date}&code=${code}&venue=${encodeURIComponent(v)}&limit=1000`)).data || [], c); } catch { /* keep the rest */ }
      }));
    }
  } catch (e) { console.error('bob', String(e)); if (row?.payload) return row.payload; }
  for (const k in groups) {
    const sets = Object.values(groups[k]).map((g) => { const seen = new Set<string>(); return g.filter((u) => !seen.has(u.name) && seen.add(u.name)); });
    sets.sort((a, b) => b.length - a.length || Math.abs(a.reduce((t, u) => t + u.p, 0) - 1) - Math.abs(b.reduce((t, u) => t + u.p, 0) - 1));
    races[k] = sets[0].sort((a, b) => b.p - a.p);
  }
  const payload = { races, at: new Date().toISOString() };
  if (Object.keys(races).length) await put('otr_race_cache', key, payload);
  return payload;
}

/* ---------- Kev: the most-tipped runners, from PuntHub's public Most Tipped page ---------- */
const PH = 'https://punthub.com.au/tips/most-tipped';
const PH_CODE: Record<string, string> = { thoroughbred: 'H', greyhound: 'D', harness: 'N' };
const unent = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
// the page: <h2>Wyong · NSW · thoroughbred</h2> ... <a href="/racing/wyong/race-7">1. Jaguar Paw</a><span>9 tips · R7 · ...</span>
function parseMostTipped(html: string, date: string) {
  const day = html.match(/Australian racing day:\s*<time datetime="(\d{4}-\d\d-\d\d)"/);
  if (!day || day[1] !== date) return null;
  const races: Record<string, any[]> = {};
  for (const part of html.split(/<h2\b/).slice(1)) {
    const h = part.match(/^[^>]*>([^<]+)<\/h2>/); if (!h) continue;
    const bits = unent(h[1]).split('·').map((s) => s.trim()), c = PH_CODE[(bits[2] || '').toLowerCase()];
    if (!c || !bits[0]) continue;
    const re = /href="\/racing\/[a-z0-9-]+\/race-(\d+)"[^>]*>\s*(\d+)\.\s*([^<]+)<\/a>\s*<span[^>]*>\s*(\d+)\s*tips?\b/g;
    for (const m of part.matchAll(re)) {
      const k = `${c}|${vk(bits[0])}|${+m[1]}`;
      (races[k] ||= []).push({ no: +m[2], name: unent(m[3]), n: +m[4] });
    }
  }
  for (const k in races) races[k].sort((a, b) => b.n - a.n);
  return races;
}
async function kev(date: string) {
  const key = `tips:kev:${date}`, row = await get('otr_race_cache', key), h = sydHour();
  if (date !== sydney() || (row && age(row) < 15 * 60e3) || h < 7 || h >= 23) return row?.payload || { races: {} };
  try {
    const r = await fetch(PH, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; NansTips/1.0; private family racing game)', accept: 'text/html' } });
    if (!r.ok) throw new Error(`punthub ${r.status}`);
    const got = parseMostTipped(await r.text(), date);
    if (!got) throw new Error('punthub page not for today');
    // races drop off the page once they've jumped: keep what was there before, newest counts win
    const races = { ...(row?.payload?.races || {}), ...got };
    const payload = { races, at: new Date().toISOString() };
    await put('otr_race_cache', key, payload);
    return payload;
  } catch (e) {
    console.error('kev', String(e));
    await put('otr_race_cache', key, row?.payload || { races: {} }); // wait another 15 minutes before trying again
    return row?.payload || { races: {} };
  }
}
// Kev's chances: each runner's share of the tips in its race
const kevChances = (list: any[] | null | undefined) => (list || []).filter((u) => u.n > 0).map((u) => ({ name: u.name, p: u.n }));

async function ffPred(date: string, code: string, track: string, race: number) {
  const rc = code === 'H' ? 'gallops' : code === 'D' ? 'greyhounds' : 'harness';
  const r = await fetch(`https://api.formfav.com/v1/predictions?${new URLSearchParams({ date, track, race: String(race), race_code: rc, country: 'au' })}`, { headers: { 'X-API-Key': FF } });
  const rem = r.headers.get('X-RateLimit-Remaining-Day'), lim = Number(r.headers.get('X-RateLimit-Limit-Day'));
  if (rem !== null && Number.isFinite(Number(rem))) await put('otr_form_cache', 'ffmeta', { rem: Number(rem), limit: lim > 0 ? lim : undefined, until: Date.now() + 5 * 60e3 });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`formfav ${r.status}`);
  const j = await r.json();
  const list = j.predictions || j.data?.predictions || [];
  if (!list.length) return null;
  return { conf: j.confidence || j.data?.confidence || null, runners: list.map((u: any) => ({ no: u.number, name: u.name, p: r3(Number(u.winProb) || 0), rank: u.modelRank })).sort((a: any, b: any) => b.p - a.p) };
}
async function pop(date: string, spec: string) {
  const ff = (await get('otr_form_cache', 'ffmeta'))?.payload;
  const items = spec.split(',').slice(0, 12).map((s) => s.split('|')).filter((p) => p.length === 3 && ['H', 'D', 'N'].includes(p[0]) && /^[A-Za-z0-9 '\-]{2,40}$/.test(p[1]) && +p[2] > 0 && +p[2] < 25);
  const res: Record<string, any> = {};
  await Promise.all(items.map(async ([c, track, n]) => {
    const k = `${c}|${vk(track)}|${n}`, day = `pop:${date}:${k}`, row = await get('otr_form_cache', day);
    if (row && (age(row) < 60 * 60e3 || row.payload?.jumped)) { res[k] = row.payload?.data ?? null; return; }
    if (!FF || (ff && Number(ff.rem) < 500 && Date.now() < Number(ff.until || 0))) { res[k] = row?.payload?.data ?? null; return; }
    try { const data = await ffPred(date, c, track.toLowerCase(), +n); await put('otr_form_cache', day, { data }); res[k] = data; }
    catch (e) { console.error('pop', k, String(e)); res[k] = row?.payload?.data ?? null; }
  }));
  return res;
}

/* ---------- Krok's speed maps and barrier bias (field-form, 5 credits a race, fetched once and kept) ----------
   Each runner gets a factor Bob's chances are multiplied by: running style from the speed map (leaders and on-pace runners
   are favoured, less so when three or more want the lead, when backmarkers gain), times how its barrier or box has fared
   at this track. Spending is held to the day's share of Krok's monthly credits (shared with the dog-form fallback). */
const STYLE: Record<string, Record<string, number>> = { H: { L: 1.12, P: 1.08, M: 1, B: .92 }, N: { L: 1.35, P: 1.12, M: .92, B: .8 }, D: {} };
const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
async function kmapOne(date: string, c: string, venue: string, n: number) {
  const type = c === 'H' ? 'T' : c === 'D' ? 'G' : 'H', slug = venue.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const j = await krok(`/racing/field-form?race_id=${encodeURIComponent(`${date}_${slug}_${type}_${n}`)}`);
  const rs = ((j.data || {}).runners || []).filter((u: any) => !u.scratched); if (rs.length < 3) return null;
  const nL = rs.filter((u: any) => u.speed_map?.running_style === 'L').length;
  const tb = rs[0].track_bias, bs = (tb?.barrier_stats || []) as any[], bar = (u: any) => c === 'D' ? (u.barrier ?? u.tab_number) : u.barrier;
  const used = bs.filter((b) => rs.some((u: any) => bar(u) === b.barrier)), avg = used.length ? used.reduce((a, b) => a + b.win_rate, 0) / used.length : 0;
  const biasOk = bs.length >= 4 && Number(tb?.total_races) >= 150 && avg > 0;
  return { leaders: nL, bias: biasOk, runners: rs.map((u: any) => {
    const st = u.speed_map?.running_style || null; let mf = (STYLE[c] || {})[st] ?? 1;
    if (st === 'L' && nL >= 3) mf = 1 + (mf - 1) / (nL - 1);
    if (st === 'L' && nL === 1) mf *= 1.05;
    if (st === 'B' && nL >= 3) mf += .04 * (nL - 2);
    const b = biasOk ? bs.find((x) => x.barrier === bar(u)) : null, bf = b ? clampN(1 + ((b.win_rate - avg) / avg) * .5, .8, 1.2) : 1;
    return { no: u.tab_number, name: u.name, style: st, esi: u.speed_map?.early_speed_index ?? null, settle: u.speed_map?.settling_position ?? null, bar: bar(u) ?? null, mf: r3(mf), bf: r3(bf), f: r3(mf * bf) };
  }) };
}
async function kmap(date: string, spec: string) {
  const items = spec.split(',').slice(0, 12).map((s) => s.split('|')).filter((p) => p.length === 3 && ['H', 'D', 'N'].includes(p[0]) && /^[A-Za-z0-9 '\-]{2,40}$/.test(p[1]) && +p[2] > 0 && +p[2] < 25);
  const res: Record<string, any> = {}, todo: [string, string[]][] = [];
  await Promise.all(items.map(async (it) => {
    const k = `${it[0]}|${vk(it[1])}|${it[2]}`, row = await get('otr_form_cache', `kmap:${date}:${k}`);
    if (row && (row.payload?.data || age(row) < 90 * 60e3)) res[k] = row.payload?.data ?? null; else todo.push([k, it]);
  }));
  if (!todo.length || !KROK) return res;
  const meta = (await get('otr_race_cache', 'meta'))?.payload, rem = Number(meta?.rem);
  const reset = meta?.reset ? Date.parse(meta.reset) : (() => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); })();
  const share = Number.isFinite(rem) ? (rem - 300) / Math.max(1, (reset - Date.now()) / 864e5) : 0;
  const spent = Number((await get('otr_form_cache', `kfspent:${date}`))?.payload?.n) || 0;
  const go = todo.slice(0, Math.max(0, Math.floor((share - spent) / 5)));
  if (go.length) await put('otr_form_cache', `kfspent:${date}`, { n: spent + 5 * go.length });
  await Promise.all(go.map(async ([k, it]) => {
    let data: any = null; try { data = await kmapOne(date, it[0], it[1], +it[2]); } catch (e) { console.error('kmap', k, String(e)); }
    await put('otr_form_cache', `kmap:${date}:${k}`, { data }); res[k] = data;
  }));
  return res;
}
// Bob's chances with the speed map and barrier factors applied
function bobWith(list: any[] | null, km: any) {
  if (!list || !km?.runners) return list;
  const f = new Map<string, number>(km.runners.map((u: any) => [nm(u.name), u.f]));
  const adj = list.map((u) => ({ ...u, p: u.p * (f.get(nm(u.name)) ?? 1) })), t = adj.reduce((a, u) => a + u.p, 0) || 1;
  return adj.map((u) => ({ ...u, p: r3(u.p / t) })).sort((a, b) => b.p - a.p);
}

/* ---------- The Panel's weights: each tipster's say earned from settled results, updated race by race ----------
   Every settled race in the last 3 days counts, newest first, each one worth a little less than the one after it (a race
   40 races back in the same code counts half as much as the latest). A tipster's strike rate is pulled toward the code's
   average by 5 phantom races so one lucky result doesn't swing it, then cubed so the better judges count for clearly more.
   Worked out afresh every 5 minutes, so each new result moves it. Shared with the page (?date=), so the Panel on the race
   cards and the Panel the leaderboard settles are worked out the same way. */
const PANEL = ['nan', 'pop', 'bob', 'gran', 'kev'];
async function weights(fresh = false) {
  const row = await get('otr_race_cache', 'panel:w');
  if (!fresh && row && age(row) < 5 * 60e3) return row.payload;
  const since = addDays(sydney(), -3);
  const races = await (await db(`otr_nan_log?date=gte.${since}&settled_at=not.is.null&select=id,code,settled_at,top:picks->0->>name,pos:result->pos,scr:result->scr,status:result->>status&order=settled_at.desc&limit=3000`)).json() as any[];
  const tips = await (await db(`otr_tipster_log?recorded_at=gte.${since}T00:00:00&who=neq.panel&select=id,who,name&limit=20000`)).json() as any[];
  const by = new Map<string, Record<string, string>>();
  for (const t of tips || []) (by.get(t.id) || by.set(t.id, {}).get(t.id)!)[t.who] = t.name;
  const w: Record<string, Record<string, number>> = {};
  for (const [c] of CODES) {
    const t: Record<string, { b: number; n: number }> = {}; let i = 0;
    for (const r of races || []) {
      if (r.code !== c || r.status === 'abandoned' || !r.pos) continue;
      const d = 0.5 ** (i++ / 40), scr = new Set(((r.scr || []) as string[]).map(nm)), picks: Record<string, string> = { nan: r.top, ...(by.get(r.id) || {}) };
      for (const who of PANEL) { const k = nm(picks[who]); if (!k || scr.has(k)) continue; const x = (t[who] ||= { b: 0, n: 0 }); x.b += d; if (+r.pos[k] === 1) x.n += d; }
    }
    const B = Object.values(t).reduce((a, x) => a + x.b, 0), avg = B ? Object.values(t).reduce((a, x) => a + x.n, 0) / B : .3;
    w[c] = Object.fromEntries(PANEL.map((who) => { const x = t[who] || { b: 0, n: 0 }; return [who, r3(((x.n + 5 * avg) / (x.b + 5) / (avg || .3)) ** 3)]; }));
  }
  await put('otr_race_cache', 'panel:w', w);
  return w;
}
// a tipster's chances spread over the runners in Nan's field (names matched loosely), adding to 1
function spread(list: any[] | null | undefined, field: Set<string>) {
  const m = new Map<string, number>();
  for (const u of list || []) { const k = nm(u.name); if (field.has(k) && Number(u.p) > 0) m.set(k, (m.get(k) || 0) + Number(u.p)); }
  const s = [...m.values()].reduce((a, v) => a + v, 0); if (!m.size || s <= 0) return null;
  for (const [k, v] of m) m.set(k, v / s);
  return m;
}
// each tipster's top four (four from 15 November, for the First 4 on the Results page; the leaderboard reads the first three)
const top3 = (m: Map<string, number>, names: Map<string, string>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, p]) => ({ name: names.get(k) || k, p: r3(p) }));

// Every 10 minutes (pg_cron, x-nan-key) each tipster's top three picks are saved for races jumping in the next 90 minutes,
// against the race Nan logged (otr_nan_log), and kept updating until the jump. The Panel is saved beside them: the weighted
// average of everyone's chances. The leaderboard (otr_tipster_board) settles them from the same official results Nan is
// judged on: level $1 win bets on each top pick, and how the 2nd and 3rd picks ran.
const nm = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const first = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(' ')[0];
// a tipster's races are keyed code|venue|race; venues are matched exactly first, then by their first word
const raceOf = (b: Record<string, any>, r: any) => b[`${r.code}|${vk(r.venue)}|${r.race}`] || Object.entries(b).find(([k]) => { const [c, v, n] = k.split('|'); return c === r.code && +n === +r.race && v.startsWith(first(r.venue)); })?.[1] || null;
async function record() {
  const today = sydney(), now = Date.now();
  const rows = await (await db(`otr_nan_log?date=eq.${today}&jump=gt.${new Date(now).toISOString()}&jump=lt.${new Date(now + 90 * 60e3).toISOString()}&select=id,code,venue,race,picks`)).json() as any[];
  if (!rows.length) return { races: 0 };
  const b = (await bob(today)).races || {}, save: any[] = [], W = await weights(true);
  let kv: Record<string, any> = {}; try { kv = (await kev(today)).races || {}; } catch (e) { console.error('kev', String(e)); }
  const mob: Record<string, any> = (await get('otr_race_cache', `mob:${today}`))?.payload?.races || {};
  const quick: Record<string, any[]> = { D: (await get('otr_race_cache', 'pe:quick:greyhound'))?.payload?.races || [], N: (await get('otr_race_cache', 'pe:quick:harness'))?.payload?.races || [] };
  for (let i = 0; i < rows.length; i += 12) {
    const part = rows.slice(i, i + 12);
    const spec = part.map((r) => `${r.code}|${String(r.venue).replace(/[^A-Za-z0-9 '\-]/g, '')}|${r.race}`).join(',');
    const pp = await pop(today, spec);
    let km: Record<string, any> = {}; try { km = await kmap(today, spec); } catch (e) { console.error('kmap', String(e)); }
    for (const r of part) {
      const at = new Date().toISOString(), names = new Map<string, string>((r.picks || []).map((x: any) => [nm(x.name), x.name])), field = new Set(names.keys());
      const key = `${r.code}|${vk(String(r.venue).replace(/[^A-Za-z0-9 '\-]/g, ''))}|${r.race}`;
      // Gran follows the money: horses carry the market in Nan's field, dogs and harness read PuntersEdge's market
      let mkt = (r.picks || []).filter((x: any) => Number(x.mk) > 1).map((x: any) => ({ name: x.name, p: 1 / x.mk }));
      if (r.code !== 'H') {
        const qr = (quick[r.code] || []).find((x: any) => +x.n === +r.race && first(x.venue) === first(r.venue));
        mkt = (qr?.runners || []).filter((u: any) => Number(u.win) > 1).map((u: any) => ({ name: u.name, p: 1 / u.win }));
      }
      const ch: Record<string, Map<string, number> | null> = {
        nan: spread(r.picks, field), pop: spread(pp[key]?.runners, field), bob: spread(bobWith(raceOf(b, r), km[key]), field), gran: mkt.length >= 2 ? spread(mkt, field) : null,
        kev: spread(kevChances(raceOf(kv, r)), field),
      };
      for (const who of ['pop', 'bob', 'gran', 'kev']) { const m = ch[who]; if (!m) continue; const t = top3(m, names); save.push({ id: r.id, who, name: t[0].name, p: t[0].p, top: t, recorded_at: at }); }
      // the Panel: everyone's chances averaged, each tipster weighted by how their picks have gone in this code
      const ws = W[r.code] || {}, have = PANEL.filter((w) => ch[w]);
      if (have.length >= 2) {
        const tot = new Map<string, number>(), sw = have.reduce((a, w) => a + (ws[w] ?? 1), 0) || 1;
        for (const w of have) for (const [k, v] of ch[w]!) tot.set(k, (tot.get(k) || 0) + v * (ws[w] ?? 1) / sw);
        const t = top3(tot, names); save.push({ id: r.id, who: 'panel', name: t[0].name, p: t[0].p, top: t, recorded_at: at });
      }
      // for the game: The Mob's chances for every runner, the market now and first seen, and the speed map
      {
        const ob = (m: Map<string, number> | null) => m ? Object.fromEntries([...m].map(([k, v]) => [names.get(k) || k, r3(v)])) : null;
        let mc: Map<string, number> | null = null;
        if (have.length) { mc = new Map(); const sw = have.reduce((a, w) => a + (ws[w] ?? 1), 0) || 1; for (const w of have) for (const [k, v] of ch[w]!) mc.set(k, (mc.get(k) || 0) + v * (ws[w] ?? 1) / sw); }
        const mk = ob(ch.gran), prev = mob[r.id];
        mob[r.id] = { code: r.code, venue: r.venue, race: r.race, ch: ob(mc), mk, op: prev?.op || mk, map: (km[key]?.runners || []).map((u: any) => ({ name: u.name, style: u.style, settle: u.settle })), at };
      }
    }
  }
  if (save.length) await db('otr_tipster_log?on_conflict=id,who', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(save) });
  await put('otr_race_cache', `mob:${today}`, { races: mob });
  return { races: rows.length, saved: save.length };
}
// each tipster's saved picks for a day's races, best first (top 3 from 14 November, top pick only before), for "If you'd backed..."
async function picksFor(date: string) {
  const rows = await (await db(`otr_tipster_log?id=like.*${date}*&select=id,who,name,top&limit=20000`)).json() as any[];
  const res: Record<string, Record<string, string[]>> = {};
  for (const r of rows || []) (res[r.id] ||= {})[r.who] = Array.isArray(r.top) && r.top.length ? r.top.map((x: any) => x?.name).filter(Boolean) : [r.name];
  return res;
}
async function board() {
  const since = addDays(sydney(), -60);
  return await (await db(`otr_tipster_board?date=gte.${since}&select=*&order=date.desc`)).json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const q = new URL(req.url).searchParams, today = sydney(), date = q.get('date') || today;
  if (q.get('picks')) { const d = q.get('picks')!; if (!/^\d{4}-\d\d-\d\d$/.test(d) || d < addDays(today, -60) || d > today) return out({ error: 'Bad date.' }, 400); try { return out({ picks: await picksFor(d) }); } catch (e) { console.error(String(e)); return out({ error: 'Picks are unavailable right now.' }, 502); } }
  if (!q.get('record') && !q.get('board') && !/^\d{4}-\d\d-\d\d$/.test(date) || date < addDays(today, -1) || date > addDays(today, 1)) return out({ error: 'Bad date.' }, 400);
  try {
    if (q.get('record')) {
      const want = (await get('otr_race_cache', 'nan:key'))?.payload?.k;
      if (!want || req.headers.get('x-nan-key') !== want) return out({ error: 'Not allowed.' }, 403);
      return out(await record());
    }
    if (q.get('board')) return out({ today, rows: await board() });
    if (q.get('mob')) { const d = /^\d{4}-\d\d-\d\d$/.test(q.get('mob')!) ? q.get('mob')! : date; return out({ races: (await get('otr_race_cache', `mob:${d}`))?.payload?.races || {} }); }
    if (q.get('pop')) return out({ pop: await pop(date, q.get('pop')!) });
    if (q.get('map')) return out({ map: await kmap(date, q.get('map')!) });
    let w = null; try { w = await weights(); } catch (e) { console.error('weights', String(e)); }
    let k: any = {}; try { k = (await kev(date)).races || {}; } catch (e) { console.error('kev', String(e)); }
    return out({ bob: (await bob(date)).races || {}, kev: k, w });
  } catch (e) { console.error(String(e)); return out({ error: 'Tips are unavailable right now.' }, 502); }
});
