// SML x402 Signal API v2.1 — BEASTMODE, multi-chain.
// One chain-agnostic rail. USDC across Base + Polygon (same 0x wallet) + Solana
// (separate address, optional). Free teaser -> $0.01 signal -> $0.05 regime -> $0.25 squeeze.
// Ed25519-signed responses. Loyalty credits + referrals. Affiliate USDC revenue-share.

import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { paymentMiddleware } from "x402-express";
import { facilitator as cdpFacilitator } from "@coinbase/x402";
import { signPayload, PUBLIC_KEY } from "./sign.js";
import { isAddress } from "viem";
import {
  recordPaidCall, loyaltyStatus, redeem, consumeFreeCall,
  recordAffiliate, affiliateStatus, rosterAdd, AFFILIATE_CONFIG,
  getActiveTarget, setActiveTarget, createSubscriptionToken, validateSubscriptionToken
} from "./ledger.js";

// ---- STARTUP: require critical env vars before doing anything ---------------
const REQUIRED_ENV = ["PAY_TO_WALLET"];
for (const v of REQUIRED_ENV) {
  if (!process.env[v]) {
    console.error(`FATAL: Missing required env var: ${v}`);
    process.exit(1);
  }
}

const app = express();

// ---- SECURITY HEADERS (helmet) ---------------------------------------------
app.disable("x-powered-by");
app.use(helmet({
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  contentSecurityPolicy: false, // API only — no HTML served
}));

// ---- BODY PARSING ----------------------------------------------------------
app.use(express.text({ type: "text/plain" }));
app.use(express.json());

// ---- RATE LIMITING ---------------------------------------------------------
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Rate limit exceeded. Try again later." },
});

const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Webhook rate limit exceeded." },
});

// Apply general rate limit to all routes
app.use(generalLimiter);

// 24/7 resilience: a transient facilitator/network error on one request must NOT
// take down the whole service. Log and stay alive.
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e?.message || e));
process.on("uncaughtException", (e) => console.error("uncaughtException:", e?.message || e));

const PAY_TO = process.env.PAY_TO_WALLET;            // EVM 0x... (Base + Polygon)
const SOLANA_PAY_TO = process.env.SOLANA_PAY_TO;     // optional Solana address
const PORT = process.env.PORT || 4021;
const TESTNET = process.env.USE_TESTNET === "true";
const facilitator = TESTNET ? { url: "https://www.x402.org/facilitator" } : cdpFacilitator;
if (!isAddress(PAY_TO)) { console.error(`FATAL: PAY_TO_WALLET is not a valid EVM address: ${PAY_TO}`); process.exit(1); }

// ---- VALID FEED NAMES (allowlist) ------------------------------------------
const VALID_FEEDS = new Set(["equities", "meme", "etf", "crypto", "ftd"]);
function isValidFeed(feed) {
  return typeof feed === "string" && VALID_FEEDS.has(feed.toLowerCase());
}

// ---- WALLET ADDRESS VALIDATORS ---------------------------------------------
const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isValidEvmAddress(addr) {
  return typeof addr === "string" && EVM_ADDR_RE.test(addr);
}

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
const fail = (res, e) => {
  console.error("Route error:", e?.message || e);
  res.status(502).json({ error: "signal_unavailable" });
};

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
app.get("/matrix/:feed/live", async (req, res) => {
  if (!isValidFeed(req.params.feed)) {
    return res.status(400).json({ error: "invalid_feed", message: "Unknown feed name." });
  }
  try {
    if (!await validateSubscriptionToken(req.headers.authorization, "standard")) {
      return res.status(402).json({ error: "payment_required", message: "Pay 250 USDC at /matrix/subscribe/standard for a 30-day token." });
    }
    res.json(await getActiveTarget(req.params.feed));
  } catch (e) {
    console.error("matrix/live error:", e?.message || e);
    res.status(500).json({ error: "internal_error" });
  }
});

app.get("/matrix/:feed/vip", async (req, res) => {
  if (!isValidFeed(req.params.feed)) {
    return res.status(400).json({ error: "invalid_feed", message: "Unknown feed name." });
  }
  try {
    if (!await validateSubscriptionToken(req.headers.authorization, "vip")) {
      return res.status(402).json({ error: "payment_required", message: "Pay 1000 USDC at /matrix/subscribe/vip for a 30-day VIP token." });
    }
    res.json(await getActiveTarget(req.params.feed));
  } catch (e) {
    console.error("matrix/vip error:", e?.message || e);
    res.status(500).json({ error: "internal_error" });
  }
});

app.get("/matrix/:feed/delayed", async (req, res) => {
  if (!isValidFeed(req.params.feed)) {
    return res.status(400).json({ error: "invalid_feed", message: "Unknown feed name." });
  }
  try {
    const data = await getActiveTarget(req.params.feed);
    if (data.status === "no_active_target") return res.json(data);
    const tsMs = (data.timestamp > 9999999999) ? data.timestamp : (data.timestamp * 1000);
    const ageMs = Date.now() - (tsMs || Date.now());
    if (ageMs < 65 * 60 * 1000) {
      return res.status(403).json({ error: "too_early", message: `Delayed payload available in ${Math.ceil((65 * 60 * 1000 - ageMs) / 60000)} minutes.` });
    }
    res.json(data);
  } catch (e) {
    console.error("matrix/delayed error:", e?.message || e);
    res.status(500).json({ error: "internal_error" });
  }
});

