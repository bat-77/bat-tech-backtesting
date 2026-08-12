// ══════════════════════════════════════════════════════════════════
// BAT-TECH QUANTITAVE — Browser Backtest Engine (Phase 2, Pyodide)
// ══════════════════════════════════════════════════════════════════

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h cache freshness
let pyodide = null;
let selectedTicker = null;
let selectedName = null;
let loadedData = null; // {records: [...]}

const loadingScreen = document.getElementById('loading-screen');
const progressBar = document.getElementById('progress-bar');
const loadingStatus = document.getElementById('loading-status');
const appEl = document.getElementById('app');

function showLoading(msg, pct) {
  loadingScreen.classList.remove('hidden');
  loadingScreen.style.display = 'flex';
  loadingStatus.textContent = msg;
  progressBar.style.width = (pct != null ? pct : 5) + '%';
}
function hideLoading() {
  loadingScreen.style.display = 'none';
}

// ══════════════════════════════════════════════════════════════════
// 1. BOOTSTRAP: Load Pyodide + pandas/numpy + engine.py
// ══════════════════════════════════════════════════════════════════
async function bootstrap() {
  showLoading('Loading Python runtime (Pyodide)...', 15);
  pyodide = await loadPyodide();

  showLoading('Loading pandas & numpy packages...', 45);
  await pyodide.loadPackage(['pandas', 'numpy']);

  showLoading('Loading BAT-TECH engine...', 75);
  // Engine source is inlined (js/embedded_sources.js) rather than fetched,
  // so this works from file:// with no local server required.
  pyodide.runPython(ENGINE_PY_SRC);

  showLoading('Ready.', 100);
  setTimeout(() => {
    hideLoading();
    appEl.classList.remove('hidden');
  }, 300);
}
bootstrap();

// ══════════════════════════════════════════════════════════════════
// 2. INSTRUMENT SELECTION
// ══════════════════════════════════════════════════════════════════
document.querySelectorAll('.instrument-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.instrument-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedTicker = btn.dataset.ticker;
    selectedName = btn.dataset.name;
    document.getElementById('load-data-btn').disabled = false;
    document.getElementById('force-refresh-btn').disabled = false;
    document.getElementById('synthetic-data-btn').disabled = false;
    loadedData = null;
    document.getElementById('run-btn').disabled = true;

    const cached = getCachedData(selectedTicker);
    if (cached) {
      setCacheStatus(`Cached data available for ${selectedName} (${cached.source || 'unknown'}, fetched ${timeAgo(cached.fetchedAt)}). Click "Load Data" to use it.`);
    } else {
      setCacheStatus(`No cached data for ${selectedName} yet.`);
    }
  });
});

function setCacheStatus(msg) {
  document.getElementById('cache-status').textContent = msg;
}
function timeAgo(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

// ══════════════════════════════════════════════════════════════════
// 3. DATA CACHE (localStorage)
// ══════════════════════════════════════════════════════════════════
function cacheKey(ticker) { return `battech_data_${ticker}`; }

function getCachedData(ticker) {
  try {
    const raw = localStorage.getItem(cacheKey(ticker));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function setCachedData(ticker, records, source) {
  const payload = { fetchedAt: Date.now(), records, source: source || 'unknown' };
  try {
    localStorage.setItem(cacheKey(ticker), JSON.stringify(payload));
  } catch (e) {
    console.warn('Cache write failed (storage full?):', e);
  }
  return payload;
}

// ══════════════════════════════════════════════════════════════════
// 4. FETCH DATA FROM YAHOO (client-side, best effort)
// ══════════════════════════════════════════════════════════════════
async function fetchYahooData(ticker) {
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=10y&interval=1mo`;

  // Try several paths in order: direct fetch, then a couple of CORS relays.
  // A file:// page has a "null" origin that Yahoo's CORS headers don't
  // cover, so the direct request commonly fails — the relays wrap the
  // response with permissive headers that DO allow null origins.
  const attempts = [
    { label: 'direct', url: yahooUrl },
    { label: 'allorigins relay', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}` },
    { label: 'corsproxy relay', url: `https://corsproxy.io/?url=${encodeURIComponent(yahooUrl)}` },
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const resp = await fetch(attempt.url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      const result = json?.chart?.result?.[0];
      if (!result) throw new Error('Unexpected response shape.');

      const timestamps = result.timestamp;
      const quote = result.indicators.quote[0];
      const records = [];
      for (let i = 0; i < timestamps.length; i++) {
        if (quote.open[i] == null || quote.close[i] == null) continue;
        records.push({
          date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
          open: quote.open[i], high: quote.high[i],
          low: quote.low[i], close: quote.close[i],
          volume: quote.volume[i] ?? 0,
        });
      }
      if (records.length === 0) throw new Error('No usable bars returned.');
      return { records, source: `live (${attempt.label})` };
    } catch (err) {
      lastError = err;
      console.warn(`Fetch attempt "${attempt.label}" failed:`, err.message);
    }
  }
  throw lastError || new Error('All fetch attempts failed.');
}

document.getElementById('load-data-btn').addEventListener('click', () => loadData(false));
document.getElementById('force-refresh-btn').addEventListener('click', () => loadData(true));

async function loadData(forceRefresh) {
  if (!selectedTicker) return;

  if (!forceRefresh) {
    const cached = getCachedData(selectedTicker);
    if (cached) {
      loadedData = cached.records;
      setCacheStatus(`Using cached data for ${selectedName} (${cached.records.length} bars, fetched ${timeAgo(cached.fetchedAt)}).`);
      document.getElementById('run-btn').disabled = !expertCodeReady();
      return;
    }
  }

  showLoading(`Downloading ${selectedName} data...`, 20);
  try {
    const { records, source } = await fetchYahooData(selectedTicker);
    showLoading(`Caching ${selectedName} data to browser...`, 80);
    setCachedData(selectedTicker, records, source);
    loadedData = records;
    showLoading('Done.', 100);
    setTimeout(hideLoading, 250);
    setCacheStatus(`Loaded ${records.length} monthly bars for ${selectedName} (${source}, now cached).`);
    document.getElementById('run-btn').disabled = !expertCodeReady();
  } catch (err) {
    hideLoading();
    console.error(err);
    setCacheStatus(`Live fetch failed on all routes (${err.message}). Use "Generate Synthetic Data" below to test the engine now, or upload a CSV for real data.`);
  }
}

// ══════════════════════════════════════════════════════════════════
// 4b. SYNTHETIC DATA GENERATOR (guaranteed fallback — no network needed)
// ══════════════════════════════════════════════════════════════════
// Deterministic seeded random walk so results are reproducible run to run.
// This is NOT real market data — it exists so the engine/math can always
// be exercised even with zero network access, per the Phase 1 goal of
// "discover what breaks," which doesn't require real prices.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYNTH_PROFILES = {
  'NDAQ': { seed: 1001, startPrice: 14000, monthlyDrift: 0.010, monthlyVol: 0.045 },
  'XAU':  { seed: 2002, startPrice: 1800,  monthlyDrift: 0.006, monthlyVol: 0.035 },
  'BTC':  { seed: 3003, startPrice: 20000, monthlyDrift: 0.020, monthlyVol: 0.140 },
};

