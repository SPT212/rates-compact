// Netlify Function: GET /api/rates
// Pulls SOFR + SOFR averages (NY Fed), SONIA + SONIA Compounded Index (Bank of England),
// and USD/GBP, USD/JPY reference rates (ECB via Frankfurter). Returns one JSON payload.

const UA = "Mozilla/5.0 (compatible; EmastraRates/1.0)";
const DAY = 86400000;
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const iso = (d) => d.toISOString().slice(0, 10);
const boeDate = (d) => `${String(d.getUTCDate()).padStart(2, "0")}/${MONTHS[d.getUTCMonth()]}/${d.getUTCFullYear()}`;

async function getJSON(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
  return r.json();
}

// Compounded-in-arrears average over an exact N calendar-day window, using the published
// compounded index. Start-of-window index is rolled forward from the preceding business day
// at that day's overnight rate (the NY Fed method; reproduces published SOFR averages exactly).
function compoundedSeries(indexPts, ratePts, days, basis, fromDate) {
  const rate = Object.fromEntries(ratePts);
  const pts = indexPts.map(([d, v]) => [Date.parse(d), v, d]);
  const out = [];
  let j = 0;
  for (const [t, v, d] of pts) {
    if (d < fromDate) continue;
    const target = t - days * DAY;
    while (j + 1 < pts.length && pts[j + 1][0] <= target) j++;
    const [tp, ip, dp] = pts[j];
    if (tp > target || rate[dp] == null) continue;
    const iStart = ip * (1 + (rate[dp] / 100) * Math.round((target - tp) / DAY) / basis);
    out.push([d, +(((v / iStart) - 1) * basis / days * 100).toFixed(4)]);
  }
  return out;
}

async function sofr(count) {
  const [on, avg] = await Promise.all([
    getJSON(`https://markets.newyorkfed.org/api/rates/secured/sofr/last/${count}.json`),
    getJSON(`https://markets.newyorkfed.org/api/rates/secured/sofrai/last/${count}.json`),
  ]);
  const asc = (a) => a.slice().sort((x, y) => (x.effectiveDate < y.effectiveDate ? -1 : 1));
  const o = asc(on.refRates), a = asc(avg.refRates);
  return {
    sofr_on: o.map((r) => [r.effectiveDate, r.percentRate]),
    sofr_30: a.map((r) => [r.effectiveDate, r.average30day]),
    sofr_90: a.map((r) => [r.effectiveDate, r.average90day]),
    sofr_index: a.map((r) => [r.effectiveDate, r.index]),
  };
}

async function sonia(from) {
  const start = new Date(Date.parse(from) - 120 * DAY); // extra history to compound 90d back
  const url = "https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp" +
    `?csv.x=yes&Datefrom=${boeDate(start)}&Dateto=now&SeriesCodes=IUDSOIA,IUDZOS2&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N`;
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/csv,*/*" } });
  if (!r.ok) throw new Error(`${r.status} from bankofengland.co.uk`);
  const text = await r.text();
  const on = [], idx = [];
  for (const line of text.trim().split(/\r?\n/)) {
    const [ds, rate, index] = line.split(",");
    const t = Date.parse(ds + " UTC");
    if (Number.isNaN(t)) continue; // header
    const d = iso(new Date(t));
    if (rate && rate.trim()) on.push([d, +rate]);
    if (index && index.trim()) idx.push([d, +index]);
  }
  if (!idx.length) throw new Error("Bank of England returned no SONIA data");
  on.sort((x, y) => (x[0] < y[0] ? -1 : 1));
  idx.sort((x, y) => (x[0] < y[0] ? -1 : 1));
  return {
    sonia_on: on.filter(([d]) => d >= from),
    sonia_30: compoundedSeries(idx, on, 30, 365, from),
    sonia_90: compoundedSeries(idx, on, 90, 365, from),
  };
}

async function fx(from) {
  const j = await getJSON(`https://api.frankfurter.dev/v1/${from}..?from=USD&to=GBP,JPY`);
  const dates = Object.keys(j.rates).sort();
  return {
    usd_gbp: dates.map((d) => [d, j.rates[d].GBP]),
    usd_jpy: dates.map((d) => [d, j.rates[d].JPY]),
  };
}

export default async (req) => {
  const from = iso(new Date(Date.now() - 400 * DAY));
  const errors = [];
  const settle = async (name, p) => {
    try { return await p; } catch (e) { errors.push({ source: name, message: String(e.message || e) }); return {}; }
  };
  const [s, g, x] = await Promise.all([
    settle("NY Fed (SOFR)", sofr(280)),
    settle("Bank of England (SONIA)", sonia(from)),
    settle("ECB (FX)", fx(from)),
  ]);
  delete s.sofr_index;
  const body = { generatedAt: new Date().toISOString(), metrics: { ...s, ...g, ...x }, errors };
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Netlify-CDN-Cache-Control": errors.length
        ? "public, s-maxage=120"
        : "public, s-maxage=1800, stale-while-revalidate=86400, durable",
    },
  });
};

export const config = { path: "/api/rates" };
