# Credentials for the builder (env vars)

CONFIRMED & validated:
  PAY_TO_WALLET=0x4e14B249D9A4c9c9352D780eCEB508A8eB7a7700      # Base, checksum-valid
  SOLANA_PAY_TO=C9rk2tzM92WxSoMWD32A5wZLgL3z1uN7FSVDExioahfF    # 32-byte pubkey, valid
  CDP_API_KEY_ID=8d05de89-19ec-4e68-b636-847ae2d0d052          # CDP key id

PROVIDED SEPARATELY (do not store in repo / .env committed):
  CDP_API_KEY_SECRET=<paste into Render env only>              # the once-shown secret

STILL NEEDED (free signup, console.upstash.com -> create DB -> REST):
  UPSTASH_REDIS_REST_URL=
  UPSTASH_REDIS_REST_TOKEN=

GENERATE (builder runs this, then sets the printed private value):
  RESPONSE_SIGNING_KEY=   # from: node sign.js --gen

AUTO (render.yaml handles): TOKEN_SECRET (generateValue), AFFILIATE_RATE, REF_* 

NOTES:
- CDP keys unlock mainnet settlement AND the Solana (/sol/*) routes.
- Base + Polygon work with the wallet alone; Solana needs the CDP keys present.
- Without Upstash, the loyalty/affiliate ledger runs in-memory (resets on restart) —
  fine for the test pass, set Upstash before announcing for real.
