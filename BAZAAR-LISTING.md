# Discovery: win the equities/squeeze lane

The Bazaar (CDP) ranks on semantic match + buyer reach + volume + recency +
metadata quality. Crypto signals are saturated; equity squeeze signals are empty.
So we rank by owning the equities/meme keywords with rich metadata, then earn the
volume/recency signals as agents call.

## Positioning (one line)
The only x402 service purpose-built for US equity short-squeeze mechanics — utilizing Decoupled Micro-Transaction Pulls to serve live Leviathan Matrix states across a curated watchlist of exactly 70 highly-volatile US Equities (including GME, AMC, IWM, and small-caps).

## Keyword targets (already embedded in route metadata)
short squeeze, squeeze pressure, meme stock, GME, AMC, IWM, small-cap, equities
signal, regime, volatility compression, RVOL, breakout, gamma, US stocks, 4H daily, decoupled pull, webhook replacement.

## agents.json snippet for scriptmasterlabs.com
Fill the 2 bracketed values after deploy, then commit + submit sitemap in Search Console.

```json
{
  "x402": {
    "service": "SML x402 Signal API",
    "base_url": "https://[YOUR-RENDER-URL]",
    "network": "base",
    "payment": "USDC via x402",
    "endpoints": [
      { "path": "/matrix/delayed",                 "price": "free",   "desc": "Tier 0 (Shadow): 65-minute artificially delayed payload for backtesting" },
      { "path": "/matrix/subscribe/standard",      "price": "$250",   "desc": "Tier 1 (Standard): Checkout route. Buys a 30-Day Real-Time Token" },
      { "path": "/matrix/live",                    "price": "free",   "desc": "Real-time pull. Requires 30-Day Standard Token in headers" },
      { "path": "/matrix/subscribe/vip",           "price": "$1000",  "desc": "Tier 5 (VIP): Checkout route. Buys a 30-Day VIP Zero-Hop Token" },
      { "path": "/matrix/vip",                     "price": "free",   "desc": "Zero-hop pull. Requires 30-Day VIP Token in headers" }
    ],
    "loyalty": "tiered free-call credits + referral",
    "affiliate": { "rate": 0.15, "param": "?aff=0x..", "settlement": "USDC on Base" },
    "response_signing": "ed25519",
    "wallet": "[YOUR-BASE-WALLET]"
  }
}
```

## Launch acquisition moves (within reason)
1. Free Shadow Tier live -> agents backtest on delayed data before paying (raises Bazaar conversion).
2. Affiliate 15% USDC revenue-share -> recruit promoters; agents pay for their own $250 subscription by referring 7 others.
3. Ed25519-signed responses + published public key -> verifiable trust signal.
4. List on Agentic.Market and x402scan in addition to the CDP Bazaar.
5. One dev.to post ("equity squeeze signals for agents via x402") -> the niche has no
   incumbent content; you rank fast.
