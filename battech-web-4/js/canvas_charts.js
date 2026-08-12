// ══════════════════════════════════════════════════════════════════
// Minimal canvas charting — no external library, no network dependency.
// Draws directly to <canvas> using the browser's built-in 2D context.
// Covers exactly what BAT-TECH needs: line charts, filled area charts,
// bar charts, and a price chart with entry/exit markers.
// ══════════════════════════════════════════════════════════════════

const CHART_COLORS = {
  bg: '#0a0a0a',
  grid: '#1f1f1f',
  axis: '#b8b8b8',
  text: '#f5f5f5',
  white: '#f5f5f5',
  green: '#16c76e',
  red: '#e2001a',
  redDim: 'rgba(226, 0, 26, 0.25)',
};

function setupCanvas(canvasEl) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvasEl.getBoundingClientRect();
  const cssW = Math.max(rect.width, 300);
  const cssH = Math.max(rect.height, 200);

  canvasEl.width = cssW * dpr;
  canvasEl.height = cssH * dpr;
  canvasEl.style.width = cssW + 'px';
  canvasEl.style.height = cssH + 'px';

  const ctx = canvasEl.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = CHART_COLORS.bg;
  ctx.fillRect(0, 0, cssW, cssH);

  return { ctx, w: cssW, h: cssH };
}

function niceRange(min, max) {
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

function drawTitle(ctx, w, title) {
  ctx.fillStyle = CHART_COLORS.text;
  ctx.font = '700 13px Inter, Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(title, 10, 18);
}

function drawAxes(ctx, w, h, plot, yMin, yMax, xLabels) {
  ctx.strokeStyle = CHART_COLORS.grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = CHART_COLORS.axis;
  ctx.font = '400 10px Inter, Arial, sans-serif';

  // Horizontal gridlines + y labels
  const ySteps = 4;
  for (let i = 0; i <= ySteps; i++) {
    const y = plot.top + (plot.height * i) / ySteps;
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.left + plot.width, y);
    ctx.stroke();
    const val = yMax - ((yMax - yMin) * i) / ySteps;
    ctx.textAlign = 'right';
    ctx.fillText(formatAxisNum(val), plot.left - 6, y + 3);
  }

  // X labels (sparse — show ~6 ticks)
  if (xLabels && xLabels.length) {
    const tickCount = Math.min(6, xLabels.length);
    ctx.textAlign = 'center';
    for (let i = 0; i < tickCount; i++) {
      const idx = Math.round((i * (xLabels.length - 1)) / (tickCount - 1 || 1));
      const x = plot.left + (plot.width * idx) / Math.max(xLabels.length - 1, 1);
      ctx.fillText(xLabels[idx], x, plot.top + plot.height + 16);
    }
  }
}

function formatAxisNum(v) {
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(1) + 'k';
  return v.toFixed(1);
}

function getPlotArea(w, h) {
  return { left: 55, top: 28, width: w - 70, height: h - 55 };
}

// ---------------- LINE CHART ----------------
function drawLineChart(canvasEl, labels, values, color, title, fill) {
  const { ctx, w, h } = setupCanvas(canvasEl);
  const plot = getPlotArea(w, h);
  const validVals = values.filter(v => v != null && !isNaN(v));
  const { min, max } = niceRange(Math.min(...validVals), Math.max(...validVals));

  drawTitle(ctx, w, title);
  drawAxes(ctx, w, h, plot, min, max, labels);

  const xFor = i => plot.left + (plot.width * i) / Math.max(values.length - 1, 1);
  const yFor = v => plot.top + plot.height - ((v - min) / (max - min)) * plot.height;

  if (fill) {
    ctx.beginPath();
    ctx.moveTo(xFor(0), yFor(0 > values[0] ? 0 : values[0]));
    values.forEach((v, i) => ctx.lineTo(xFor(i), yFor(v)));
    ctx.lineTo(xFor(values.length - 1), yFor(min));
    ctx.lineTo(xFor(0), yFor(min));
    ctx.closePath();
    ctx.fillStyle = CHART_COLORS.redDim;
    ctx.fill();
  }

  ctx.beginPath();
  values.forEach((v, i) => {
    const x = xFor(i), y = yFor(v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.75;
  ctx.stroke();
}

// ---------------- BAR CHART ----------------
function drawBarChart(canvasEl, labels, values, title) {
  const { ctx, w, h } = setupCanvas(canvasEl);
  const plot = getPlotArea(w, h);
  const validVals = values.filter(v => v != null && !isNaN(v));
  let min = Math.min(0, ...validVals);
  let max = Math.max(0, ...validVals);
  ({ min, max } = niceRange(min, max));

  drawTitle(ctx, w, title);
  drawAxes(ctx, w, h, plot, min, max, labels);

  const zeroY = plot.top + plot.height - ((0 - min) / (max - min)) * plot.height;
  const barW = Math.max((plot.width / values.length) * 0.7, 1);
  const gap = plot.width / values.length;

  values.forEach((v, i) => {
    const x = plot.left + gap * i + (gap - barW) / 2;
    const y = plot.top + plot.height - ((v - min) / (max - min)) * plot.height;
    const barTop = Math.min(y, zeroY);
    const barH = Math.abs(y - zeroY);
    ctx.fillStyle = v >= 0 ? CHART_COLORS.green : CHART_COLORS.red;
    ctx.fillRect(x, barTop, barW, Math.max(barH, 1));
  });
}

// ---------------- PRICE CHART WITH MARKERS ----------------
function drawPriceChart(canvasEl, dates, closePrices, trades, title) {
  const { ctx, w, h } = setupCanvas(canvasEl);
  const plot = getPlotArea(w, h);
  const { min, max } = niceRange(Math.min(...closePrices), Math.max(...closePrices));

  drawTitle(ctx, w, title);
  drawAxes(ctx, w, h, plot, min, max, dates);

  const xFor = i => plot.left + (plot.width * i) / Math.max(closePrices.length - 1, 1);
  const yFor = v => plot.top + plot.height - ((v - min) / (max - min)) * plot.height;

  ctx.beginPath();
  closePrices.forEach((v, i) => {
    const x = xFor(i), y = yFor(v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = CHART_COLORS.white;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const dateIndex = {};
  dates.forEach((d, i) => { dateIndex[d] = i; });

  trades.forEach(t => {
    const entryDate = t.entry_time.slice(0, 10);
    const exitDate = t.exit_time.slice(0, 10);
    const entryIdx = dateIndex[entryDate];
    const exitIdx = dateIndex[exitDate];

    if (entryIdx != null) {
      const x = xFor(entryIdx), y = yFor(t.entry_price);
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = t.direction === 'long' ? CHART_COLORS.green : CHART_COLORS.red;
      ctx.fill();
    }
    if (exitIdx != null) {
      const x = xFor(exitIdx), y = yFor(t.exit_price);
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4);
      ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4);
      ctx.stroke();
    }
  });

  // legend
  ctx.font = '400 10px Inter, Arial, sans-serif';
  ctx.textAlign = 'left';
  const legendY = 14;
  ctx.fillStyle = CHART_COLORS.green; ctx.fillRect(w - 200, legendY - 8, 8, 8);
  ctx.fillStyle = CHART_COLORS.axis; ctx.fillText('Long entry', w - 188, legendY);
  ctx.fillStyle = CHART_COLORS.red; ctx.fillRect(w - 110, legendY - 8, 8, 8);
  ctx.fillStyle = CHART_COLORS.axis; ctx.fillText('Short entry', w - 98, legendY);
}
