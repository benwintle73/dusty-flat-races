// Off To The Races: real Australian thoroughbred cards, prices, scratchings and results from PuntersEdge.
// Public and read-only. Same response shape as otr-races (Krok), which the game keeps as a fallback.
// ?quick=greyhound|harness gives quick form for every upcoming dog or harness race (the backup when FormFav runs out),
// with Krok's price-only cards as the next backup when PuntersEdge can't refresh.
// ?lite=today|tomorrow (Nan's Tips) gives just that day's card and its results, without the copy of today's meetings
// the game reads (a fraction of the size); without it the reply is unchanged.
// Every upstream call is made lazily when a player asks, at most once per interval. The intervals follow the budget:
// k = 45 / (credits left per day until the reset on the 1st), kept between 0.1 and 8. A big plan (Plus: 140,000 a month)
// gives k = 0.1: cards every 18 minutes, results every 3, quick form every 12. A thin month stretches them up to 8x.
const SB = Deno.env.get('SUPABASE_URL')!;
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KEY = Deno.env.get('PUNTERSEDGE_API_KEY') || '';
const PE = 'https://api.puntersedge.online';
const KROK = Deno.env.get('KROK_API_KEY') || '';
const KROK_API = 'https://krokodds.com.au/api/v1';
const KROK_FLOOR = 10;
const CARD_EVERY = 3 * 3600e3, RES_EVERY = 30 * 60e3, RES_COOLDOWN = 10 * 60e3, OLD_RES_EVERY = 3 * 3600e3, FLOOR = 25;
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
const db = (path: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: SR, authorization: `Bearer ${SR}`, 'content-type': 'application/json', ...(init.headers || {}) } });
const put = (day: string, payload: unknown) => db('otr_race_cache?on_conflict=day', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ day, payload, fetched_at: new Date().toISOString() }) });
const sydney = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(d);
const sydHour = () => Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
const addDays = (date: string, n: number) => sydney(new Date(Date.parse(date + 'T02:00:00Z') + n * 864e5));
const slug = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const title = (s: string) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bMc([a-z])/g, (_m, c) => 'Mc' + c.toUpperCase());
const METRO = /flemington|caulfield|moonee|sandown|randwick|rosehill|canterbury|warwick farm|eagle farm|doomben|morphettville|ascot|belmont/i;

