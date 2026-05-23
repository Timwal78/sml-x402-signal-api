// SML x402 Signal API v2.1 — BEASTMODE, multi-chain.
// One chain-agnostic rail. USDC across Base + Polygon (same 0x wallet) + Solana
// (separate address, optional). Free teaser -> $0.01 signal -> $0.05 regime -> $0.25 squeeze.
// Ed25519-signed responses. Loyalty credits + referrals. Affiliate USDC revenue-share.

import express from "express";
import { paymentMiddleware } from "x402-express";
import { facilitator as cdpFacilitator } from "@coinbase/x402";
import { signPayload, PUBLIC_KEY } from "./sign.js";
import { isAddress } from "viem";
import {
  recordPaidCall, loyaltyStatus, redeem, consumeFreeCall,
  recordAffiliate, affiliateStatus, rosterAdd, AFFILIATE_CONFIG,
  getActiveTarget, setActiveTarget, createSubscriptionToken, validateSubscriptionToken
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
  { name: "matrix/subscribe/standard", price: "$250.00", priceN: 250.00, noTicker: true,
    desc: "30-Day Real-Time Bearer Token for Leviathan Matrix",
    props: { token: { type: "string" }, tier: { type: "string" }, expiresAt: { type: "string" } } },
  { name: "matrix/subscribe/vip", price: "$1000.00", priceN: 1000.00, noTicker: true,
    desc: "30-Day VIP Zero-Hop Token for Leviathan Matrix",
    props: { token: { type: "string" }, tier: { type: "string" }, expiresAt: { type: "string" } } }
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
  for (const ch of chains) for (const t of TIERS) {
    const path = t.noTicker ? `GET ${ch.prefix}/${t.name}` : `GET ${ch.prefix}/${t.name}/[ticker]`;
    r[path] = { price: t.price, network: ch.id, config: meta(ch.id, t.desc, t.props) };
  }
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

// ---- DECOUPLED MATRIX PULL ROUTES (Token Required) -----------------------
app.get("/matrix/live", async (req, res) => {
  if (!await validateSubscriptionToken(req.headers.authorization, "standard")) {
    return res.status(402).json({ error: "payment_required", message: "Pay 250 USDC at /matrix/subscribe/standard for a 30-day token." });
  }
  res.json(await getActiveTarget());
});

app.get("/matrix/vip", async (req, res) => {
  if (!await validateSubscriptionToken(req.headers.authorization, "vip")) {
    return res.status(402).json({ error: "payment_required", message: "Pay 1000 USDC at /matrix/subscribe/vip for a 30-day VIP token." });
  }
  res.json(await getActiveTarget());
});

app.get("/matrix/delayed", async (req, res) => {
  const data = await getActiveTarget();
  if (data.status === "no_active_target") return res.json(data);
  const tsMs = (data.timestamp > 9999999999) ? data.timestamp : (data.timestamp * 1000);
  const ageMs = Date.now() - (tsMs || Date.now());
  if (ageMs < 65 * 60 * 1000) {
    return res.status(403).json({ error: "too_early", message: `Delayed payload available in ${Math.ceil((65 * 60 * 1000 - ageMs) / 60000)} minutes.` });
  }
  res.json(data);
});

// ---- x402 PAYWALLS (EVM + optional Solana) -------------------------------
app.use(paymentMiddleware(PAY_TO, buildRoutes(EVM_CHAINS), facilitator));
if (SVM_CHAINS.length) {
  try { app.use(paymentMiddleware(SOLANA_PAY_TO, buildRoutes(SVM_CHAINS), facilitator)); }
  catch (e) { console.error("Solana paywall disabled:", e.message); }
}

// ---- PAID ROUTES (generated per chain x tier) ----------------------------
for (const ch of ALL_CHAINS) for (const t of TIERS) {
  const route = t.noTicker ? `${ch.prefix}/${t.name}` : `${ch.prefix}/${t.name}/:ticker`;
  app.get(route, async (req, res) => {
    try {
      const info = await settle(req, t.priceN, ch.id);
      const payer = payerOf(req);
      const tierLabel = t.name.includes("vip") ? "vip" : "standard";
      const tokenData = await createSubscriptionToken(payer || "0xAnonymous", tierLabel);
      paidJson(res, tokenData, info, req);
    }
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
    standard: `GET ${prefix}/matrix/subscribe/standard ($250)`, vip: `GET ${prefix}/matrix/subscribe/vip ($1000)`
  });
  const chains = {};
  for (const ch of ALL_CHAINS) chains[ch.id] = tiersFor(ch.prefix);
  res.json({
    service: "SML Leviathan Matrix API — Institutional Equity Squeeze Pulls",
    pulls: { live: "GET /matrix/live", vip: "GET /matrix/vip", delayed: "GET /matrix/delayed (free)" },
    chains, asset: "USDC",
    loyalty: { status: "GET /loyalty/:wallet", redeem: "GET /redeem/info -> POST /redeem", referral: "add ?ref=0x.." },
    affiliate: { status: "GET /affiliate/:wallet", rate: AFFILIATE_CONFIG.AFFILIATE_RATE, attribute: "add ?aff=0x.. or header X-Affiliate-ID" },
    trust: { responseSigning: "ed25519", publicKey: PUBLIC_KEY },
    facilitator: TESTNET ? "x402.org" : "cdp"
  });
});

// ---- GHOST ROUTER (TradingView Webhook Receiver) -------------------------
const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1507577494918664355/Jq3SpGZDaIKh-qRz-9_jdTgVkUy7m1_ofLum1LrNEWak0ONs1frpNv2S6diCAhg_1chh";

app.post("/webhook/tv", async (req, res) => {
  try {
    const p = req.body;
    if (!p || !p.ticker || !p.action) return res.status(400).json({ error: "invalid_payload" });
    console.log(`\n[MATRIX SNAP] ${p.action} triggered on ${p.ticker}`);
    
    // 1. Write to Upstash Vault
    await setActiveTarget(p);
    
    // 2. Broadcast to Discord
    const title = p.system === "SML_FTD_Hunter" ? "FTD HUNTER" : "LEVIATHAN SNAP";
    const msg = `🚨 **${title}**: **${p.action}** triggered on **${p.ticker}**! (Live across 70 curated equities)`;
    fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: msg })
    }).catch(e => console.error("Discord err:", e.message));

    res.status(200).json({ status: "secured" });
  } catch (e) {
    console.error("Webhook err:", e);
    res.status(500).json({ error: "internal_error" });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.listen(PORT, () => console.log(`SML x402 v2.1 BEASTMODE on :${PORT} | chains: ${ALL_CHAINS.map(c => c.id).join(", ")}`));