function generateSyntheticData(name) {
  const profile = SYNTH_PROFILES[name] || SYNTH_PROFILES['NDAQ'];
  const rand = mulberry32(profile.seed);
  const records = [];
  let price = profile.startPrice;

  // Box-Muller for roughly-normal monthly returns
  function gaussian() {
    const u1 = Math.max(rand(), 1e-9);
    const u2 = rand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  const today = new Date();
  const months = 120; // 10y monthly
  for (let i = months; i >= 1; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const monthReturn = profile.monthlyDrift + gaussian() * profile.monthlyVol;
    const open = price;
    price = Math.max(price * (1 + monthReturn), 0.01);
    const close = price;
    const hi = Math.max(open, close) * (1 + Math.abs(gaussian()) * 0.02);
    const lo = Math.min(open, close) * (1 - Math.abs(gaussian()) * 0.02);
    records.push({
      date: d.toISOString().slice(0, 10),
      open: Number(open.toFixed(2)),
      high: Number(hi.toFixed(2)),
      low: Number(Math.max(lo, 0.01).toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: Math.round(1_000_000 * (1 + rand())),
    });
  }
  return records;
}

document.getElementById('synthetic-data-btn').addEventListener('click', () => {
  if (!selectedTicker) {
    setCacheStatus('Select an instrument first.');
    return;
  }
  const records = generateSyntheticData(selectedName);
  setCachedData(selectedTicker, records, 'synthetic');
  loadedData = records;
  setCacheStatus(`Loaded ${records.length} SYNTHETIC bars for ${selectedName} (seeded random walk, not real market data — now cached).`);
  document.getElementById('run-btn').disabled = !expertCodeReady();
});

// CSV fallback
document.getElementById('csv-upload').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !selectedTicker) {
    setCacheStatus('Select an instrument first, then upload a CSV.');
    return;
  }
  const text = await file.text();
  const records = parseCSV(text);
  if (records.length === 0) {
    setCacheStatus('CSV parse failed — check the column headers (Date,Open,High,Low,Close,Volume).');
    return;
  }
  setCachedData(selectedTicker, records, 'CSV upload');
  loadedData = records;
  setCacheStatus(`Loaded ${records.length} bars for ${selectedName} from uploaded CSV (now cached).`);
  document.getElementById('run-btn').disabled = !expertCodeReady();
});

function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const idx = {
    date: headers.indexOf('date'),
    open: headers.indexOf('open'),
    high: headers.indexOf('high'),
    low: headers.indexOf('low'),
    close: headers.indexOf('close'),
    volume: headers.indexOf('volume'),
  };
  if (idx.date === -1 || idx.close === -1) return [];
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 2) continue;
    records.push({
      date: cols[idx.date],
      open: parseFloat(cols[idx.open]),
      high: parseFloat(cols[idx.high]),
      low: parseFloat(cols[idx.low]),
      close: parseFloat(cols[idx.close]),
      volume: idx.volume !== -1 ? parseFloat(cols[idx.volume]) : 0,
    });
  }
  return records;
}

