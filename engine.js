// SML Signal Engine — BEASTMODE. Real data only (no fake/demo/placeholder).
// Live snapshot: Finnhub /quote (free). History: Stooq daily CSV (free, no key).
// Tiers: teaser (free) -> signal ($0.01) -> regime ($0.05) -> squeeze ($0.25).
// Squeeze pressure = the differentiated meme/equities product no x402 rival sells.
// Short-interest / gamma are documented PREMIUM HOOKS, flagged when absent — never faked.

const FINNHUB = process.env.FINNHUB_KEY;

async function quote(ticker) {
  if (!FINNHUB) return null;
  const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB}`);
  if (!r.ok) return null;
  const q = await r.json();
  return q && q.c ? q : null;
}

// Real daily OHLCV from Yahoo Finance chart API (free, no key). Newest-last arrays.
async function history(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1y`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (SML-x402-engine)" } });
  if (!r.ok) throw new Error(`yahoo ${r.status}`);
  const data = await r.json();
  const res = data?.chart?.result?.[0];
  if (!res) throw new Error(`no data for ${ticker}`);
  const q = res.indicators?.quote?.[0] || {};
  const O = q.open || [], H = q.high || [], L = q.low || [], C = q.close || [], V = q.volume || [];
  const o = [], h = [], l = [], c = [], v = [];
  for (let i = 0; i < C.length; i++) {
    if (C[i] == null) continue;
    o.push(O[i]); h.push(H[i]); l.push(L[i]); c.push(C[i]); v.push(V[i] || 0);
  }
  if (c.length < 30) throw new Error(`insufficient history for ${ticker}`);
  return { o, h, l, c, v, meta: res.meta };
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const last = (a) => a[a.length - 1];
function ma(c, n) { return mean(c.slice(-n)); }
function atr(h, l, c, n = 14) {
  const tr = [];
  for (let i = 1; i < c.length; i++)
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  return mean(tr.slice(-n));
}
// Percentile of latest value within a trailing window (0..1). Low ATR pct = coiled.
function pctile(series, lookback = 120) {
  const w = series.slice(-lookback);
  const cur = last(w);
  const below = w.filter((x) => x <= cur).length;
  return below / w.length;
}
// Trend persistence via linear-fit R^2 on last n closes (0..1).
function trendR2(c, n = 20) {
  const y = c.slice(-n); const N = y.length;
  const xs = [...Array(N).keys()];
  const mx = mean(xs), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < N; i++) { sxy += (xs[i]-mx)*(y[i]-my); sxx += (xs[i]-mx)**2; syy += (y[i]-my)**2; }
  const slope = sxy / (sxx || 1);
  const r2 = syy ? (sxy*sxy)/(sxx*syy) : 0;
  return { slope, r2: Math.max(0, Math.min(1, r2)) };
}

