# Emastra Rates: project guide for Claude Code

Personal mobile dashboard for SOFR, SONIA and USD/GBP, USD/JPY. Hosted on Netlify, deployed automatically from the `main` branch on GitHub.

## Files
- `index.html`: the whole app (HTML, CSS, JS in one file, no build step)
- `netlify/functions/rates.mjs`: server function at `/api/rates`, fetches all data and returns one JSON payload, cached 5 minutes at Netlify's edge. Do not add stale-while-revalidate: it made a normal page load show data up to a day old, while only the Refresh button (which adds `?t=`) got fresh data.
- `netlify/functions/live.mjs`: server function at `/api/live`, intraday USD/GBP and USD/JPY from Twelve Data, cached 5 minutes at Netlify's edge
- `netlify.toml`: Netlify config (publish root, functions folder)
- `manifest.webmanifest`, `icon-180.png`, `icon-512.png`: iPhone home screen app

## Data sources
- SOFR Overnight, 30-Day, 90-Day: NY Fed Markets API (`/api/rates/secured/sofr/last/N.json`, `/sofrai/last/N.json`)
- SONIA Overnight: Bank of England IADB CSV, series IUDSOIA. BoE blocks browser requests, so it must be fetched in the function.
- SONIA 30-Day, 90-Day: calculated in the function from BoE series IUDZOS2 (SONIA index), ACT/365, exact N calendar-day window with the start index rolled forward from the prior business day at that day's rate. This method reproduces the NY Fed's published SOFR averages exactly; keep it.
- FX history and fallback: ECB reference rates via api.frankfurter.dev. Charts always use this daily series.
- FX live: Twelve Data `/quote` for USD/GBP and USD/JPY. Needs the Netlify environment variable `TWELVE_DATA_API_KEY` (never commit the key). Free plan is 800 credits a day and each call costs 2, so keep the 5 minute edge cache. If the key is missing or the call fails, the FX rows fall back to ECB.
- Not available free: CME Term SOFR (licensed), Xe (paid API)

## Style rules (always follow)
- Never use em dashes or double hyphens in any text the user sees, including copy, labels, comments in the UI and commit messages.
- Title Case for terms and labels: 30-Day, 90-Day, Overnight, 1 USD in Pounds, 1 USD in Yen, ECB Reference Rates, Indicative Mid, Exchange Rates.
- Do not use the word "compounded" in the UI.
- Visual system matches cremx.netlify.app: Inter, canvas #EDF0F4, cards #FFFFFF, ink #16283F, blue #2C6FB5, orange #D2761C, green #1D7A4A (up), red #C22B2B (down). Dark mode tokens live in the same `:root` block.
- Mobile first. Check every change at 390px wide as well as desktop.

## Working on it
- Preview locally: `npx netlify-cli dev` then open http://localhost:8888 (runs the function too).
- Deploy: commit and push to `main`. Netlify publishes in about a minute.
- Roll back: Netlify dashboard, Deploys, choose an earlier deploy, Publish deploy.
- After deploying, check https://rates-compact.netlify.app/api/rates returns `"errors":[]`.
