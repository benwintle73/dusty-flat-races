// Nan's Tips: Best Bets of the day, locked so everyone sees the same list. Each race with a standout bet (its own tipsters,
// The Mob, the market) gets one pick shortly before the race; once in, a pick never changes or goes away. Results are worked
// out by each page from the official results.
// GET ?date=YYYY-MM-DD -> {date, picks:[...]}
// POST {date, picks:[{id, code, venue, no, jump, kind, sel:[{no,name}], price, p, why}]} adds any new picks (today only,
//   race not yet jumped, one pick a race, at most 60 a day) -> {date, picks}
// POST ?run=1 (pg_cron every 5 minutes, x-nan-key) works the picks out here for races jumping in the next 90 minutes, so the
//   list fills all day whether or not anyone has Nan's Tips open. Pages still add picks the same way when they're open.
const SB = Deno.env.get('SUPABASE_URL')!;
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'content-type': 'application/json' };
const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });
const db = (path: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: SR, authorization: `Bearer ${SR}`, 'content-type': 'application/json', ...(init.headers || {}) } });
const get = async (t: string, day: string) => ((await (await db(`${t}?day=eq.${encodeURIComponent(day)}&select=payload,fetched_at`)).json()) as any[])[0] || null;
const sydney = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(d);
const KINDS = new Set(['win', 'ew', 'tri', 'rough']);
const str = (x: unknown, n: number) => String(x ?? '').replace(/[<>]/g, '').slice(0, n);
const num = (x: unknown) => { const n = Number(x); return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null; };
async function load(date: string) { const r = ((await (await db(`otr_race_cache?day=eq.best:${date}&select=payload`)).json()) as any[])[0]; return (r?.payload?.picks || []) as any[]; }
function clean(p: any) {
  if (!p || typeof p !== 'object') return null;
  const code = String(p.code), kind = String(p.kind), jump = Date.parse(p.jump);
  if (!['H', 'N', 'D'].includes(code) || !KINDS.has(kind) || !Number.isFinite(jump)) return null;
  const sel = Array.isArray(p.sel) ? p.sel.slice(0, 3).map((u: any) => ({ no: num(u?.no), name: str(u?.name, 40) })).filter((u: any) => u.name) : [];
  if (!sel.length || (kind === 'tri' && sel.length !== 3)) return null;
  const id = str(p.id, 120); if (!id) return null;
  return { id, code, venue: str(p.venue, 40), no: num(p.no), jump: new Date(jump).toISOString(), kind, sel, price: num(p.price), p: num(p.p), why: str(p.why, 160), at: new Date().toISOString() };
}
async function addPicks(date: string, list: any[]) {
  const have = await load(date), ids = new Set(have.map((p) => p.id)), now = Date.now();
  const add = list.map(clean).filter((p: any) => p && !ids.has(p.id) && Date.parse(p.jump) > now + 60e3);
  if (!add.length) return { picks: have, added: 0 };
  const picks = [...have]; let added = 0;
  for (const p of add) { if (picks.length >= 60) break; if (!picks.some((x) => x.id === p.id)) { picks.push(p); added++; } }
  picks.sort((a, b) => Date.parse(a.jump) - Date.parse(b.jump));
  await db('otr_race_cache?on_conflict=day', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ day: `best:${date}`, payload: { picks }, fetched_at: new Date().toISOString() }) });
  return { picks, added };
}

/* ---------- The server's own picker: the same tipsters and the same bar as the page (bdPick in nan.html) ----------
   Tipsters for each race Nan has logged: Nan (her own field), Pop (FormFav, as otr-tips saved it), Bob (Krok, with the speed
   map and draw factors when saved), Gran (the market: horses from Nan's field, dogs and harness from PuntersEdge's quick
   prices) and Kev (most tipped). The Mob is their blend, each weighted by recent form (panel:w, from otr-tips).
   Independent models: Pop and Bob, and Nan on dogs and harness, where she rates form rather than the price. Agreement counts
   the market (Gran, plus Nan on horses), Pop, Bob, Kev and Nan once each. A value runner: two or more independent models
   averaging 10%+, $1.50-$12 in the market, a 20-100% overlay with every model at least 10% over. Needs three tipsters,
   at least one of them independent.
     Win      The Mob's top pick at 40%+, 60%+ of the views on it, $4.50 or shorter.
     Roughie  The best value runner at $8 or longer.
     Each way The Mob's top pick at 28%+, half the views on it, $4-$15; or the best value runner at $4-$8.
     Trifecta Seven or more runners, The Mob's top three 72%+ between them, nothing else above 9%: boxed. */