// Racing Australia publishes local start times; the venue's state gives the time zone.
const STATES: [string, RegExp][] = [
  ['QLD', /eagle farm|doomben|gold coast|sunshine coast|ipswich|toowoomba|rockhampton|callaghan|townsville|cluden|cairns|mackay|beaudesert|gatton|dalby|kilcoy|bundaberg|caloundra|aquis|emerald|longreach|roma|goondiwindi|warwick$|stanthorpe|kingaroy|gympie|chinchilla|mount isa|charleville|innisfail|atherton|bowen|home hill|ingham|julia creek|cunnamulla|st george|thangool|yeppoon|esk|nanango|tara|wondai|mareeba|cooktown|clermont|barcaldine|blackall|winton|birdsville|bedourie|boulia|quilpie|tambo|augathella|morven|mitchell|injune|taroom|eidsvold|mount perry|gayndah|monto|biloela|moranbah|nebo|collinsville|proserpine|tully|burdekin/i],
  ['SA', /morphettville|murray bridge|gawler|balaklava|strathalbyn|port lincoln|oakbank|mount gambier|mt gambier|bordertown|naracoorte|port augusta|clare|penola|kimba|ceduna|roxby|quorn|jamestown|hawker|millicent|lucindale|kingscote|streaky bay|port pirie|bool lagoon|tumby bay|cummins/i],
  ['WA', /ascot|belmont|pinjarra|bunbury|northam|kalgoorlie|geraldton|albany|york|narrogin|esperance|broome|carnarvon|port hedland|roebourne|toodyay|mount barker|mt barker|kojonup|katanning|lark hill|kununurra|derby|fitzroy|landor|leinster|laverton|meekatharra|mount magnet|mt magnet|norseman|wiluna|marble bar|nullagine|onslow|exmouth|newman|collie|manjimup|moora|beverley|dongara|wyndham|halls creek/i],
  ['NT', /darwin|fannie bay|alice springs|pioneer park|katherine|tennant creek|adelaide river|pine creek|barrow creek|renner springs|mataranka|timber creek|daly waters/i],
  ['TAS', /hobart|elwick|launceston|mowbray|devonport|spreyton|longford|king island|flinders island|deloraine/i],
  ['ACT', /canberra|thoroughbred park/i],
  ['VIC', /flemington|caulfield|moonee|sandown|mornington|cranbourne|pakenham|geelong|ballarat|bendigo|kilmore|seymour|wangaratta|wodonga|benalla|echuca|swan hill|mildura|horsham|ararat|stawell|warrnambool|hamilton|casterton|colac|camperdown|terang|sale|moe|bairnsdale|stony creek|yarra glen|yarra valley|kyneton|donald|st arnaud|great western|avoca|edenhope|coleraine|penshurst|dunkeld|hanging rock|tatura|towong|corryong|healesville|burrumbeet|balnarring|merton|mansfield|alexandra|wycheproof|bunyip|traralgon|warracknabeal|nhill|murtoa|kerang|tocumwal|cobram|benambra|omeo|buchan|woolamai|drouin|pakenham/i],
];
const TZ: Record<string, string> = { QLD: 'Australia/Brisbane', SA: 'Australia/Adelaide', WA: 'Australia/Perth', NT: 'Australia/Darwin', TAS: 'Australia/Hobart', ACT: 'Australia/Sydney', VIC: 'Australia/Melbourne', NSW: 'Australia/Sydney' };
const stateOf = (venue: string) => (STATES.find(([, re]) => re.test(venue)) || ['NSW'])[0];
function toUtc(date: string, local: string, tz: string) {
  const m = String(local || '').match(/(\d{1,2}):(\d{2})\s*([AP]M)?/i);
  if (!m) return null;
  let h = Number(m[1]) % 12; if ((m[3] || '').toUpperCase() === 'PM') h += 12; if (!m[3] && Number(m[1]) === 12) h = 12;
  const guess = Date.parse(`${date}T${String(h).padStart(2, '0')}:${m[2]}:00Z`);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asLocal = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
  return new Date(guess - (asLocal - guess)).toISOString();
}

let meta: { rem: number; reset?: string; limit?: number } | null = null;
async function pe(path: string) {
  const r = await fetch(PE + path, { headers: { 'X-API-Key': KEY } });
  const rem = Number(r.headers.get('x-credits-remaining'));
  const lim = Number(r.headers.get('x-credits-limit'));
  if (Number.isFinite(rem)) { meta = { rem, limit: Number.isFinite(lim) && lim > 0 ? lim : meta?.limit }; await put('pe:meta', meta); }
  if (r.status === 402) throw new Error('budget');
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return await r.json();
}
// Credits reset on the 1st (UTC). Stretch every interval when the daily share runs thin, shorten it when there's plenty.
function slow() {
  if (!meta) return 1;
  const now = new Date(), next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const days = Math.max(1, (next - now.getTime()) / 864e5), perDay = meta.rem / days;
  return Math.min(8, Math.max(0.1, 45 / Math.max(1, perDay)));
}
async function claim(name: string) {
  const r = await db('otr_race_cache?on_conflict=day', { method: 'POST', headers: { prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ day: `pe:lock:${name}`, payload: null }) });
  if ((await r.json()).length) return true;
  const old = (await (await db(`otr_race_cache?day=eq.pe:lock:${name}&select=fetched_at`)).json() as any[])[0];
  if (old && Date.now() - Date.parse(old.fetched_at) > 120e3) { await release(name); return claim(name); }
  return false;
}
const release = (name: string) => db(`otr_race_cache?day=eq.pe:lock:${name}`, { method: 'DELETE' });

