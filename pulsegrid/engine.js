/* ===== PULSEGRID engine: pure logic, no DOM. Shared by the game and the tests. ===== */
const PG = (() => {
  const RULES_VERSION = 1, NS = 'pulsegrid';
  // ---- seeded PRNG (mulberry32 over a string hash) ----
  function hash(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = typeof seed === 'string' ? hash(seed) : seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  // ---- board model: { w, h, block:[bool], start:[0..2], target:[0..2] } ----
  const idx = (b, x, y) => y * b.w + x;
  function neighbours(b, i) { // the cells a tap on i changes (itself + orthogonal playable neighbours)
    if (b.block[i]) return [];
    const x = i % b.w, y = (i / b.w) | 0, out = [i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h) continue; const j = idx(b, nx, ny); if (!b.block[j]) out.push(j); }
    return out;
  }
  function tap(b, state, i, times = 1) { const s = state.slice(); for (const j of neighbours(b, i)) s[j] = (s[j] + times) % 3; return s; }
  function solved(b, state) { for (let i = 0; i < state.length; i++) if (!b.block[i] && state[i] !== b.target[i]) return false; return true; }
  function applyVector(b, state, x) { let s = state.slice(); x.forEach((t, i) => { if (t) s = tap(b, s, i, t); }); return s; }
  // ---- GF(3) solver: A x = target - state (mod 3); returns the minimum-tap solution when the null space is small ----
  const inv3 = [0, 1, 2]; // 1*1=1, 2*2=4=1
  function solve(b, state, budget = 12) {
    const P = []; for (let i = 0; i < b.w * b.h; i++) if (!b.block[i]) P.push(i);
    const n = P.length, pos = new Map(P.map((c, k) => [c, k]));
    // rows = equations for each playable cell, columns = tap counts for each playable cell (+ rhs)
    const M = P.map((cell) => { const row = new Array(n + 1).fill(0); for (let k = 0; k < n; k++) if (neighbours(b, P[k]).includes(cell)) row[k] = 1; row[n] = ((b.target[cell] - state[cell]) % 3 + 3) % 3; return row; });
    const pivCol = []; let r = 0;
    for (let c = 0; c < n && r < n; c++) {
      let p = -1; for (let i = r; i < n; i++) if (M[i][c]) { p = i; break; }
      if (p < 0) continue;
      [M[r], M[p]] = [M[p], M[r]];
      const f = inv3[M[r][c]]; for (let j = c; j <= n; j++) M[r][j] = (M[r][j] * f) % 3;
      for (let i = 0; i < n; i++) if (i !== r && M[i][c]) { const g = M[i][c]; for (let j = c; j <= n; j++) M[i][j] = ((M[i][j] - g * M[r][j]) % 3 + 3) % 3; }
      pivCol.push(c); r++;
    }
    for (let i = r; i < n; i++) if (M[i][n]) return null; // inconsistent: unsolvable
    const free = []; for (let c = 0; c < n; c++) if (!pivCol.includes(c)) free.push(c);
    const build = (fv) => { const x = new Array(n).fill(0); free.forEach((c, k) => { x[c] = fv[k]; }); for (let i = r - 1; i >= 0; i--) { const c = pivCol[i]; let v = M[i][n]; for (let j = c + 1; j < n; j++) v -= M[i][j] * x[j]; x[c] = ((v % 3) + 3) % 3; } return x; };
    let best = null, bestCost = Infinity, exact = free.length <= budget;
    const cost = (x) => x.reduce((a, v) => a + v, 0);
    if (exact) {
      const total = 3 ** free.length, fv = new Array(free.length).fill(0);
      for (let k = 0; k < total; k++) { let t = k; for (let q = 0; q < free.length; q++) { fv[q] = t % 3; t = (t / 3) | 0; } const x = build(fv), cst = cost(x); if (cst < bestCost) { bestCost = cst; best = x; } }
    } else { best = build(new Array(free.length).fill(0)); bestCost = cost(best); }
    const full = new Array(b.w * b.h).fill(0); P.forEach((c, k) => { full[c] = best[k]; });
    return { x: full, taps: bestCost, exact, nullity: free.length };
  }
  // ---- level design ----
  function spec(level) { // grid size, blocked count, target style, scramble size by level
    if (level <= 10) return { w: 3, h: 3, blocks: 0, pattern: 'flat', scr: [1, 1, 2, 2, 2, 3, 3, 3, 4, 4][level - 1], min: [1, 1, 2, 2, 2, 3, 3, 3, 4, 4][level - 1] };
    if (level <= 25) { const t = level - 11; return { w: 4, h: 4, blocks: 0, pattern: t < 6 ? 'flat' : 'two', scr: 3 + Math.floor(t / 3), min: 3 + Math.floor(t / 4) }; }
    if (level <= 45) { const t = level - 26; return { w: 5, h: 5, blocks: t < 4 ? 0 : 1 + (t % 3), pattern: t < 8 ? 'two' : 'three', scr: 4 + Math.floor(t / 3), min: 4 + Math.floor(t / 4) }; }
    if (level <= 70) { const t = level - 46, big = t % 2 === 1; return { w: big ? 6 : 5, h: big ? 6 : 5, blocks: 1 + (t % 4), pattern: 'three', scr: 6 + Math.floor(t / 3), min: 6 + Math.floor(t / 5) }; }
    const t = level - 71; return { w: 6, h: 6, blocks: 2 + (t % 4), pattern: t % 3 === 0 ? 'mirror' : 'three', scr: 9 + Math.floor(t / 3), min: 9 + Math.floor(t / 5) };
  }
  function makeTarget(r, w, h, block, pattern) {
    const t = new Array(w * h).fill(1);
    if (pattern === 'flat') return t;
    for (let i = 0; i < w * h; i++) {
      if (block[i]) { t[i] = 0; continue; }
      const x = i % w, y = (i / w) | 0;
      if (pattern === 'two') t[i] = (x + y) % 2 ? 1 : 2;               // checker of cyan and magenta
      else if (pattern === 'mirror') { const m = Math.min(x, w - 1 - x); t[i] = [1, 2, 0][(m + Math.min(y, h - 1 - y)) % 3]; } // concentric rings
      else t[i] = [1, 2, 0][Math.floor(r() * 3)];                       // free pattern
    }
    return t;
  }
  function placeBlocks(r, w, h, n) {
    const block = new Array(w * h).fill(false); let tries = 0;
    while (n > 0 && tries++ < 200) { const i = Math.floor(r() * w * h), x = i % w, y = (i / w) | 0; if (block[i]) continue; if ((x === 0 || x === w - 1) && (y === 0 || y === h - 1) && r() < .5) continue; block[i] = true; n--; }
    return block;
  }
  // build a puzzle from a seed: start from the solved target and apply legal taps, so it is always solvable; then measure
  // the true minimum with the solver and keep it only if it's hard enough for its slot
  function generate(seed, s) {
    for (let attempt = 0; attempt < 400; attempt++) {
      const r = rng(seed + '#' + attempt), block = placeBlocks(r, s.w, s.h, s.blocks), target = makeTarget(r, s.w, s.h, block, s.pattern);
      const b = { w: s.w, h: s.h, block, target, start: null };
      const cells = []; for (let i = 0; i < s.w * s.h; i++) if (!block[i]) cells.push(i);
      let st = target.slice(); const used = new Set();
      for (let k = 0; k < s.scr; k++) { let c; do { c = cells[Math.floor(r() * cells.length)]; } while (used.has(c) && used.size < cells.length); used.add(c); st = tap(b, st, c, r() < .35 && s.min > 3 ? 1 : 2); } // two forward pulses = one tap back, so most solutions are single taps
      if (solved(b, st)) continue;
      // tapping a cell 3 times does nothing, so undo it: the scramble is the inverse of a forward solution
      const sol = solve(b, st);
      if (!sol || sol.taps < s.min) continue;
      b.start = st; b.par = sol.taps; b.exact = sol.exact; b.seed = seed + '#' + attempt;
      return b;
    }
    throw new Error('could not generate ' + seed);
  }
  const cache = new Map();
  function level(n) { if (!cache.has(n)) cache.set(n, generate(`${NS}|v${RULES_VERSION}|level|${n}`, spec(n))); return cache.get(n); }
  function daily(date) { const r = rng(`${NS}|v${RULES_VERSION}|daily|${date}`); const big = r() < .5; return generate(`${NS}|v${RULES_VERSION}|daily|${date}`, { w: big ? 6 : 5, h: big ? 6 : 5, blocks: 1 + Math.floor(r() * 3), pattern: r() < .3 ? 'mirror' : 'three', scr: 8, min: 7 }); }
  // stars: 3 = par or better (par is the proven minimum when exact), 2 = within half again plus two, 1 = solved
  function stars(par, moves, hinted) { if (moves <= par && !hinted) return 3; if (moves <= Math.ceil(par * 1.5) + 2) return 2; return 1; }
  function threshold2(par) { return Math.ceil(par * 1.5) + 2; }
  function difficulty(n) { return n <= 10 ? 'Warm-up' : n <= 25 ? 'Easy' : n <= 45 ? 'Medium' : n <= 70 ? 'Hard' : 'Expert'; }
  return { RULES_VERSION, hash, rng, neighbours, tap, solved, applyVector, solve, spec, generate, level, daily, stars, threshold2, difficulty, LEVELS: 100 };
})();
if (typeof module !== 'undefined') module.exports = PG;