const nm = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const vk = nm;
const VSTOP = new Set(['sportsbet', 'ladbrokes', 'tab', 'tabtouch', 'bet365', 'picklebet', 'neds', 'pointsbet', 'betr', 'unibet', 'palmerbet', 'bluebet', 'topsport', 'playup', 'betfair', 'racing', 'raceway', 'paceway', 'racecourse', 'the', 'at']);
const vwords = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(' ').filter((x) => x && !VSTOP.has(x));
function vmatch<T>(items: T[], name: (x: T) => string, venue: unknown): T | null {
  const want = vwords(venue).join(''); if (!want) return null;
  let best: T | null = null, score = 0;
  for (const it of items) {
    const raw = String(name(it) || ''), have = vwords(raw).join('') || raw.toLowerCase().replace(/[^a-z]/g, '');
    if (!have) continue;
    const sc = have === want ? 1000 : (have.length >= 4 && want.includes(have)) || (want.length >= 4 && have.includes(want)) ? Math.min(have.length, want.length) : 0;
    if (sc > score) { score = sc; best = it; }
  }
  return best;
}
function keyed<V>(b: Record<string, V>, code: string, venue: unknown, race: unknown): V | null {
  const exact = b[`${code}|${vk(venue)}|${race}`]; if (exact) return exact;
  const ks = Object.keys(b).map((k) => k.split('|')).filter(([c, , n]) => c === code && +n === +String(race));
  const m = vmatch(ks, (k) => k[1], venue);
  return m ? b[m.join('|')] : null;
}
function spread(list: any[] | null | undefined, field: Set<string>) {
  const m = new Map<string, number>();
  for (const u of list || []) { const k = nm(u.name); if (field.has(k) && Number(u.p) > 0) m.set(k, (m.get(k) || 0) + Number(u.p)); }
  const s = [...m.values()].reduce((a, v) => a + v, 0); if (!m.size || s <= 0) return null;
  for (const [k, v] of m) m.set(k, v / s);
  return m;
}
function bobWith(list: any[] | null, km: any) {
  if (!list || !km?.runners) return list;
  const f = new Map<string, number>(km.runners.map((u: any) => [nm(u.name), u.f]));
  const adj = list.map((u) => ({ ...u, p: u.p * (f.get(nm(u.name)) ?? 1) })), t = adj.reduce((a, u) => a + u.p, 0) || 1;
  return adj.map((u) => ({ ...u, p: u.p / t }));
}
const PANEL = ['nan', 'pop', 'bob', 'gran', 'kev'];
const pctS = (p: number) => `${Math.round(p * 100)}%`;
// the page's race id: horses keep Nan's id, dogs and harness drop the date (D|2026-11-23|ballarat|4 -> D|ballarat|4)
const pageId = (r: any) => { if (r.code === 'H') return r.id; const p = String(r.id).split('|'); return p.length === 4 ? `${p[0]}|${p[2]}|${p[3]}` : r.id; };

