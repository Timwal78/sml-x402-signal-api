// SML Reward Ledger — loyalty engine for x402 API callers (agents/devs).
// Tiers accrue free-call credits; referrals earn bonus credits.
// Storage: Upstash Redis REST (free tier, durable) or in-memory fallback (local).

import crypto from "crypto";
import { verifyMessage } from "viem";

// ---- STORAGE -------------------------------------------------------------
const U_URL = process.env.UPSTASH_REDIS_REST_URL;
const U_TOK = process.env.UPSTASH_REDIS_REST_TOKEN;
const mem = new Map();
const durable = Boolean(U_URL && U_TOK);

async function cmd(...args) {
  if (!durable) {
    // in-memory mini-implementation of GET/SET/DEL
    const [op, key, val] = args;
    if (op === "GET") return mem.has(key) ? mem.get(key) : null;
    if (op === "SET") { mem.set(key, val); return "OK"; }
    if (op === "DEL") { mem.delete(key); return 1; }
    return null;
  }
  const r = await fetch(U_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${U_TOK}`, "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  if (!r.ok) throw new Error(`storage error: ${r.status}`);
  const { result } = await r.json();
  return result;
}
const getJSON = async (k) => { const v = await cmd("GET", k); return v ? JSON.parse(v) : null; };
const setJSON = (k, o) => cmd("SET", k, JSON.stringify(o));

// ---- TIERS (by cumulative USDC spend) ------------------------------------
// earnPer = USDC you must spend to earn 1 free-call credit (lower = better).
const TIERS = [
  { name: "PLATINUM", min: 100, earnPer: 0.20 },
  { name: "GOLD",     min: 25,  earnPer: 0.30 },
  { name: "SILVER",   min: 5,   earnPer: 0.40 },
  { name: "BRONZE",   min: 0,   earnPer: 0.50 }
];
function tierFor(spend) { return TIERS.find(t => spend >= t.min) || TIERS[TIERS.length - 1]; }

// Referral rewards (credits = free calls)
const REF_REFERRER_BONUS = Number(process.env.REF_REFERRER_BONUS || 10); // referrer
const REF_REFEREE_WELCOME = Number(process.env.REF_REFEREE_WELCOME || 5); // new caller

const norm = (w) => String(w || "").toLowerCase();
const key = (w) => `sml:wallet:${norm(w)}`;

async function loadWallet(w) {
  return (await getJSON(key(w))) || {
    wallet: norm(w), calls: 0, spend: 0, credits: 0,
    tier: "BRONZE", referredBy: null, refCount: 0, firstSeen: new Date().toISOString()
  };
}

// ---- RECORD A SETTLED PAID CALL ------------------------------------------
// Called AFTER x402 verifies+settles. payer = actual on-chain payer address.
// amountUsd = price paid. ref = optional referrer wallet (first call only).
export async function recordPaidCall(payer, amountUsd, ref) {
  if (!payer) return null;
  const acct = await loadWallet(payer);
  const prevTier = tierFor(acct.spend);

  acct.calls += 1;
  acct.spend = Number((acct.spend + amountUsd).toFixed(6));
  const tier = tierFor(acct.spend);
  acct.tier = tier.name;

  // Accrue credits at the tier earn-rate, on this call's spend.
  const earned = amountUsd / tier.earnPer;
  acct.credits = Number((acct.credits + earned).toFixed(4));

  // Referral: only on the referee's FIRST ever paid call, ref must differ from self.
  if (acct.calls === 1 && ref && norm(ref) !== norm(payer) && !acct.referredBy) {
    acct.referredBy = norm(ref);
    acct.credits += REF_REFEREE_WELCOME;
    const refAcct = await loadWallet(ref);
    refAcct.credits += REF_REFERRER_BONUS;
    refAcct.refCount += 1;
    await setJSON(key(ref), refAcct);
  }

  await setJSON(key(payer), acct);
  return { ...acct, tierUp: tier.name !== prevTier.name && acct.calls > 1 };
}

// ---- PUBLIC STATUS -------------------------------------------------------
export async function loyaltyStatus(w) {
  const a = await loadWallet(w);
  const t = tierFor(a.spend);
  const next = TIERS.filter(x => x.min > a.spend).sort((x, y) => x.min - y.min)[0] || null;
  return {
    wallet: a.wallet, tier: t.name, calls: a.calls,
    spendUsd: a.spend, credits: Math.floor(a.credits),
    freeCallsAvailable: Math.floor(a.credits),
    refCount: a.refCount, referredBy: a.referredBy,
    nextTier: next ? { name: next.name, spendNeededUsd: Number((next.min - a.spend).toFixed(2)) } : null,
    referralLink: `?ref=${a.wallet}`,
    durableStore: durable
  };
}

// ---- REDEMPTION (signature-gated, prevents spoofing) ---------------------
// Agent signs message "SML-REDEEM:<wallet>:<ts>" with its wallet, then we
// convert credits -> a short-lived HMAC bearer token good for N free calls.
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString("hex");
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const REDEEM_WINDOW_S = 300;         // signed ts must be within 5 min

function sign(payloadB64) {
  return crypto.createHmac("sha256", TOKEN_SECRET).update(payloadB64).digest("base64url");
}

// Constant-time string comparison to prevent timing attacks
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still run timingSafeEqual on same-length buffers to avoid length-based timing leak
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function redeem({ wallet, ts, signature, calls }) {
  const n = Math.max(1, Math.floor(Number(calls) || 1));
  const now = Math.floor(Date.now() / 1000);
  if (!wallet || !ts || !signature) throw new Error("missing wallet/ts/signature");
  if (Math.abs(now - Number(ts)) > REDEEM_WINDOW_S) throw new Error("signature expired");

  const usedKey = `sml:used:${norm(wallet)}:${ts}`;
  if (await cmd("GET", usedKey)) throw new Error("already redeemed");

  const message = `SML-REDEEM:${norm(wallet)}:${ts}`;
  const ok = await verifyMessage({ address: wallet, message, signature });
  if (!ok) throw new Error("bad signature");

  const acct = await loadWallet(wallet);
  if (Math.floor(acct.credits) < n) throw new Error(`insufficient credits (have ${Math.floor(acct.credits)})`);

  acct.credits = Number((acct.credits - n).toFixed(4));
  await setJSON(key(wallet), acct);
  await cmd("SET", usedKey, "1");

  const tokenId = crypto.randomBytes(12).toString("base64url");
  const exp = Date.now() + TOKEN_TTL_MS;
  await setJSON(`sml:rt:${tokenId}`, { wallet: norm(wallet), remaining: n, exp });

  const body = Buffer.from(JSON.stringify({ tokenId, exp })).toString("base64url");
  return { token: `${body}.${sign(body)}`, freeCalls: n, expiresAt: new Date(exp).toISOString() };
}

// Validate a bearer free-call token and decrement one use. Returns true if served free.
export async function consumeFreeCall(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  const tok = authHeader.slice(7);
  const [body, sig] = tok.split(".");
  if (!body || !sig || !safeEqual(sign(body), sig)) return false;
  let parsed;
  try { parsed = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return false; }
  if (Date.now() > parsed.exp) return false;

  const rec = await getJSON(`sml:rt:${parsed.tokenId}`);
  if (!rec || rec.remaining <= 0) return false;
  rec.remaining -= 1;
  if (rec.remaining <= 0) await cmd("DEL", `sml:rt:${parsed.tokenId}`);
  else await setJSON(`sml:rt:${parsed.tokenId}`, rec);
  return true;
}

export const _config = { TIERS, REF_REFERRER_BONUS, REF_REFEREE_WELCOME };

// ==== AFFILIATE REVENUE-SHARE (USDC, acquisition lever) ===================
// Affiliates pass ?aff=0x.. or header X-Affiliate-ID. A % of each paid call
// accrues to their pending balance, paid out in USDC on Base via payout.js.
const AFFILIATE_RATE = Number(process.env.AFFILIATE_RATE || 0.15); // 15% default
const affKey = (w) => `sml:aff:${norm(w)}`;

export async function recordAffiliate(affiliate, amountUsd) {
  if (!affiliate) return null;
  const a = (await getJSON(affKey(affiliate))) ||
    { affiliate: norm(affiliate), earnedUsd: 0, paidUsd: 0, pendingUsd: 0, calls: 0, lastTx: null };
  const share = Number((amountUsd * AFFILIATE_RATE).toFixed(6));
  a.earnedUsd = Number((a.earnedUsd + share).toFixed(6));
  a.pendingUsd = Number((a.pendingUsd + share).toFixed(6));
  a.calls += 1;
  await setJSON(affKey(affiliate), a);
  return a;
}

export async function affiliateStatus(w) {
  return (await getJSON(affKey(w))) ||
    { affiliate: norm(w), earnedUsd: 0, paidUsd: 0, pendingUsd: 0, calls: 0, lastTx: null };
}

// Used by payout.js: list affiliates owed >= minUsd.
export async function listAffiliates() {
  // SCAN is limited on some stores; we keep a roster set for portability.
  const roster = (await getJSON("sml:aff:roster")) || [];
  const out = [];
  for (const w of roster) out.push(await affiliateStatus(w));
  return out;
}
export async function rosterAdd(w) {
  const r = new Set((await getJSON("sml:aff:roster")) || []);
  if (!r.has(norm(w))) { r.add(norm(w)); await setJSON("sml:aff:roster", [...r]); }
}
export async function markAffiliatePaid(w, amountUsd, txHash) {
  const a = await affiliateStatus(w);
  a.paidUsd = Number((a.paidUsd + amountUsd).toFixed(6));
  a.pendingUsd = Number(Math.max(0, a.pendingUsd - amountUsd).toFixed(6));
  a.lastTx = txHash;
  await setJSON(affKey(w), a);
  return a;
}
export const AFFILIATE_CONFIG = { AFFILIATE_RATE };

export async function getActiveTarget(feed = "equities") {
  const key = `SML:ACTIVE_TARGET:${feed.toUpperCase()}`;
  const val = await getJSON(key);
  if (!val) {
    return { status: "no_active_target", message: `Matrix for ${feed} is silent.` };
  }
  return val;
}

export async function setActiveTarget(feed, payload) {
  const key = `SML:ACTIVE_TARGET:${feed.toUpperCase()}`;
  await setJSON(key, payload);
  console.log(`[VAULT SECURED] ${payload.ticker || "Target"} payload pushed to ${key}. Available for API extraction.`);
}

// ==== 30-DAY SUBSCRIPTION PASSES ==========================================
const SUB_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function createSubscriptionToken(wallet, tier) {
  const tokenId = crypto.randomBytes(16).toString("base64url");
  const exp = Date.now() + SUB_TTL_MS;
  await setJSON(`sml:sub:${tokenId}`, { wallet: norm(wallet), tier, exp });
  const body = Buffer.from(JSON.stringify({ tokenId, exp, tier })).toString("base64url");
  return { token: `${body}.${sign(body)}`, tier, expiresAt: new Date(exp).toISOString() };
}

export async function validateSubscriptionToken(authHeader, requiredTier) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  const tok = authHeader.slice(7);
  const [body, sig] = tok.split(".");
  if (!body || !sig || !safeEqual(sign(body), sig)) return false;
  let parsed;
  try { parsed = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return false; }
  if (Date.now() > parsed.exp) return false;
  const rec = await getJSON(`sml:sub:${parsed.tokenId}`);
  if (!rec) return false;
  if (requiredTier === "standard" && rec.tier !== "standard" && rec.tier !== "vip") return false;
  if (requiredTier === "vip" && rec.tier !== "vip") return false;
  return true;
}