// ══════════════════════════════════════════════════════════════════
// 5. EXPERT CODE INPUT (paste, upload, presets)
// ══════════════════════════════════════════════════════════════════
const expertTextarea = document.getElementById('expert-code');

function expertCodeReady() {
  return expertTextarea.value.trim().length > 0 && loadedData !== null;
}

expertTextarea.addEventListener('input', () => {
  document.getElementById('run-btn').disabled = !expertCodeReady();
});

document.getElementById('expert-upload').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  expertTextarea.value = await file.text();
  document.getElementById('run-btn').disabled = !expertCodeReady();
});

document.getElementById('preset-select').addEventListener('change', (e) => {
  const val = e.target.value;
  if (!val || !PRESET_SOURCES[val]) return;
  expertTextarea.value = PRESET_SOURCES[val];
  document.getElementById('run-btn').disabled = !expertCodeReady();
});

// ══════════════════════════════════════════════════════════════════
// 6. RUN BACKTEST
// ══════════════════════════════════════════════════════════════════
document.getElementById('run-btn').addEventListener('click', runBacktest);

async function runBacktest() {
  const runStatus = document.getElementById('run-status');
  showLoading('Running backtest in Python...', 30);
  runStatus.textContent = '';

  try {
    const recordsJson = JSON.stringify(loadedData);
    const expertCode = expertTextarea.value;

    pyodide.globals.set('js_records_json', recordsJson);
    pyodide.globals.set('js_expert_code', expertCode);

    showLoading('Executing strategy bar-by-bar...', 60);
    const resultJson = pyodide.runPython('run_full_backtest(js_records_json, js_expert_code)');

    showLoading('Rendering results...', 90);
    const result = JSON.parse(resultJson);
    renderResults(result);

    showLoading('Done.', 100);
    setTimeout(hideLoading, 250);
  } catch (err) {
    hideLoading();
    console.error(err);
    runStatus.textContent = `Error: ${err.message || err}`;
  }
}

// ══════════════════════════════════════════════════════════════════
// 7. RENDER RESULTS (metrics table, trade log, charts)
// ══════════════════════════════════════════════════════════════════
function renderResults(result) {
  document.getElementById('panel-results').classList.remove('hidden');

  // Metrics table
  const metricsWrap = document.getElementById('metrics-table-wrap');
  let mHtml = '<table>';
  for (const [k, v] of Object.entries(result.metrics)) {
    mHtml += `<tr><td>${k}</td><td>${v}</td></tr>`;
  }
  mHtml += '</table>';
  metricsWrap.innerHTML = mHtml;

  // Trade log
  const tradeWrap = document.getElementById('trade-log-wrap');
  let tHtml = '<table><tr><th>#</th><th>Dir</th><th>Entry</th><th>Exit</th><th>Entry $</th><th>Exit $</th><th>Net P&L</th><th>Bars</th><th>Reason</th></tr>';
  result.trades.forEach((t, i) => {
    const cls = t.net_pnl >= 0 ? 'pnl-positive' : 'pnl-negative';
    tHtml += `<tr>
      <td>${i + 1}</td><td>${t.direction.toUpperCase()}</td>
      <td>${t.entry_time.slice(0, 10)}</td><td>${t.exit_time.slice(0, 10)}</td>
      <td>${t.entry_price.toFixed(2)}</td><td>${t.exit_price.toFixed(2)}</td>
      <td class="${cls}">$${t.net_pnl.toFixed(2)}</td>
      <td>${t.bars_held}</td><td>${t.exit_reason}</td>
    </tr>`;
  });
  tHtml += '</table>';
  tradeWrap.innerHTML = tHtml || '<p class="hint">No trades were generated.</p>';

  drawCharts(result);
}

let lastResult = null; // kept so we can redraw charts on window resize

function drawCharts(result) {
  lastResult = result;
  const dates = result.dates;

  drawPriceChart(
    document.getElementById('chart-price'),
    dates, result.close_prices, result.trades,
    'Price with Entries/Exits'
  );

  drawLineChart(
    document.getElementById('chart-equity'),
    dates, result.equity_curve, '#16c76e', 'Equity Curve', false
  );

  drawLineChart(
    document.getElementById('chart-drawdown'),
    dates, result.drawdown_curve.map(d => -d), '#e2001a', 'Drawdown', true
  );

  const monthlyRets = [];
  for (let i = 1; i < result.equity_curve.length; i++) {
    monthlyRets.push(((result.equity_curve[i] - result.equity_curve[i - 1]) / result.equity_curve[i - 1]) * 100);
  }
  drawBarChart(
    document.getElementById('chart-monthly'),
    dates.slice(1), monthlyRets, 'Monthly Equity Returns (%)'
  );

  const pnls = result.trades.map(t => t.net_pnl);
  const pnlLabels = pnls.map((_, i) => `#${i + 1}`);
  drawBarChart(
    document.getElementById('chart-tradepnl'),
    pnlLabels, pnls, 'Trade-by-Trade Net P&L'
  );
}

// Redraw charts on resize so canvases stay crisp/full-width
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (lastResult) drawCharts(lastResult); }, 200);
});
