// Relays RSN's public live radio streams (HLS) with CORS headers, so browsers without built-in HLS (desktop Chrome,
// Firefox, Edge) can play them through hls.js. Only RSN's two stream hosts, and only playlist and audio chunk files.
const CH: Record<string, string> = {
  x: "https://d1j02mmlpi2jw3.cloudfront.net/", // RSN Xtra: Sky Racing race calls
  m: "https://dg6dce7w867bz.cloudfront.net/",  // RSN 927
};
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const u = new URL(req.url), ch = u.searchParams.get("ch") || "", p = u.searchParams.get("p") || "playlist.m3u8";
  if (!CH[ch] || !/^[A-Za-z0-9_\-]+\.(m3u8|aac|ts)$/.test(p)) return new Response("bad request", { status: 400, headers: CORS });
  const up = await fetch(CH[ch] + p).catch(() => null);
  if (!up || !up.ok) return new Response("stream unavailable", { status: 502, headers: CORS });
  if (p.endsWith(".m3u8")) {
    // point every file in the playlist back through this relay
    const body = (await up.text()).split("\n").map((l) => l && !l.startsWith("#") ? `otr-radio?ch=${ch}&p=${encodeURIComponent(l.trim())}` : l).join("\n");
    return new Response(body, { headers: { ...CORS, "content-type": "application/vnd.apple.mpegurl", "cache-control": "no-cache" } });
  }
  return new Response(up.body, { headers: { ...CORS, "content-type": up.headers.get("content-type") || "audio/aac", "cache-control": "public, max-age=60" } });
});
