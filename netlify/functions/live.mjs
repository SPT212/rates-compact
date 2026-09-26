// Netlify Function: GET /api/live
// Intraday GBP/USD and USD/JPY from Twelve Data. The API key lives in the Netlify
// environment variable TWELVE_DATA_API_KEY, never in the repo. Cached 5 minutes at
// Netlify's edge so the free plan (800 credits a day, 2 per call) is never exhausted.

const PAIRS = { gbp_usd: "GBP/USD", usd_jpy: "USD/JPY" };

const reply = (body, cdn) => new Response(JSON.stringify(body), {
  status: body.error ? 502 : 200,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Netlify-CDN-Cache-Control": cdn,
  },
});

export default async () => {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) return reply({ error: "TWELVE_DATA_API_KEY is not set" }, "public, s-maxage=60");
  try {
    const url = `https://api.twelvedata.com/quote?symbol=${Object.values(PAIRS).join(",")}&apikey=${encodeURIComponent(key)}`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`${r.status} from api.twelvedata.com`);
    const j = await r.json();
    if (j.status === "error") throw new Error(j.message || "Twelve Data error");
    const fetchedAt = new Date().toISOString();
    const out = {};
    for (const [k, sym] of Object.entries(PAIRS)) {
      const q = j[sym];
      const price = q && +q.close, prev = q && +q.previous_close;
      if (!q || q.status === "error" || !Number.isFinite(price)) continue;
      out[k] = {
        price,
        prev: Number.isFinite(prev) ? prev : null,
        at: q.last_quote_at ? new Date(q.last_quote_at * 1000).toISOString() : fetchedAt,
        open: q.is_market_open !== false,
      };
    }
    if (!Object.keys(out).length) throw new Error("Twelve Data returned no quotes");
    return reply({ generatedAt: fetchedAt, rates: out }, "public, s-maxage=300, durable");
  } catch (e) {
    return reply({ error: String(e.message || e) }, "public, s-maxage=60");
  }
};

export const config = { path: "/api/live" };
