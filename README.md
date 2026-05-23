# SML x402 Signal API v2 — BEASTMODE

A pay-per-call trading-signal API for AI agents. Agents pay USDC on Base via x402;
you get paid per call. Purpose-built for US equities + short-squeeze mechanics — the
lane crypto-only rivals leave empty.

## Read in this order
1. BEASTMODE.md ........ non-negotiable build standard (obey this)
2. BUILD-BRIEF.md ...... instructions for the Google Antigravity builder agent
3. DEPLOY.md ........... short human quickstart
4. ARCHITECTURE.md ..... how it works + design decisions
5. BAZAAR-LISTING.md ... discovery copy + agents.json for scriptmasterlabs.com

## Code
- server.js .... routes, x402 paywall, signed responses (Express)
- engine.js .... real-data signal/regime/squeeze engine (Yahoo Finance)
- sign.js ...... ed25519 response signing (+ `node sign.js --gen`)
- ledger.js .... loyalty credits, tiers, referrals, affiliate accrual
- payout.js .... real USDC-on-Base affiliate payouts (viem)
- test-buyer.js  end-to-end buyer test: pay -> earn -> redeem -> free call

## Tiers
- /signal/:ticker/teaser  free   bias only (sample)
- /signal/:ticker         $0.01  bias + momentum + 0-100 score
- /regime/:ticker         $0.05  full multi-factor regime
- /squeeze/:ticker        $0.25  short-squeeze pressure engine (the differentiator)

## Extras
- Loyalty: tiered free-call credits + referrals (?ref=0x..)
- Affiliate: 30% USDC revenue-share (?aff=0x.. or X-Affiliate-ID)
- Trust: ed25519-signed responses, public key at GET /
- Always-on: Render Starter (no cold starts)
