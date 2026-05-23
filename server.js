// SML x402 Signal API v2.1 — BEASTMODE, multi-chain.
// One chain-agnostic rail. USDC across Base + Polygon (same 0x wallet) + Solana
// (separate address, optional). Free teaser -> $0.01 signal -> $0.05 regime -> $0.25 squeeze.
// Ed25519-signed responses. Loyalty credits + referrals. Affiliate USDC revenue-share.

import express from "express";
import { paymentMiddleware } from "x402-express";
import { facilitator as cdpFacilitator } from "@coinbase/x402";
import { getTeaser, getSignal, getRegime, getSqueeze } from "./engine.js";
import { signPayload, PUBLIC_KEY } from "./sign.js";
import { isAddress } from "viem";
import {
  recordPaidCall, loyaltyStatus, redeem, consumeFreeCall,
  recordAffiliate, affiliateStatus, rosterAdd, AFFILIATE_CONFIG
} from "./ledger.js";

const app = express();
app.use(express.json());

// 24/7 resilience: a transient facilitator/network error on one request must NOT
// take down the whole service. Log and stay alive.
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e?.message || e));
process.on("uncaughtException", (e) => console.error("uncaughtException:", e?.message || e));

const PAY_TO = process.env.PAY_TO_WALLET;            // EVM 0x... (Base + Polygon)
const SOLANA_PAY_TO = process.env.SOLANA_PAY_TO;     // optional Solana address
const PORT = process.env.PORT || 4021;
const TESTNET = process.env.USE_TESTNET === "true";
const facilitator = TESTNET ? { url: "https://www.x402.org/facilitator" } : cdpFacilitator;
if (!PAY_TO) { console.error("FATAL: PAY_TO_WALLET not set."); process.exit(1); }
if (!isAddress(PAY_TO)) { console.error(`FATAL: PAY_TO_WALLET is not a valid address: ${PAY_TO}`); process.exit(1); }

// ---- TIERS ---------------------------------------------------------------
const meta = (chainId, desc, props) => ({
  description: `${desc} (USDC on ${chainId}).`,
  mimeType: "application/json",
  inputSchema: { type: "object", properties: { ticker: { type: "string", description: "US equity symbol e.g. IWM, AMC, GME, SPY" } }, required: ["ticker"] },
  outputSchema: { type: "object", properties: props }
});
const TIERS = [
  { name: "signal", price: "$0.01", priceN: 0.01, fn: getSignal,
    desc: "SML equities signal: directional bias, momentum, 0-100 composite score from live market data. US stocks + meme/squeeze names (GME, AMC, IWM)",
    props: { bias: { type: "string" }, momentum: { type: "string" }, score: { type: "number" } } },
  { name: "regime", price: "$0.05", priceN: 0.05, fn: getRegime,
    desc: "SML full market regime: trend, momentum, volatility regime, RVOL, range position, trend persistence, MA stack",
    props: { volRegime: { type: "string" }, rvol: { type: "number" }, score: { type: "number" } } },
  { name: "squeeze", price: "$0.25", priceN: 0.25, fn: getSqueeze,
    desc: "SML SQUEEZE PRESSURE engine — short-squeeze / coiled-spring detector for US equities. 0-100 pressure score + state + components. The only x402 service built for equity squeeze mechanics",
    props: { squeezePressure: { type: "number" }, squeezeState: { type: "string" }, components: { type: "object" } } }
];

// ---- CHAINS (real, CDP-settable, supported by x402-express) --------------
// Base = primary (no path prefix). Others prefixed. EVM chains share PAY_TO.
const EVM_CHAINS = TESTNET
  ? [{ id: "base-sepolia", prefix: "" }]
  : [{ id: "base", prefix: "" }, { id: "polygon", prefix: "/poly" }];
const SVM_CHAINS = (!TESTNET && SOLANA_PAY_TO) ? [{ id: "solana", prefix: "/sol" }] : [];
const ALL_CHAINS = [...EVM_CHAINS, ...SVM_CHAINS];

function buildRoutes(chains) {
  const r = {};
  for (const ch of chains) for (const t of TIERS)
    r[`GET ${ch.prefix}/${t.name}/[ticker]`] = { price: t.price, network: ch.id, config: meta(ch.id, t.desc, t.props) };
  return r;
}

// ---- helpers -------------------------------------------------------------
const payerOf = (req) => { const p = req.x402Payment || {}; return p.payer || p.from || p.payload?.from || p.account || null; };
const txOf = (req) => { const p = req.x402Payment || {}; return p.transactionHash || p.txHash || null; };
const fail = (res, e) => res.status(502).json({ error: "signal_unavailable", detail: String(e.message || e) });