// Core real computation shared by all tiers.
async function compute(ticker) {
  const [q, hst] = await Promise.all([quote(ticker), history(ticker)]);
  const { o, h, l, c, v } = hst;
  const price = q?.c ?? hst.meta?.regularMarketPrice ?? last(c);
  const prevClose = q?.pc ?? hst.meta?.chartPreviousClose ?? c[c.length - 2];
  const dayChangePct = ((price - prevClose) / prevClose) * 100;

  const ma20 = ma(c, 20), ma50 = ma(c, Math.min(50, c.length));
  const distMA20 = ((price - ma20) / ma20) * 100;
  const bias = distMA20 > 0.5 ? "BULLISH" : distMA20 < -0.5 ? "BEARISH" : "NEUTRAL";

  const a = atr(h, l, c, 14);
  const atrPct = pctile(c.map((_, i) => i < 14 ? 0 : atrAt(h, l, c, i)), 120); // vol regime
  const volRegime = atrPct < 0.25 ? "COMPRESSED" : atrPct > 0.75 ? "EXPANDED" : "NORMAL";

  const avgVol20 = mean(v.slice(-20));
  const rvol = avgVol20 ? last(v) / avgVol20 : 1;

  // Range position (%B-style) over 20d high/low
  const hi20 = Math.max(...h.slice(-20)), lo20 = Math.min(...l.slice(-20));
  const rangePos = hi20 > lo20 ? (price - lo20) / (hi20 - lo20) : 0.5;

  const { slope, r2 } = trendR2(c, 20);
  const trendDir = slope > 0 ? 1 : -1;

  // 0-100 composite (signal score): trend 40% / momentum 30% / persistence 30%
  const trendComp = Math.max(-1, Math.min(1, distMA20 / 5));
  const momComp = Math.max(-1, Math.min(1, dayChangePct / 3));
  const persComp = trendDir * r2;
  const score = Math.round(50 + (trendComp*0.4 + momComp*0.3 + persComp*0.3) * 50);

  const momentum =
    dayChangePct > 1.5 ? "STRONG_UP" : dayChangePct > 0.2 ? "UP" :
    dayChangePct < -1.5 ? "STRONG_DOWN" : dayChangePct < -0.2 ? "DOWN" : "FLAT";

  // ----- SQUEEZE PRESSURE (the differentiated meme/equities product) -------
  // Coiled spring logic: low volatility (compression) + volume ignition (RVOL)
  // + price pressed toward range high (breakout proximity) + trend persistence.
  const compression = 1 - atrPct;                 // higher = tighter coil
  const ignition = Math.max(0, Math.min(1, (rvol - 1) / 2)); // RVOL>1 builds
  const breakoutProx = rangePos;                  // near 1 = pressing highs
  const persist = r2;
  const squeezePressure = Math.round(
    (compression*0.35 + ignition*0.30 + breakoutProx*0.20 + persist*0.15) * 100
  );
  const squeezeState =
    squeezePressure >= 75 && rvol >= 1.5 ? "IGNITING" :
    squeezePressure >= 60 ? "COILED" :
    rangePos > 0.9 && volRegime === "EXPANDED" ? "EXTENDED" : "DORMANT";

  return {
    ticker, price: round(price), dayChangePct: round(dayChangePct, 2),
    bias, momentum, score: clamp(score), asOf: new Date().toISOString(),
    _ext: { ma20: round(ma20), ma50: round(ma50), atr: round(a,3), atrPctile: round(atrPct,3),
      volRegime, rvol: round(rvol,2), rangePos: round(rangePos,3), trendR2: round(r2,3),
      compression: round(compression,3), ignition: round(ignition,3),
      breakoutProximity: round(breakoutProx,3), squeezePressure: clamp(squeezePressure), squeezeState }
  };
}
function atrAt(h, l, c, i, n = 14) {
  const s = Math.max(1, i - n + 1); const tr = [];
  for (let k = s; k <= i; k++) tr.push(Math.max(h[k]-l[k], Math.abs(h[k]-c[k-1]), Math.abs(l[k]-c[k-1])));
  return mean(tr);
}
const round = (x, d = 2) => Number(Number(x).toFixed(d));
const clamp = (x) => Math.max(0, Math.min(100, x));

// ---- TIERED PUBLIC API ---------------------------------------------------
export async function getTeaser(t) {
  const d = await compute(t);
  return { ticker: d.ticker, bias: d.bias, asOf: d.asOf,
    note: "Teaser: directional bias only. Pay for score, regime, and squeeze pressure." };
}
export async function getSignal(t) {
  const d = await compute(t);
  return { ticker: d.ticker, bias: d.bias, momentum: d.momentum, score: d.score,
    price: d.price, dayChangePct: d.dayChangePct, asOf: d.asOf, engine: "sml-beast-v2" };
}
export async function getRegime(t) {
  const d = await compute(t); const e = d._ext;
  return { ...stripExt(d), volRegime: e.volRegime, rvol: e.rvol, rangePosition: e.rangePos,
    trendPersistence: e.trendR2, ma20: e.ma20, ma50: e.ma50, atr: e.atr, engine: "sml-beast-v2" };
}
export async function getSqueeze(t) {
  const d = await compute(t); const e = d._ext;
  return { ...stripExt(d), squeezePressure: e.squeezePressure, squeezeState: e.squeezeState,
    components: { compression: e.compression, volumeIgnition: e.ignition,
      breakoutProximity: e.breakoutProximity, trendPersistence: e.trendR2, rvol: e.rvol, volRegime: e.volRegime },
    premiumHooks: { shortInterest: "WIRE: paid feed (Finnhub paid / ORATS)",
      daysToCover: "WIRE: paid feed", gammaExposure: "WIRE: options chain (Polygon/ORATS)" },
    engine: "sml-beast-v2" };
}
function stripExt(d) { const { _ext, ...rest } = d; return rest; }
