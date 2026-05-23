# ARCHITECTURE — SML x402 Signal API v2 (BEASTMODE)

## Strategy: own the empty lane
Every x402 signal rival is crypto (BTC/ETH/SOL/pump.fun). US-equity squeeze
signals have no incumbent. We win by (1) a differentiated squeeze engine on real
data, (2) a free teaser + tiered depth pricing, (3) trust + acquisition edges:
ed25519-signed responses and a 30% USDC affiliate revenue-share.

## Tiers
- GET /signal/:ticker/teaser   free    bias only (sample -> Bazaar conversion)
- GET /signal/:ticker          $0.01   bias + momentum + 0-100 score
- GET /regime/:ticker          $0.05   vol regime, RVOL, range pos, persistence, MA stack
- GET /squeeze/:ticker         $0.25   squeeze-pressure score + state + components

## Data (real only; no fake/demo)
- History: Yahoo Finance chart API (free, no key, reliable from servers).
  [Stooq was tested and rejected — 503 from server IPs.]
- Live quote: optional Finnhub override if FINNHUB_KEY set.
- Short interest / days-to-cover / gamma: documented PREMIUM HOOKS, flagged when
  absent. Never fabricated.

## Squeeze pressure model (the differentiator)
Coiled-spring composite from real OHLCV:
  compression (1 - ATR percentile) .35
  volume ignition (RVOL>1)         .30
  breakout proximity (range pos)   .20
  trend persistence (fit R^2)      .15
State: DORMANT / COILED / IGNITING / EXTENDED.
NOTE: this is a real, defensible model — NOT the proprietary APEX engine, which is
not included. Swap deeper logic in via engine.js compute() keeping output shape.

## Trust: ed25519 signing
Every response carries _sig {alg, publicKey, signature} over canonical (sorted-key)
JSON. Stable key via RESPONSE_SIGNING_KEY (node sign.js --gen). Public key published
at GET /. Agents can verify authenticity on-chain-style.

## Loyalty (callers)
Fixed base price (no spoofable pre-discounts). Paid calls accrue free-call CREDITS
keyed to the actual on-chain payer; tier sets earn rate. Redemption requires a wallet
signature (viem verifyMessage) -> short-lived HMAC bearer token. Credits redeem the
$0.01 signal tier only (no cross-tier arbitrage). Referrals: ?ref=0x.. -> bonus credits.

## Affiliate (acquisition)
?aff=0x.. or X-Affiliate-ID accrues AFFILIATE_RATE (default 30%) of each paid call to
the affiliate's pending balance. payout.js sends real USDC on Base (viem) from
VENDOR_PRIVATE_KEY. Attribution+accrual automatic; payout is a controlled batch script
(dry-run by default). Not a trustless on-chain split — that needs a router contract.

## Files
engine.js (tiers + squeeze) | sign.js (ed25519) | ledger.js (loyalty + affiliate)
server.js (routes + paywall + metadata) | payout.js (USDC payouts) | test-buyer.js

## Self-audit (Build Manifesto) — DONE
- Real data verified live (Yahoo) across IWM/GME/AMC/SPY. No placeholders shipped.
- Data-source failure caught (Stooq 503) and replaced before delivery.
- Loyalty keyed to verified payer; redemption signature-gated. No spoofing.
- APEX not reproduced. Premium-data fields hooked, not faked.
- All modules pass node --check; engine passes live run.

## Confirm on first live paid call
x402-express payer field name varies by version. server.js reads payer defensively
(payer|from|payload.from|account). After first paid call, GET /loyalty/<payer> should
show 1 call; if 0, adjust payerOf() in server.js.

## Multi-chain (v2.1)
One rail, multiple chains. Routes are generated per chain x tier from a config:
- Base    : /signal /regime /squeeze            (primary, no prefix; USDC)
- Polygon : /poly/signal /poly/regime /poly/squeeze   (same 0x wallet; USDC)
- Solana  : /sol/signal /sol/regime /sol/squeeze       (needs SOLANA_PAY_TO; USDC)
EVM chains share PAY_TO_WALLET (one paymentMiddleware). Solana uses a second
middleware with SOLANA_PAY_TO. All settle via the CDP facilitator.

### Two verified gotchas (don't regress these)
1. x402-express route KEYS use BRACKET params: "GET /signal/[ticker]" — NOT Express
   colon ":ticker". Colon keys compile to a regex that matches nothing, leaving the
   route WIDE OPEN (unpaid 200s). Express handler paths still use ":ticker".
2. Solana (SVM) routes query the CDP facilitator's "supported" endpoint at request
   time -> they REQUIRE CDP_API_KEY_ID/SECRET. Without them, Solana requests fail
   (process-level guards keep the service alive; EVM routes keep working).

### 24/7 resilience
process.on('unhandledRejection'/'uncaughtException') log-and-survive guards ensure a
transient facilitator/network error on one request never takes down the service.
Deploy on Render Starter (always-on) — never the sleeping free tier.

### Verified pre-deploy (testnet, x402.org facilitator)
GET / 200 | teaser 200 | signal/regime/squeeze -> 402 with valid payment terms
(scheme exact, maxAmountRequired 10000 = $0.01 USDC atomic) | health 200 | alive
after all hits. Mainnet Base+Polygon gate 402; Solana gates once CDP keys are set.