function pick(r: any, T: Record<string, Map<string, number>>, mc: Map<string, number>, qr: any) {
  if (Object.keys(T).length < 3) return null;
  const nanInd = r.code !== 'H';
  const ind = ['pop', 'bob'].filter((w) => T[w]).concat(nanInd && T.nan ? ['nan'] : []); if (!ind.length) return null;
  const topOf = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const groups: string[][] = [];
  const mg = [T.gran ? 'gran' : '', !nanInd && T.nan ? 'nan' : ''].filter(Boolean); if (mg.length) groups.push(mg);
  for (const w of ['pop', 'bob', 'kev']) if (T[w]) groups.push([w]);
  if (nanInd && T.nan) groups.push(['nan']);
  const info = new Map<string, any>(); for (const x of r.picks || []) info.set(nm(x.name), x);
  const scr = new Set(((qr?.scr || []) as any[]).map((x) => nm(x.name)));
  const field = [...info.keys()].filter((k) => !scr.has(k) && (r.code === 'H' || !qr || (qr.runners || []).some((u: any) => nm(u.name) === k)));
  const price = (k: string) => {
    if (r.code === 'H') { const v = Number(info.get(k)?.mk); return v > 1 ? v : null; }
    const u = (qr?.runners || []).find((x: any) => nm(x.name) === k); return u && Number(u.win) > 1 ? Number(u.win) : null;
  };
  const one = (k: string) => {
    const p = mc.get(k) || 0, pis = ind.map((w) => T[w].get(k)).filter((v) => v != null) as number[], pi = pis.length ? pis.reduce((a, v) => a + v, 0) / pis.length : 0;
    const on = groups.filter((ws) => ws.some((w) => topOf(T[w]) === k)).length, mk = price(k), edge = mk ? pi * mk - 1 : 0;
    const value = pis.length >= 2 && pi >= .10 && !!mk && mk >= 1.5 && mk <= 12 && edge >= .2 && edge <= 1 && pis.every((v) => v * mk >= 1.1);
    return { k, p, mk, edge, value, a: groups.length ? on / groups.length : 0, on, g: groups.length };
  };
  const order = field.slice().sort((x, y) => (mc.get(y) || 0) - (mc.get(x) || 0)); if (!order.length) return null;
  const top = one(order[0]), val = order.map(one).filter((x) => x.value).sort((x, y) => y.edge - x.edge)[0];
  const sel = (k: string) => { const x = info.get(k); return { no: x?.no ?? null, name: x?.name || k }; };
  const base = { id: pageId(r), code: r.code, venue: r.venue, no: r.race, jump: r.jump };
  const single = (kind: string, x: any) => ({ ...base, kind, sel: [sel(x.k)], price: x.mk || null, p: x.p, why: `The Mob ${pctS(x.p)} · ${x.on} of ${x.g} agree` });
  if (top.p >= .40 && top.a >= .6 && top.mk && top.mk <= 4.5) return single('win', top);
  if (val && val.mk! >= 8) return single('rough', val);
  if (top.p >= .28 && top.a >= .5 && top.mk && top.mk >= 4 && top.mk <= 15) return single('ew', top);
  if (val && val.mk! >= 4) return single('ew', val);
  if (order.length < 7) return null;
  const c = order.map((k) => mc.get(k) || 0), t3 = c[0] + c[1] + c[2];
  if (t3 >= .72 && c[3] <= .09) return { ...base, kind: 'tri', sel: order.slice(0, 3).map(sel), price: null, p: t3, why: `The Mob's top three, ${pctS(t3)} between them` };
  return null;
}