// ---- AP2 MANDATE GATE (Google Agent Payments Protocol) --------------------
// Verifies Intent/Cart/Payment mandates (W3C VCs) before the x402 paywall.
// AP2_MODE env: "off" | "optional" (default) | "required"
import { verifyMandate, mandateFromRequest } from "./ap2.js";
const AP2_MODE = (process.env.AP2_MODE || "optional").toLowerCase();
const AP2_TRUSTED = (() => { try { return JSON.parse(process.env.AP2_TRUSTED_ISSUERS || "{}"); } catch { return {}; } })();
app.use((req, res, next) => {
  if (AP2_MODE === "off") return next();
  const mandate = mandateFromRequest(req);
  if (mandate) {
    const verdict = verifyMandate(mandate, {
      resource: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
      amountAtomicUSDC: 0, // per-route price enforced by x402 layer; mandate caps checked vs declared maxPrice
      payTo: PAY_TO,
      trustedIssuers: AP2_TRUSTED,
    });
    if (!verdict.valid && verdict.reason !== "failed:within_price_cap") {
      return res.status(402).json({ error: "ap2_mandate_invalid", reason: verdict.reason, checks: verdict.checks,
        spec: "https://ap2-protocol.org/specification/" });
    }
    res.set("X-AP2-VERIFIED", "true");
  } else if (AP2_MODE === "required" && (req.path.startsWith("/matrix") || req.path.startsWith("/poly") || req.path.startsWith("/sol"))) {
    return res.status(402).json({ error: "ap2_mandate_required",
      message: "Send X-AP2-MANDATE header (base64 W3C VC bundle).",
      spec: "https://ap2-protocol.org/specification/" });
  }
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
app.get("/loyalty/:wallet", async (req, res) => {
  const wallet = req.params.wallet;
  if (!isValidEvmAddress(wallet)) {
    return res.status(400).json({ error: "invalid_wallet", message: "Must be a valid EVM address (0x...)." });
  }
  try {
    res.json(await loyaltyStatus(wallet));
  } catch (e) {
    console.error("loyalty error:", e?.message || e);
    res.status(500).json({ error: "internal_error" });
  }
});

app.get("/affiliate/:wallet", async (req, res) => {
  const wallet = req.params.wallet;
  if (!isValidEvmAddress(wallet)) {
    return res.status(400).json({ error: "invalid_wallet", message: "Must be a valid EVM address (0x...)." });
  }
  try {
    res.json({ ...await affiliateStatus(wallet), rate: AFFILIATE_CONFIG.AFFILIATE_RATE, link: `?aff=${wallet.toLowerCase()}` });
  } catch (e) {
    console.error("affiliate error:", e?.message || e);
    res.status(500).json({ error: "internal_error" });
  }
});

app.get("/redeem/info", (req, res) => {
  const ts = Math.floor(Date.now() / 1000);
  const rawWallet = req.query.wallet || "0xYourWallet";
  const wallet = isValidEvmAddress(rawWallet) ? rawWallet.toLowerCase() : "0xYourWallet";
  res.json({
    step1_sign_this_message: `SML-REDEEM:${wallet}:${ts}`,
    step2_post_to: "POST /redeem",
    body: { wallet, ts, signature: "0x<sig>", calls: 5 },
    note: "Then GET /signal with header Authorization: Bearer <token>"
  });
});

app.post("/redeem", async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "invalid_request", message: "JSON body required." });
    }
    const { wallet, ts, signature, calls } = body;
    if (typeof wallet !== "string" || typeof ts !== "number" && typeof ts !== "string" || typeof signature !== "string") {
      return res.status(400).json({ error: "invalid_request", message: "wallet, ts, and signature are required." });
    }
    if (!isValidEvmAddress(wallet)) {
      return res.status(400).json({ error: "invalid_wallet", message: "wallet must be a valid EVM address." });
    }
    res.json(await redeem({ wallet, ts, signature, calls }));
  } catch (e) {
    console.error("redeem error:", e?.message || e);
    res.status(400).json({ error: e.message || "redeem_failed" });
  }
});

// ---- SERVICE INDEX (free) ------------------------------------------------
app.get("/", (_req, res) => {
  const tiersFor = (prefix) => ({
    standard: `GET ${prefix}/matrix/subscribe/standard ($250)`, vip: `GET ${prefix}/matrix/subscribe/vip ($1000)`
  });
  const chains = {};
  for (const ch of ALL_CHAINS) chains[ch.id] = tiersFor(ch.prefix);
  res.json({
    service: "SML Leviathan Matrix API — Institutional Equity Squeeze Pulls",
    pulls: { live: "GET /matrix/:feed/live", vip: "GET /matrix/:feed/vip", delayed: "GET /matrix/:feed/delayed (free)" },
    chains, asset: "USDC",
    loyalty: { status: "GET /loyalty/:wallet", redeem: "GET /redeem/info -> POST /redeem", referral: "add ?ref=0x.." },
    affiliate: { status: "GET /affiliate/:wallet", rate: AFFILIATE_CONFIG.AFFILIATE_RATE, attribute: "add ?aff=0x.. or header X-Affiliate-ID" },
    trust: { responseSigning: "ed25519", publicKey: PUBLIC_KEY },
    facilitator: TESTNET ? "x402.org" : "cdp"
  });
});

