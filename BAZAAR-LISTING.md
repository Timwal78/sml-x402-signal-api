# Discovery: win the equities/squeeze lane

The Bazaar (CDP) ranks on semantic match + buyer reach + volume + recency +
metadata quality. Crypto signals are saturated; equity squeeze signals are empty.
So we rank by owning the equities/meme keywords with rich metadata, then earn the
volume/recency signals as agents call.

## Positioning (one line)
The only x402 service purpose-built for US equity short-squeeze mechanics —
GME, AMC, IWM, small-caps — not another crypto momentum score.

## Keyword targets (already embedded in route metadata)
short squeeze, squeeze pressure, meme stock, GME, AMC, IWM, small-cap, equities
signal, regime, volatility compression, RVOL, breakout, gamma, US stocks, 4H daily.

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
      { "path": "/signal/{ticker}/teaser", "price": "free", "desc": "Directional bias sample" },
      { "path": "/signal/{ticker}",        "price": "$0.01", "desc": "Bias + momentum + 0-100 score" },
      { "path": "/regime/{ticker}",        "price": "$0.05", "desc": "Full multi-factor regime" },
      { "path": "/squeeze/{ticker}",       "price": "$0.25", "desc": "Short-squeeze pressure engine" }
    ],
    "loyalty": "tiered free-call credits + referral",
    "affiliate": { "rate": 0.30, "param": "?aff=0x..", "settlement": "USDC on Base" },
    "response_signing": "ed25519",
    "wallet": "[YOUR-BASE-WALLET]"
  }
}
```

## Launch acquisition moves (within reason)
1. Free teaser tier live -> agents sample before paying (raises Bazaar conversion).
2. Affiliate 30% USDC revenue-share -> recruit promoters; matches the strongest rival.
3. Ed25519-signed responses + published public key -> verifiable trust signal.
4. List on Agentic.Market and x402scan in addition to the CDP Bazaar.
5. One dev.to post ("equity squeeze signals for agents via x402") -> the niche has no
   incumbent content; you rank fast.
