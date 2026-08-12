BAT-TECH QUANTITAVE — Browser Backtest Engine (Phase 2)
==========================================================

WHAT THIS IS
------------
A pure-browser version of the BAT-TECH backtest engine. No install, no
desktop app, no rented server. All backtest math (engine loop, SL/TP,
metrics) runs in real Python via Pyodide (Python compiled to WebAssembly),
executing entirely inside your browser tab.

HOW TO RUN IT
--------------
Just double-click index.html. It should open directly in your browser and
work — no server, no install, nothing running in the background.

Why this version works from file:// when the last one didn't: browsers
treat file:// pages as an opaque "null" origin and refuse ANY fetch() of
local files (that's what "blocked by CORS policy" in your screenshot was).
There's no whitelist for it — every purely-local tool that "just works"
either avoids local fetch() entirely or is secretly served over
http://localhost. This version takes the first route: engine.py and the
3 preset strategies are now inlined directly into js/embedded_sources.js
as plain JS strings instead of being fetched, so there are zero local
fetch() calls left. Pyodide (from a CDN) and the live data pull from Yahoo
are both https:// requests, which file:// pages ARE allowed to make.

OPTIONAL — running via a local server instead:
If your browser is unusually strict (some corporate/locked-down Chrome
policies block ALL file:// script execution, not just fetch), you can
still serve it normally:
  python -m http.server 8000        (then open http://localhost:8000)
  or: npx serve .
This is not required for a normal browser — just a fallback.

USING THE APP
--------------
1. Pick an instrument (NDAQ / XAU / BTC). Fixed to 10y of monthly data,
   $100,000 capital, 100x leverage, 0.10% commission per side, 0 bar delay
   — same locked parameters as the Phase 1 local engine.
2. Click "Load Data." First load fetches live data from Yahoo Finance
   directly in your browser and caches it in localStorage (24h freshness).
   Every load after that is instant — no re-fetch — until you force-refresh
   or the cache expires.
3. Paste, upload, or pick a preset Expert strategy (python/presets/ has the
   three samples: ndaqstrat1.py, xaustrat1.py, btcstrat1.py).
4. Click "Run Backtest." Metrics, trade log, and charts render below.

A NOTE ON THE DATA FETCH
--------------------------
yfinance (the Python library) cannot run inside a browser — it depends on
network calls that only work server-side. To keep this a genuine zero-
backend, browser-only tool, the app instead has JavaScript fetch Yahoo
Finance's public chart data endpoint directly from your browser, then hands
the raw OHLCV numbers to the Python engine for every calculation. If that
fetch is ever blocked by Yahoo's CORS headers for your browser/network,
there's a CSV upload fallback right under "Load Data" so you're never stuck
— export any OHLCV CSV (Date,Open,High,Low,Close,Volume) and upload it.

CHARTS
------
Charts are drawn with plain HTML5 <canvas> — no charting library, no CDN
dependency. Earlier versions used Chart.js from a CDN, which failed in
the same way the Yahoo fetch did (blocked from certain origins/networks).
Removing it means charts now render with zero network requests at all,
using only the equity/drawdown/trade values the Python engine already
computed.

FILES
-----
index.html                Page structure, black/red theme, loading screen
css/style.css              All styling
js/embedded_sources.js     engine.py + preset strategies inlined as JS strings
                            (this is what makes file:// work with no server)
js/canvas_charts.js         Dependency-free chart rendering (plain <canvas>)
js/app.js                  Pyodide bootstrap, data fetch/cache, UI wiring
python/engine.py            Source of truth for the backtest math (kept here
                            for reference/editing — copy changes into
                            embedded_sources.js to take effect in the app)
python/presets/*.py         Source of truth for the 3 sample strategies
                            (same note as above)