async function run() {
  const today = sydney(), now = Date.now();
  const rows = await (await db(`otr_nan_log?date=eq.${today}&jump=gt.${new Date(now + 2 * 60e3).toISOString()}&jump=lt.${new Date(now + 90 * 60e3).toISOString()}&select=id,code,venue,race,jump,picks`)).json() as any[];
  if (!rows?.length) return { races: 0, added: 0 };
  const have = new Set((await load(today)).map((p) => p.id)), todo = rows.filter((r) => !have.has(pageId(r)));
  if (!todo.length) return { races: rows.length, added: 0 };
  // fresh dog and harness prices (otr-pe sticks to its own credit budget and refresh intervals)
  if (todo.some((r) => r.code !== 'H')) await Promise.all(['greyhound', 'harness'].map((c) => fetch(`${SB}/functions/v1/otr-pe?quick=${c}`).then((x) => x.text()).catch(() => null)));
  const [bobR, kevR, wR, qD, qN] = await Promise.all([get('otr_race_cache', `tips:bob:${today}`), get('otr_race_cache', `tips:kev:${today}`), get('otr_race_cache', 'panel:w'), get('otr_race_cache', 'pe:quick:greyhound'), get('otr_race_cache', 'pe:quick:harness')]);
  const B = bobR?.payload?.races || {}, K = kevR?.payload?.races || {}, W = wR?.payload || {}, Q: Record<string, any[]> = { D: qD?.payload?.races || [], N: qN?.payload?.races || [] };
  const picks: any[] = [];
  for (const r of todo) {
    try {
      const key = `${r.code}|${vk(String(r.venue).replace(/[^A-Za-z0-9 '\-]/g, ''))}|${r.race}`;
      const [popR, kmR] = await Promise.all([get('otr_form_cache', `pop:${today}:${key}`), get('otr_form_cache', `kmap:${today}:${key}`)]);
      const field = new Set<string>((r.picks || []).map((x: any) => nm(x.name)));
      let qr: any = null, mkt = (r.picks || []).filter((x: any) => Number(x.mk) > 1).map((x: any) => ({ name: x.name, p: 1 / x.mk }));
      if (r.code !== 'H') {
        qr = vmatch((Q[r.code] || []).filter((x: any) => +x.n === +r.race), (x: any) => x.venue, r.venue);
        mkt = (qr?.runners || []).filter((u: any) => Number(u.win) > 1).map((u: any) => ({ name: u.name, p: 1 / u.win }));
      }
      const kv = keyed(K, r.code, r.venue, r.race) as any[] | null;
      const ch: Record<string, Map<string, number> | null> = {
        nan: spread(r.picks, field), pop: spread(popR?.payload?.data?.runners, field), bob: spread(bobWith(keyed(B, r.code, r.venue, r.race) as any, kmR?.payload?.data), field),
        gran: mkt.length >= 2 ? spread(mkt, field) : null, kev: spread((kv || []).filter((u) => u.n > 0).map((u) => ({ name: u.name, p: u.n })), field),
      };
      const T: Record<string, Map<string, number>> = {}; for (const w of PANEL) if (ch[w]) T[w] = ch[w]!;
      const ws = W[r.code] || {}, sw = Object.keys(T).reduce((a, w) => a + (ws[w] ?? 1), 0) || 1, mc = new Map<string, number>();
      for (const w in T) for (const [k, v] of T[w]) mc.set(k, (mc.get(k) || 0) + v * (ws[w] ?? 1) / sw);
      const p = pick(r, T, mc, qr); if (p) picks.push(p);
    } catch (e) { console.error('best', r.id, String(e)); }
  }
  const res = picks.length ? await addPicks(today, picks) : { added: 0 };
  return { races: rows.length, checked: todo.length, added: res.added };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const u = new URL(req.url), today = sydney();
    if (u.searchParams.get('run')) {
      const want = (await get('otr_race_cache', 'nan:key'))?.payload?.k;
      if (!want || req.headers.get('x-nan-key') !== want) return out({ error: 'Not allowed.' }, 403);
      return out(await run());
    }
    if (req.method === 'GET') {
      const date = u.searchParams.get('date') || today;
      if (!/^\d{4}-\d\d-\d\d$/.test(date)) return out({ error: 'Bad date.' }, 400);
      return out({ date, picks: await load(date) });
    }
    if (req.method === 'POST') {
      const text = await req.text(); if (text.length > 40000) return out({ error: 'too big' }, 413);
      const body = JSON.parse(text), date = String(body.date || '');
      if (date !== today) return out({ error: 'Only today.' }, 400);
      const { picks } = await addPicks(date, Array.isArray(body.picks) ? body.picks : []);
      return out({ date, picks });
    }
    return out({ error: 'method' }, 405);
  } catch (e) { return out({ error: String((e as Error).message || e) }, 500); }
});
