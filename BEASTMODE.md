# BEASTMODE — SML Build Manifesto & Non-Negotiables (100%)

These are standing orders. Any agent or builder working on this project MUST obey
them. They override convenience, speed, and defaults. If a rule conflicts with a
shortcut, the rule wins.

## 0. Identity
ScriptMasterLabs (SML). Institutional-grade. Built by a solo operator. The standard
is "BEAST MODE": production-quality, self-audited, real, shippable — never a demo.

## 1. Real data only — NEVER fake
- No mock, demo, placeholder, sample, or hardcoded fake data. Ever.
- If a real data source fails, FIX the source or fail loudly — do not fabricate.
  (This project already swapped Stooq -> Yahoo Finance after Stooq returned 503.)
- Fields that need a paid feed (short interest, days-to-cover, gamma) are explicitly
  FLAGGED as premium hooks, never filled with invented numbers.

## 2. Self-audit BEFORE delivery
- Run the code. Prove it works against real inputs before saying it's done.
- For this service: `node --check` every file, then a live run of the engine, then
  the acceptance tests in BUILD-BRIEF.md. No "should work" — show it works.

## 3. Architecture.md on every build
- Every build ships an ARCHITECTURE.md explaining structure and decisions.
  (Present here. Keep it current if you change anything.)

## 4. No fake/demo/placeholder anything
- Repeated because it matters: real endpoints, real wallets, real keys, real data.
- A fake payable endpoint means agents try to pay and fail. Mark unknowns FILL.

## 5. APEX is sacred and PROPRIETARY
- The APEX Committee Engine (Psi, Omega, Phi, Delta, Sigma) is Timmy's patent-pending
  logic. NEVER reproduce, share, or embed it. This service uses a SEPARATE, public
  squeeze model — APEX is not in this codebase and must not be added by any agent.

## 6. Efficiency rule
- Minimum tokens, no filler, conclusions first. Build, don't narrate.

## 7. Brand (for any UI/site work — N/A to this headless API, listed for completeness)
- Colors: jet black, neon green, hot pink, gold, orange. NO grey. NO cyan.

## 8. Pine Script v6 rules (for SML indicator work — not used here, kept for completeness)
- Single-line only (no multi-line expressions). Function defs at global scope only.
- Typed arrays: array.new<type>(). Reverse for-loops need array.size() > 0 guard.
- shorttitle <= 10 chars. Dual alert system: alertcondition const + alert() JSON.

## 9. Money & uptime (this project)
- Revenue rail is USDC on Base via x402 — NOT XRP/XAH. Agents pay USDC. Ship on USDC.
- 24/7, no cold starts. Render free tier SLEEPS (15 min) and cold-starts 30-60s —
  banned for the live paid API. Use Render Starter ($7/mo, always-on) or equivalent.

## 10. Secrets discipline
- Never commit secrets. .env is gitignored; only .env.example is committed.
- Private keys (wallet, signing key, CDP secret) live in the host's env vars, never
  in source, never echoed in logs.