async function settle(req, priceN, chain) {
  const payer = payerOf(req), ref = req.query.ref;
  const aff = req.query.aff || req.headers["x-affiliate-id"];
  let loyalty = null;
  try { loyalty = await recordPaidCall(payer, priceN, ref); } catch (e) { console.error("ledger:", e.message); }
  if (aff) { try { await rosterAdd(aff); await recordAffiliate(aff, priceN); } catch (e) { console.error("aff:", e.message); } }
  return { chain, loyalty: loyalty ? { tier: loyalty.tier, creditsAvailable: Math.floor(loyalty.credits), calls: loyalty.calls, tierUp: loyalty.tierUp || false } : null };
}
function paidJson(res, data, info, req) {
  res.json(signPayload({ ...data, paidWith: "x402", chain: info.chain, txHash: txOf(req), loyalty: info.loyalty }));
}

// ---- FREE: teaser --------------------------------------------------------
app.get("/signal/:ticker/teaser", async (req, res) => {
  try { res.json(signPayload(await getTeaser(req.params.ticker.toUpperCase()))); } catch (e) { fail(res, e); }
});

// ---- FREE-CALL BYPASS (loyalty credits -> base $0.01 signal only) --------
app.use(async (req, res, next) => {
  if (req.method !== "GET") return next();
  const seg = req.path.split("/").filter(Boolean);          // base signal = ["signal", TICKER]
  if (seg.length !== 2 || seg[0] !== "signal") return next();
  try {
    if (await consumeFreeCall(req.headers.authorization)) {
      const d = await getSignal(seg[1].toUpperCase());
      return res.json(signPayload({ ...d, paidWith: "loyalty-credit" }));
    }
  } catch (e) { return fail(res, e); }
  next();
});

// ---- x402 PAYWALLS (EVM + optional Solana) -------------------------------
app.use(paymentMiddleware(PAY_TO, buildRoutes(EVM_CHAINS), facilitator));
if (SVM_CHAINS.length) {
  try { app.use(paymentMiddleware(SOLANA_PAY_TO, buildRoutes(SVM_CHAINS), facilitator)); }
  catch (e) { console.error("Solana paywall disabled:", e.message); }
}

// ---- PAID ROUTES (generated per chain x tier) ----------------------------
for (const ch of ALL_CHAINS) for (const t of TIERS) {
  app.get(`${ch.prefix}/${t.name}/:ticker`, async (req, res) => {
    try { paidJson(res, await t.fn(req.params.ticker.toUpperCase()), await settle(req, t.priceN, ch.id), req); }
    catch (e) { fail(res, e); }
  });
}

// ---- LOYALTY + AFFILIATE (free reads) ------------------------------------
app.get("/loyalty/:wallet", async (req, res) => { try { res.json(await loyaltyStatus(req.params.wallet)); } catch (e) { res.status(500).json({ error: String(e) }); } });
app.get("/affiliate/:wallet", async (req, res) => { try { res.json({ ...await affiliateStatus(req.params.wallet), rate: AFFILIATE_CONFIG.AFFILIATE_RATE, link: `?aff=${req.params.wallet.toLowerCase()}` }); } catch (e) { res.status(500).json({ error: String(e) }); } });
app.get("/redeem/info", (req, res) => {
  const ts = Math.floor(Date.now() / 1000); const wallet = (req.query.wallet || "0xYourWallet").toLowerCase();
  res.json({ step1_sign_this_message: `SML-REDEEM:${wallet}:${ts}`, step2_post_to: "POST /redeem", body: { wallet, ts, signature: "0x<sig>", calls: 5 }, note: "Then GET /signal with header Authorization: Bearer <token>" });
});
app.post("/redeem", async (req, res) => { try { res.json(await redeem(req.body || {})); } catch (e) { res.status(400).json({ error: String(e.message || e) }); } });

// ---- SERVICE INDEX (free) ------------------------------------------------
app.get("/", (_req, res) => {
  const tiersFor = (prefix) => ({
    signal: `GET ${prefix}/signal/:ticker ($0.01)`, regime: `GET ${prefix}/regime/:ticker ($0.05)`, squeeze: `GET ${prefix}/squeeze/:ticker ($0.25)`
  });
  const chains = {};
  for (const ch of ALL_CHAINS) chains[ch.id] = tiersFor(ch.prefix);
  res.json({
    service: "SML x402 Signal API v2.1 — equities & squeeze, multi-chain",
    teaser: "GET /signal/:ticker/teaser (free)",
    chains, asset: "USDC",
    loyalty: { status: "GET /loyalty/:wallet", redeem: "GET /redeem/info -> POST /redeem", referral: "add ?ref=0x.." },
    affiliate: { status: "GET /affiliate/:wallet", rate: AFFILIATE_CONFIG.AFFILIATE_RATE, attribute: "add ?aff=0x.. or header X-Affiliate-ID" },
    trust: { responseSigning: "ed25519", publicKey: PUBLIC_KEY },
    facilitator: TESTNET ? "x402.org" : "cdp"
  });
});

app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.listen(PORT, () => console.log(`SML x402 v2.1 BEASTMODE on :${PORT} | chains: ${ALL_CHAINS.map(c => c.id).join(", ")}`));
