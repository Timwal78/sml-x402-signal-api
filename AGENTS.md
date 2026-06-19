# SML Leviathan Matrix API — AI Agent Development Brief

This is the **SML Leviathan Matrix** — a subscription-based real-time equity intelligence service. Agents pay USDC on Base, Polygon, or Solana for a 30-day bearer token granting access to live squeeze pulls.

## What This Is

NOT a per-ticker signal API. The service is a **subscription matrix**: pay once per month, pull live intelligence feeds as often as you want.

Two tiers:
- **Standard**: $250 USDC / 30 days → real-time matrix feed access
- **VIP**: $1000 USDC / 30 days → zero-hop priority + VIP feed

## Repository Layout

```
sml-x402-signal-api/
├── server.js       — Main Express server: all routes, x402 middleware, matrix pull, TV webhook
├── ledger.js       — Subscription token management, loyalty credits, affiliate tracking
├── sign.js         — Ed25519 signing: signPayload(), PUBLIC_KEY export
├── engine.js       — Signal generation engine (squeeze intelligence)
├── ap2.js          — AP2 (Google Agent Payments Protocol) mandate verifier
├── payout.js       — Affiliate revenue distribution
├── test-buyer.js   — Test script for simulating a full x402 purchase flow
├── CREDENTIALS.md  — Placeholder file documenting required env vars (no real secrets)
└── package.json
```

## Key Files

### `server.js`
The entire API lives here. Key sections:
- `TIERS` array (lines ~41-48): defines pricing and subscription names — edit here to change prices
- `EVM_CHAINS` / `SVM_CHAINS`: chain configuration, Base + Polygon + optional Solana
- `buildRoutes()`: generates x402 payment middleware routes per chain per tier
- `/matrix/:feed/live` and `/matrix/:feed/vip`: token-gated routes
- `/matrix/:feed/delayed`: free route with 65-minute delay gate
- `handleTvWebhook()`: TradingView webhook receiver + Discord broadcast + oracle enrichment
- AP2 mandate middleware (lines ~110-137): Google Agent Payments Protocol gate

### `ledger.js`
All subscription state. Functions:
- `createSubscriptionToken(wallet, tier)` — creates a 30-day bearer token
- `validateSubscriptionToken(authHeader, tier)` — validates Bearer token from Authorization header
- `recordPaidCall(wallet, price, ref)` — records payment, accrues loyalty credits
- `loyaltyStatus(wallet)` — returns tier + credits + calls count
- `affiliateStatus(wallet)` — returns affiliate revenue stats
- `redeem(body)` — burns loyalty credits for free call credits

### `sign.js`
Ed25519 response signing. All paid responses are signed.
- `signPayload(obj)` → returns `{ ...obj, signature: "base64...", publicKey: "..." }`
- `PUBLIC_KEY` → the Ed25519 public key (safe to expose, used by callers to verify)

### `ap2.js`
AP2 (Google Agent Payments Protocol) mandate verifier.
- `mandateFromRequest(req)` — extracts mandate from `X-AP2-MANDATE` header
- `verifyMandate(mandate, context)` — validates W3C VC bundle

## Payment Architecture (x402)
```
Agent → GET /matrix/subscribe/standard
      ← HTTP 402 with payment requirements (USDC amount, address, network)
Agent → pays USDC → sends X-PAYMENT header with settlement proof
      ← JSON { token, tier, expiresAt } (Ed25519 signed)
Agent → GET /matrix/:feed/live with Authorization: Bearer <token>
      ← Live intelligence data (Ed25519 signed)
```

## Multi-Chain Configuration
```
Base (primary):     no path prefix
Polygon:            /poly prefix (e.g. GET /poly/matrix/subscribe/standard)
Solana (optional):  /sol prefix — only active when SOLANA_PAY_TO env var is set
```

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `PAY_TO_WALLET` | YES | EVM 0x wallet for USDC payments (Base + Polygon) |
| `SOLANA_PAY_TO` | No | Solana wallet address for Solana chain support |
| `PORT` | No | Listen port (default: 4021) |
| `USE_TESTNET` | No | "true" for Base Sepolia testnet |
| `DISCORD_WEBHOOK` | No | Discord webhook URL for Leviathan Snap alerts (NEVER hardcode) |
| `TV_WEBHOOK_SECRET` | No | Shared secret for TradingView webhook receiver |
| `AP2_MODE` | No | "off" \| "optional" (default) \| "required" |
| `AP2_TRUSTED_ISSUERS` | No | JSON object of trusted AP2 issuer DIDs |

## Hard Rules

- **NEVER hardcode webhook URLs, wallet addresses, or secrets** — use env vars only
- **DISCORD_WEBHOOK must come from process.env.DISCORD_WEBHOOK** — no fallback default
- **All paid responses must be Ed25519 signed** via `signPayload()` from sign.js
- **Subscription tokens are 30-day** — do not change this without updating CREDENTIALS.md and llms.txt
- **AP2_MODE defaults to "optional"** — never set "required" without verifying all callers support AP2
- **No fake/demo data** — if engine.js returns an error, propagate it; never invent signal values
- **Unhandled rejections are caught at process level** (lines ~23-24) — never remove these; they keep the service alive through transient network errors

## Running Locally

```bash
npm install
PAY_TO_WALLET=0x... PORT=4021 node server.js
```

For testnet:
```bash
USE_TESTNET=true PAY_TO_WALLET=0x... node server.js
```

## Built by ScriptMasterLabs (SDVOSB)
GitHub: https://github.com/Timwal78/sml-x402-signal-api
Ecosystem: https://www.scriptmasterlabs.com
Contact: ScriptMasterLabs@gmail.com
