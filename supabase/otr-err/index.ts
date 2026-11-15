// Nan's Tips error log. The page sends its own errors here (at most 3 a visit): POST {msg, where, view, version, ua}.
// Saved to otr_feedback as kind 'error' (no email). The same message is kept once every 6 hours, and no more than
// 100 errors an hour are saved in all, so a broken release can't flood the table.
const SB = Deno.env.get('SUPABASE_URL')!;
const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'content-type': 'application/json' };
const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });
const db = (path: string, init: RequestInit = {}) => fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: SR, authorization: `Bearer ${SR}`, 'content-type': 'application/json', ...(init.headers || {}) } });
const cut = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return out({ error: 'method' }, 405);
  try {
    const b = JSON.parse((await req.text()).slice(0, 4000));
    const msg = cut(b.msg, 300);
    if (msg.length < 3) return out({ ok: false });
    const text = `${msg}\n@ ${cut(b.where, 200)} · view ${cut(b.view, 20)}\n${cut(b.ua, 120)}`.slice(0, 1000);
    const hour = new Date(Date.now() - 3600e3).toISOString(), six = new Date(Date.now() - 6 * 3600e3).toISOString();
    const recent = (await (await db(`otr_feedback?kind=eq.error&at=gte.${hour}&select=id`)).json()) as any[];
    if (recent.length >= 100) return out({ ok: false, why: 'busy' });
    const same = (await (await db(`otr_feedback?kind=eq.error&at=gte.${six}&msg=like.${encodeURIComponent(msg.replace(/[*%]/g, '').slice(0, 120))}*&select=id`)).json()) as any[];
    if (same.length) return out({ ok: true, dup: true });
    const ins = await db('otr_feedback', { method: 'POST', body: JSON.stringify({ kind: 'error', msg: text, name: null, code: null, version: cut(b.version, 20) }) });
    return out({ ok: ins.ok });
  } catch (e) { return out({ ok: false }, 400); }
});
