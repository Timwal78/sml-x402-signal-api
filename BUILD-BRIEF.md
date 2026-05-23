# BUILD BRIEF — for the Google Antigravity builder agent

You are deploying a complete, working x402 paid signal API. The code is DONE and
self-audited (see ARCHITECTURE.md). Your job is to get it live, 24/7, and selling.
READ BEASTMODE.md first — those are non-negotiable standing orders.

## Mission
Take this folder, put it in the owner's GitHub, deploy it always-on, wire the secrets,
verify it works end-to-end, and list it for agent discovery. The owner (Timmy) does
NOT code. Do as much autonomously as your permissions allow; hand back only the steps
that require his accounts/money.

## Division of labor — read carefully
- ALREADY DONE (by Claude): all source code, config, signing, loyalty, affiliate,
  payout script, tests, docs. Engine verified live against real Yahoo Finance data.
- YOU (Antigravity) do: create/connect the repo, push the code, create the Render
  service from render.yaml, set env vars, run `node sign.js --gen`, run the acceptance
  tests, and prepare the discovery listing. You have terminal + Git + browser access —
  use them.
- TIMMY must personally provide (you cannot create these — they are his money/accounts):
  1. PAY_TO_WALLET — his Base wallet address (0x...). If he has none: guide him to
     create one in Coinbase Wallet, then he pastes the address.
  2. CDP_API_KEY_ID + CDP_API_KEY_SECRET — from portal.cdp.coinbase.com (mainnet payout
     facilitator; free 1,000 settlements/mo).
  3. UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN — from console.upstash.com
     (free Redis; the durable loyalty/affiliate ledger).
  4. Render billing enabled (Starter is $7/mo, required for always-on — see below).
  Everything else you generate or set yourself.

## Repo question (answered)
Recommended: create a NEW dedicated repo `sml-x402-signal-api` under the owner's
GitHub (Timwal78). A dedicated repo gives Render the cleanest one-service auto-deploy.
Alternative (if the owner prefers the monorepo): add it to the existing `SqueezeOS`
repo at `services/sml-x402-signal-api/` and set Render's Root Directory to that path
(this mirrors how mcp-paywall lives in SqueezeOS). Either is fine — pick one and note
which you used. NOTE: the live signal service is SEPARATE from SqueezeOS app code; do
not entangle it with SqueezeOS internals.

## Steps you execute
1. Put this folder's contents in the chosen repo. Confirm .gitignore excludes .env.
2. `npm install` locally; run `node --check` on every .js; run a live engine test:
   `node --input-type=module -e "import('./engine.js').then(m=>m.getSqueeze('IWM').then(console.log))"`
   It MUST print real numbers. If not, fix before continuing (BEASTMODE rule 2).
3. Generate the signing key: `node sign.js --gen`. Put the printed PRIVATE value into
   RESPONSE_SIGNING_KEY (Render env). Keep the public key for the discovery listing.
4. Create the Render Web Service from render.yaml (plan: starter — always-on).
   Set all `sync: false` env vars using Timmy's secrets above.
5. Deploy. Confirm the health check at `/health` is green.
6. Run the ACCEPTANCE TESTS below. All must pass before you report "live".
7. Prepare discovery (BAZAAR-LISTING.md): fill the agents.json snippet with the live
   URL + wallet, commit it to scriptmasterlabs.com, and submit the sitemap in Google
   Search Console. Confirm the CDP Bazaar can see the service (it auto-indexes once
   real x402 payments flow through the CDP facilitator).

## 24/7 — NO COLD STARTS (hard requirement)
- render.yaml is set to `plan: starter` ($7/mo, always-on, no sleep). This is required.
- Do NOT deploy the live paid API on Render free tier: it sleeps after 15 min and
  cold-starts 30-60s. For a paid API that's failed agent calls and lost ranking.
- If Timmy wants zero cost to start: deploy free ONLY for a test pass, then switch the
  plan to Starter before announcing it. Equivalent always-on hosts (Railway, Fly.io)
  are acceptable substitutes if he prefers.

## ACCEPTANCE TESTS (must all pass)
A. `GET /` returns the service index with all 4 tiers + the ed25519 public key.
B. `GET /signal/IWM/teaser` returns a bias + `_sig` (free, no payment).
C. `GET /signal/IWM` with NO payment returns HTTP 402 (paywall works).
D. Run `node test-buyer.js` with a funded buyer wallet (testnet first via
   USE_TESTNET=true): it completes pay -> earn -> redeem -> free call.
E. After a paid call, `GET /loyalty/<payer>` shows calls >= 1. If it shows 0, fix the
   payer field in server.js `payerOf()` (x402-express version difference — noted in
   ARCHITECTURE.md), then re-test.
F. `GET /squeeze/GME` (paid) returns squeezePressure + components + `_sig`.
G. `/health` returns ok.

## When done
Report back: repo URL, live service URL, which plan, the ed25519 public key, and the
results of tests A-G. Then Timmy flips USE_TESTNET=false for live USDC and announces.