// Price from recent form when no bookmaker has framed a market yet.
function formPrices(runners: any[]) {
  const POS: Record<string, number> = { '1': 1, '2': .7, '3': .5, '4': .36, '5': .27, '6': .2, '7': .15, '8': .12, '9': .1, '0': .08 };
  const sc = runners.map((u) => {
    const f = [...String(u.form || '').replace(/[^0-9]/g, '')].reverse().slice(0, 5), wt = [1, .8, .65, .5, .4];
    let a = 0, b = 0; f.forEach((c, i) => { a += wt[i] * POS[c]; b += wt[i]; });
    return Math.pow(Math.max(.05, b ? a / b : .3), 1.6);
  });
  const sum = sc.reduce((x, y) => x + y, 0);
  return sc.map((x) => Math.min(101, Math.max(1.4, Math.round((1 / ((x / sum) * 1.16)) * 10) / 10)));
}
const median = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

async function pullCard(date: string, today: boolean) {
  const acc = await pe(`/v1/racing/acceptances?date=${date}`);
  const prices = new Map<string, any[]>();
  if (today) {
    const ntg = await pe('/v1/racing/next-to-go?num_races=200&category=thoroughbred&country=AU');
    for (const r of Array.isArray(ntg) ? ntg : []) {
      if (r.country !== 'AU' || (r.category && r.category !== 'horse')) continue;
      const k = `${slug(r.venue_canonical || r.venue)}|${r.race_number}`;
      (prices.get(k) || prices.set(k, []).get(k)!).push(r);
    }
  }
  const results = { races: {} as Record<string, any> };
  const meetings = [] as any[];
  for (const m of acc.meetings || []) {
    if (m.acceptances_published === false) continue;
    const venue = title(m.venue), state = stateOf(venue), key = `${date}_${slug(venue)}`, tc = m.track?.track_condition || null;
    const races = [] as any[];
    for (const r of m.races || []) {
      const all = r.runners || [];
      const run = all.filter((u: any) => !u.scratched && !u.emergency && u.number && u.barrier);
      const rk = `${key}_T_${r.race_number}`;
      results.races[rk] = { pos: {}, done: false, scr: all.filter((u: any) => u.scratched).map((u: any) => u.number) };
      // the market for this race, if one is up; two candidates (rare) are told apart by runner names
      const cands = prices.get(`${slug(venue)}|${r.race_number}`) || [];
      const names = new Set(run.map((u: any) => slug(u.runner_name)));
      const mk = cands.sort((a, b) => (b.runners || []).filter((x: any) => names.has(slug(x.name))).length - (a.runners || []).filter((x: any) => names.has(slug(x.name))).length)[0];
      const byNo = new Map<number, any>((mk?.runners || []).map((x: any) => [Number(x.number), x]));
      for (const s of mk?.scratchings || []) if (!results.races[rk].scr.includes(s.number)) results.races[rk].scr.push(s.number);
      const field = run.filter((u: any) => !results.races[rk].scr.includes(u.number)).map((u: any) => {
        const b = byNo.get(Number(u.number));
        const books = (b?.bookmakers || []).map((x: any) => Number(x.win_price)).filter((v: number) => v > 1);
        const places = (b?.bookmakers || []).map((x: any) => Number(x.place_price)).filter((v: number) => v > 1);
        return { no: u.number, name: title(u.runner_name), jockey: u.jockey ? title(u.jockey) : null, trainer: u.trainer ? title(u.trainer) : null, barrier: u.barrier, weight: u.weight_kg ?? null, win: median(books), place: median(places), form: u.last10 || null, silks: null, speed: null, age: u.age ?? null, sex: u.sex ?? null };
      });
      if (field.length < 4) continue;
      const est = field.some((x: any) => !x.win);
      if (est) { const p = formPrices(field); field.forEach((x: any, i: number) => { x.win = p[i]; x.place = null; }); }
      const jump = mk?.start_time || toUtc(date, r.start_time_local, TZ[state]);
      // scratched runners, named, so tips can show them struck out (the game's field never includes them)
      const scrNos = new Set<number>(results.races[rk].scr.map(Number)), named = new Map<number, string>(all.map((u: any) => [Number(u.number), title(u.runner_name)]));
      const scr = [...scrNos].filter((n) => named.has(n)).sort((a, b) => a - b).map((n) => ({ no: n, name: named.get(n) }));
      races.push({ number: r.race_number, name: title(r.race_name), distance: r.distance_m, jump, cls: r.race_class || null, track: tc, runners: field, est, scr });
    }
    if (races.length) meetings.push({ key, venue, state, date, metro: METRO.test(venue), races });
  }
  meetings.sort((a, b) => Number(b.metro) - Number(a.metro) || b.races.length - a.races.length || a.venue.localeCompare(b.venue));
  await put(`pe:card:${date}`, { fetched: new Date().toISOString(), meetings });
  // keep any results already in, add the latest scratchings
  const prev = await getRow(`pe:res:${date}`);
  const merged: Record<string, any> = { ...(prev?.payload?.races || {}) };
  for (const [k, v] of Object.entries(results.races)) merged[k] = { ...(merged[k] || v), scr: [...new Set([...(merged[k]?.scr || []), ...(v as any).scr])] };
  await put(`pe:res:${date}`, { ...(prev?.payload || {}), races: merged });
}
async function pullResults(date: string) {
  const prev = await getRow(`pe:res:${date}`);
  const races: Record<string, any> = { ...(prev?.payload?.races || {}) };
  const full: Record<string, any> = {};
  for (let off = 0; off < 600; off += 200) {
    const page = await pe(`/v1/racing/results?date=${date}&category=thoroughbred&country=AU&limit=200&offset=${off}`);
    const list = Array.isArray(page) ? page : [];
    for (const x of list) {
      if (x.country !== 'AU' || (x.category && x.category !== 'horse')) continue;
      const k = `${sydney(new Date(x.start_time))}_${slug(title(x.venue_canonical || x.venue))}_T_${x.race_number}`;
      const pos: Record<string, number> = {};
      for (const u of x.runners || []) if (Number(u.position) > 0) pos[u.number] = Number(u.position);
      for (const u of x.placings || []) if (Number(u.position) > 0) pos[u.number] = Number(u.position);
      const scr = [...new Set([...(races[k]?.scr || []), ...(x.deductions || []).map((d: any) => d.number)])];
      const div: Record<string, number> = {};
      for (const d of x.dividends?.exotics || []) {
        const t = String(d.type || d.code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const name = t === 'quinella' ? 'quinella' : t === 'exacta' ? 'exacta' : t === 'trifecta' ? 'trifecta' : t === 'firstfour' || t === 'first4' ? 'first4' : null;
        if (name && Number(d.amount) > 0 && !div[name]) div[name] = Number(d.amount);
      }
      const done = Object.keys(pos).length >= 2 && x.status !== 'pending';
      races[k] = { ...(races[k] || {}), pos, scr, div, done, status: x.status };
      // the full official result for the results viewer
      const px = new Map<number, { win: number | null; place: number | null }>();
      for (const u of x.placings || []) px.set(Number(u.number), { win: Number(u.win_price) || null, place: Number(u.place_price) || null });
      for (const d of x.dividends?.straight || []) {
        const n = Number(d.number), o = px.get(n) || { win: null, place: null }, mkt = String(d.market || '').toUpperCase();
        if (mkt === 'WIN' && !o.win) o.win = Number(d.amount) || null;
        if (mkt === 'PLACE' && !o.place) o.place = Number(d.amount) || null;
        px.set(n, o);
      }
      const fin = ((x.runners || []).some((u: any) => Number(u.position) > 0) ? x.runners : x.placings || [])
        .filter((u: any) => Number(u.position) > 0).map((u: any) => ({ no: u.number, name: title(u.name), pos: Number(u.position), win: Number(u.win_price) || px.get(Number(u.number))?.win || null, place: Number(u.place_price) || px.get(Number(u.number))?.place || null }))
        .sort((a: any, b: any) => a.pos - b.pos || a.no - b.no);
      const exo = [] as any[];
      for (const d of x.dividends?.exotics || []) if (Number(d.amount) > 0 && !exo.find((e) => e.type === d.type)) exo.push({ type: d.type || d.code, amount: Number(d.amount), sel: d.selection || '', product: d.product || '' });
      for (const d of x.dividends?.multi_race || []) if (Number(d.amount) > 0 && !exo.find((e) => e.type === d.type)) exo.push({ type: d.type || d.code, amount: Number(d.amount), sel: d.selection || '', product: d.product || '' });
      full[k] = { v: title(x.venue_canonical || x.venue), n: x.race_number, nm: title(x.race_name), d: x.distance_m, t: x.start_time, st: x.status, tc: x.track_condition || null, pp: x.places_paid || null, fin, exo, scr: (x.deductions || []).map((d: any) => ({ no: d.number, name: title(d.name) })) };
    }
    if (list.length < 200) break;
  }
  const card = (await getRow(`pe:card:${date}`))?.payload;
  let open = 0;
  if (card) for (const m of card.meetings) for (const ra of m.races) if (!races[`${m.key}_T_${ra.number}`]?.done) open++;
  await put(`pe:res:${date}`, { at: prev?.payload?.at || Date.now(), resAt: Date.now(), open, races });
  const px = (await getRow(`pe:resx:${date}`))?.payload?.races || {};
  await put(`pe:resx:${date}`, { v: 2, resAt: Date.now(), races: { ...px, ...full } });
}
// Official results for one day, grouped by meeting, with races still to run listed from the card
async function dayResults(date: string, today: string, k: number) {
  const card = (await getRow(`pe:card:${date}`))?.payload, resx = await getRow(`pe:resx:${date}`), res = await getRow(`pe:res:${date}`);
  const at = resx?.payload?.v === 2 ? resx.payload.resAt || 0 : 0, open = res?.payload?.open; // older copies lacked prices
  const jumps = card ? card.meetings.flatMap((m: any) => m.races.map((r: any) => Date.parse(r.jump))).filter(Number.isFinite) : [];
  const due = date === today
    ? jumps.some((t: number) => Date.now() > t + 5 * 60e3) && (!at || (open !== 0 && Date.now() - at > RES_EVERY * k))
    : !at || (open !== 0 && Date.now() - at > OLD_RES_EVERY * k);
  if (due) await maybe(`res:${date}`, true, () => pullResults(date));
  const x = (await getRow(`pe:resx:${date}`))?.payload || { races: {} };
  const byVenue = new Map<string, any>();
  const add = (v: string, race: any) => { const g = byVenue.get(slug(v)) || byVenue.set(slug(v), { venue: v, state: null, races: new Map() }).get(slug(v))!; g.races.set(race.n, { ...(g.races.get(race.n) || {}), ...race }); return g; };
  for (const m of card?.meetings || []) for (const r of m.races) add(m.venue, { n: r.number, nm: r.name, d: r.distance, t: r.jump, st: 'pending', fin: [], exo: [], scr: [] }).state = m.state;
  for (const r of Object.values(x.races) as any[]) add(r.v, r);
  const meetings = [...byVenue.values()].map((g) => ({ venue: g.venue, state: g.state, races: [...g.races.values()].sort((a: any, b: any) => a.n - b.n) }))
    .sort((a, b) => String(a.races[0]?.t || '').localeCompare(String(b.races[0]?.t || '')));
  return { date, today, dates: [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(today, -i)), resAt: x.resAt || null, meetings };
}
// Quick form for dogs or harness: one call (2 credits) returns every upcoming race in Australia with boxes, recent form
// and bookmaker prices. Used when FormFav's form isn't loaded. Refreshed at most every 2 hours (stretched when credits run
// thin), and never into the credits horse racing needs for the rest of the month (about 45 a day).
// When PuntersEdge can't refresh (saving credits, out of credits or an error), Krok fills in. Krok's dog and harness
// cards carry boxes, trainers or drivers and bookmaker prices but no form, so that copy is marked priceOnly and Nan
// ranks on the market alone. Whichever copy is newer is served.
async function quick(cat: 'greyhound' | 'harness', k: number) {
  const day = `pe:quick:${cat}`, row = await getRow(day), now = new Date();
  const daysLeft = Math.max(1, (Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - now.getTime()) / 864e5);
  const spare = meta ? meta.rem - daysLeft * 45 : 0, hour = sydHour();
  let status = 'cached', needKrok = false;
  if (!fresh(row, 2 * 3600e3 * k) && hour >= 6 && hour < 23) {
    if (spare < 4 || (meta && meta.rem < FLOOR)) { status = 'saving'; needKrok = true; }
    else {
      let tried = false;
      await maybe(`quick:${cat}`, true, async () => {
        tried = true;
        const list = await pe(`/v1/racing/next-to-go?num_races=200&category=${cat}&country=AU`);
        const races = [] as any[];
        for (const r of Array.isArray(list) ? list : []) {
          if (r.country !== 'AU' || (r.category && r.category !== cat)) continue;
          const scr = (r.scratchings || []).map((x: any) => ({ no: Number(x.number), name: title(x.name) }));
          const gone = new Set(scr.map((x: any) => x.no));
          const runners = (r.runners || []).filter((u: any) => !gone.has(Number(u.number))).map((u: any) => {
            const books = (u.bookmakers || []).map((x: any) => Number(x.win_price)).filter((v: number) => v > 1);
            return { no: Number(u.number), name: title(u.name), box: u.barrier ?? null, form: u.form || '', trainer: u.trainer ? title(u.trainer) : null, win: median(books) };
          });
          races.push({ venue: title(r.venue_canonical || r.venue), n: r.race_number, name: title(r.race_name), dist: r.distance_m, jump: r.start_time, runners, scr });
        }
        await put(day, { at: new Date().toISOString(), races });
        status = 'updated';
      });
      if (tried && status !== 'updated') needKrok = true; // PuntersEdge errored
    }
  }
  if (needKrok && await krokQuick(cat, k)) status = 'krok';
  const got = await getRow(day), kr = await getRow(`krok:quick:${cat}`);
  const useKrok = !!kr?.payload && (!got?.payload || Date.parse(kr.fetched_at) > Date.parse(got.fetched_at));
  const use = useKrok ? kr : got;
  return { cat, status, src: useKrok ? 'krok' : 'pe', priceOnly: useKrok, at: use?.payload?.at || null, races: use?.payload?.races || [], credits: meta ? meta.rem : null };
}

// Krok's price-only copy. Leaves the horse back-up (otr-races) at least KROK_FLOOR credits, and refreshes half as
// often while the allowance is small (the free plan's 50 a month).
async function krokQuick(cat: 'greyhound' | 'harness', k: number) {
  if (!KROK) return false;
  const day = `krok:quick:${cat}`, row = await getRow(day);
  const rem = Number((await getRow('meta'))?.payload?.rem);
  if (Number.isFinite(rem) && rem < KROK_FLOOR) return false;
  if (fresh(row, 2 * 3600e3 * k * (Number.isFinite(rem) && rem < 1000 ? 2 : 1))) return false;
  if (!await claim(`kquick:${cat}`)) return false;
  try {
    const r = await fetch(`${KROK_API}/racing/meetings?date=${sydney()}&country=AU&race_type=${cat === 'greyhound' ? 'G' : 'H'}&full=1&limit=50`, { headers: { 'X-API-Key': KROK } });
    const left = Number(r.headers.get('x-credits-remaining')), reset = r.headers.get('x-credits-reset');
    if (Number.isFinite(left) && r.headers.get('x-credits-remaining') !== null) await put('meta', { rem: left, reset: reset || undefined });
    if (!r.ok) throw new Error(`krok ${r.status}`);
    const j = await r.json(), type = cat === 'greyhound' ? 'G' : 'H', races = [] as any[];
    for (const m of j.data || []) {
      if ((m.country && m.country !== 'AU') || (m.type && m.type !== type)) continue;
      for (const ra of m.races || []) {
        if (!(Date.parse(ra.jump_time) > Date.now() - 10 * 60e3)) continue;
        const all = ra.runners || [];
        const scr = all.filter((u: any) => u.is_scratched).map((u: any) => ({ no: Number(u.number), name: title(u.name) }));
        const runners = all.filter((u: any) => !u.is_scratched).map((u: any) => {
          const books = (u.odds || []).filter((o: any) => o.bookmaker_type === 'fixed' && !o.stale).map((o: any) => Number(o.win)).filter((v: number) => v > 1);
          const win = median(books) ?? (Number(u.fixed_win) > 1 ? Number(u.fixed_win) : Number(u.best_win) > 1 ? Number(u.best_win) : null);
          return { no: Number(u.number), name: title(u.name), box: u.box ?? u.barrier_adjusted ?? u.barrier ?? null, form: '', trainer: u.trainer ? title(u.trainer) : null, win };
        });
        if (runners.length) races.push({ venue: title(m.venue), n: ra.number, name: title(ra.name), dist: ra.distance_m || ra.distance || null, jump: ra.jump_time, runners, scr });
      }
    }
    await put(day, { at: new Date().toISOString(), races });
    return true;
  } catch (e) { console.error('krok quick', cat, String(e)); return false; } finally { await release(`kquick:${cat}`); }
}
const getRow = async (day: string) => ((await (await db(`otr_race_cache?day=eq.${encodeURIComponent(day)}&select=payload,fetched_at`)).json()) as any[])[0] || null;
const fresh = (row: any, ms: number) => row && Date.now() - Date.parse(row.fetched_at) < ms;
async function rows() {
  const r = await db(`otr_race_cache?day=like.pe:*&fetched_at=gte.${new Date(Date.now() - 10 * 864e5).toISOString()}&select=day,payload,fetched_at`);
  return await r.json() as any[];
}
// lite: 'today' or 'tomorrow' (Nan's Tips) sends just that day's card and results, and leaves out the game's copy of today's meetings
async function respond(today: string, extra: Record<string, unknown> = {}, lite: string | null = null) {
  const all = await rows();
  const cards = all.filter((r) => r.day.startsWith('pe:card:') && r.payload && r.day.slice(8) >= today).sort((a, b) => a.day.localeCompare(b.day));
  let days = cards.map((r) => ({ date: r.day.slice(8), meetings: r.payload.meetings })).filter((d) => d.meetings.length);
  const want = lite === 'today' ? today : lite === 'tomorrow' ? (days.find((d) => d.date > today)?.date || addDays(today, 1)) : null;
  if (want) days = days.filter((d) => d.date === want);
  const results: Record<string, unknown> = {};
  for (const r of all) if (r.day.startsWith('pe:res:') && r.payload && (!want || r.day.slice(7) === want)) Object.assign(results, r.payload.races);
  const m = all.find((r) => r.day === 'pe:meta')?.payload;
  return new Response(JSON.stringify({ src: 'pe', today, days, results, credits: m ? m.rem : null, ...(want ? { lite: want } : { meetings: days[0]?.meetings || [] }), ...extra }), { headers: cors });
}
async function maybe(name: string, due: boolean, fn: () => Promise<void>) {
  if (!due || (meta && meta.rem < FLOOR)) return;
  if (!await claim(name)) return;
  try { await fn(); } catch (e) { console.error(name, String(e)); } finally { await release(name); }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (!KEY) return new Response(JSON.stringify({ error: 'Race data is not set up yet.', days: [], results: {}, meetings: [] }), { status: 503, headers: cors });
  const q = new URL(req.url).searchParams, today = sydney(), hour = sydHour();
  const lite = q.get('lite') === 'today' || q.get('lite') === 'tomorrow' ? q.get('lite') : null;
  try {
    meta = (await getRow('pe:meta'))?.payload || null;
    const k = slow();
    const qc = q.get('quick');
    if (qc === 'greyhound' || qc === 'harness') return new Response(JSON.stringify(await quick(qc, k)), { headers: cors });
    if (q.get('results')) {
      let date = q.get('date') || today;
      if (!/^\d{4}-\d\d-\d\d$/.test(date) || date > today || date < addDays(today, -6)) date = today;
      return new Response(JSON.stringify({ src: 'pe', ...(await dayResults(date, today, k)) }), { headers: cors });
    }
    if (q.get('refresh')) {
      let date = q.get('date') || today;
      if (!/^\d{4}-\d\d-\d\d$/.test(date) || date > today || date < addDays(today, -7)) date = today;
      const res = await getRow(`pe:res:${date}`);
      if (res?.payload?.resAt && res.payload.open === 0) return respond(today, { status: 'final' });
      if (res?.payload?.resAt && Date.now() - res.payload.resAt < RES_COOLDOWN * k) return respond(today, { status: 'cooldown', next: res.payload.resAt + RES_COOLDOWN * k });
      if (meta && meta.rem < FLOOR) return respond(today, { status: 'budget' });
      let ok = false;
      await maybe(`res:${date}`, true, async () => { await pullResults(date); ok = true; });
      return respond(today, { status: ok ? 'updated' : 'cooldown', next: Date.now() + 60e3 });
    }
    // today's card: on first ask from 6am, then refreshed every few hours for scratchings and prices
    const card = await getRow(`pe:card:${today}`);
    await maybe(`card:${today}`, hour >= 6 && hour < 22 && !fresh(card, card ? CARD_EVERY * k : 0), () => pullCard(today, true));
    // tomorrow's card once acceptances are out (prices are estimated from form until the day)
    const tom = addDays(today, 1), tcard = await getRow(`pe:card:${tom}`);
    await maybe(`card:${tom}`, hour >= 15 && !fresh(tcard, 8 * 3600e3 * k), () => pullCard(tom, false));
    // results while racing is on, and a late sweep of yesterday's
    const c = (await getRow(`pe:card:${today}`))?.payload;
    const jumps = c ? c.meetings.flatMap((m: any) => m.races.map((r: any) => Date.parse(r.jump))).filter(Number.isFinite) : [];
    const res = await getRow(`pe:res:${today}`);
    const started = jumps.some((t: number) => Date.now() > t + 5 * 60e3), open = res?.payload?.resAt ? res.payload.open > 0 : true;
    await maybe(`res:${today}`, started && open && !(res?.payload?.resAt && Date.now() - res.payload.resAt < RES_EVERY * k), () => pullResults(today));
    const yd = addDays(today, -1), yres = await getRow(`pe:res:${yd}`);
    if (yres?.payload && yres.payload.open !== 0) await maybe(`res:${yd}`, !(yres.payload.resAt && Date.now() - yres.payload.resAt < OLD_RES_EVERY * k), () => pullResults(yd));
    return respond(today, {}, lite);
  } catch (e) {
    console.error(String(e));
    return new Response(JSON.stringify({ error: 'Race data is unavailable right now.', days: [], results: {}, meetings: [] }), { status: 502, headers: cors });
  }
});
