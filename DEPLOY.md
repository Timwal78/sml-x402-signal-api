# DEPLOY (human quickstart)

If a builder agent (Google Antigravity) is doing this, hand it BUILD-BRIEF.md — it
contains the full instructions. This file is the short human version.

## You provide 3 sets of secrets (your accounts/money — nobody can make these for you)
1. Base wallet address (Coinbase Wallet) -> PAY_TO_WALLET
2. CDP API key id + secret (portal.cdp.coinbase.com) -> CDP_API_KEY_ID / _SECRET
3. Upstash Redis REST url + token (console.upstash.com, free) -> UPSTASH_* 

## The builder does the rest
- Puts code in your GitHub, deploys to Render (Starter plan = always-on, $7/mo),
  generates the signing key (`node sign.js --gen`), sets env vars, runs the tests.

## Why $7/mo
Render's free tier sleeps after 15 min and cold-starts 30-60s. A live paid API that
sleeps = failed agent payments. Starter is always-on. This is the only paid piece;
CDP (1,000 free/mo), Upstash (free), and Yahoo data (free) cost nothing.

## Go live
Test with USE_TESTNET=true first. When tests pass, set USE_TESTNET=false for real USDC.