// ---- GHOST ROUTER (TradingView Webhook Receiver) -------------------------
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const TV_WEBHOOK_SECRET = process.env.TV_WEBHOOK_SECRET;

async function handleTvWebhook(feed, req, res) {
  try {
    // Validate feed param
    if (!isValidFeed(feed)) {
      return res.status(400).json({ error: "invalid_feed" });
    }

    if (TV_WEBHOOK_SECRET && req.headers["x-webhook-secret"] !== TV_WEBHOOK_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }

    let p = req.body;
    if (typeof p === "string") {
      try {
        p = JSON.parse(p);
      } catch (e) {
        return res.status(400).json({ error: "invalid_json_payload" });
      }
    }

    if (!p || typeof p !== "object") return res.status(400).json({ error: "invalid_payload" });
    if (typeof p.ticker !== "string" || !p.ticker) return res.status(400).json({ error: "invalid_payload", message: "ticker required" });
    if (typeof p.action !== "string" || !p.action) return res.status(400).json({ error: "invalid_payload", message: "action required" });

    // Sanitize ticker: only allow alphanumeric + common symbols
    const safeTicker = p.ticker.replace(/[^A-Z0-9.^$-]/gi, "").slice(0, 20);
    if (!safeTicker) return res.status(400).json({ error: "invalid_payload", message: "invalid ticker" });

    console.log(`\n[MATRIX SNAP - ${feed.toUpperCase()}] ${p.action} triggered on ${safeTicker}`);

    // 1. Write to Upstash Vault (use sanitized ticker)
    await setActiveTarget(feed, { ...p, ticker: safeTicker });

    // 2. Oracle Enrichment
    let oracleValid = false;
    let oracleMsg = "";
    try {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 1500);
      const oracleRes = await fetch(`https://lively-fascination-production-41fa.up.railway.app/api/oracle/${encodeURIComponent(safeTicker)}`, {
        signal: abortController.signal
      });
      clearTimeout(timeout);

      if (oracleRes.ok) {
        const data = await oracleRes.json();
        oracleValid = data?.status === "success"
          && data?.oracle?.confidence > 0
          && data?.oracle?.directive !== "SHIELD";

        if (oracleValid) {
          // Map confidence to A/B/C grade
          const conf = data.oracle.confidence || 0;
          let grade = "D GRADE";
          if (conf >= 80) grade = "A GRADE";
          else if (conf >= 60) grade = "B GRADE";
          else if (conf >= 40) grade = "C GRADE";

          // Try to extract price targets safely
          const targets = data.oracle.price_targets || data.oracle.targets || data.oracle;
          const tp = targets.tp1 || targets.tp || "N/A";
          const stop = targets.stop || targets.stop_loss || "N/A";

          oracleMsg = `\n🧠 Oracle Directive: ${data.oracle.directive} (${grade} - ${conf}% conf · ${data.oracle.regime} regime)\n🎯 Target: $${tp} | 🛑 Stop Loss: $${stop}`;
        }
      }
    } catch (e) {
      console.error("Oracle fetch err:", e.message);
    }

    // 3. Broadcast to Discord
    if (DISCORD_WEBHOOK) {
      const title = p.system === "SML_FTD_Hunter" ? "FTD HUNTER" : "LEVIATHAN SNAP";
      let msg = `🚨 [**${feed.toUpperCase()}**] **${title}**: **${p.action}** on **${safeTicker}** ($${p.close || "N/A"})`;

      if (oracleValid) {
        msg += oracleMsg;
      }

      msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🏛️ Full Council brief available:\n   • AI Agents (x402): POST /api/council → 0.10 RLUSD\n   • MCP: tools/call council_verdict (symbol=${safeTicker})\n   • Humans: scriptmasterlabs.com/council\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

      fetch(DISCORD_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: msg })
      })
      .then(async (r) => {
        if (!r.ok) {
          const txt = await r.text();
          console.error(`Discord webhook failed (${r.status}):`, txt);
        }
      })
      .catch(e => console.error("Discord network err:", e.message));
    }

    res.status(200).json({ status: "secured" });
  } catch (e) {
    console.error("Webhook err:", e?.message || e);
    res.status(500).json({ error: "internal_error" });
  }
}

app.post("/webhook/tv", webhookLimiter, (req, res) => handleTvWebhook("equities", req, res));
app.post("/api/tv/:feed/webhook", webhookLimiter, (req, res) => handleTvWebhook(req.params.feed, req, res));

app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.listen(PORT, () => console.log(`SML x402 v2.1 BEASTMODE on :${PORT} | chains: ${ALL_CHAINS.map(c => c.id).join(", ")}`));
