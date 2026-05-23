// Buyer-side end-to-end test of the SML x402 Signal API + loyalty loop.
// Runs the FULL loop: pay -> earn credits -> redeem (signed) -> free call.
//
// Setup (one time):
//   npm i x402-fetch viem
//   Fund BUYER_PRIVATE_KEY's wallet with USDC:
//     testnet -> Base Sepolia USDC from the CDP faucet
//     mainnet -> real USDC on Base
//
// Run:
//   API_URL=https://your-url BUYER_PRIVATE_KEY=0x... node test-buyer.js

import { wrapFetchWithPayment } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";

const API = (process.env.API_URL || "http://localhost:4021").replace(/\/$/, "");
const PK = process.env.BUYER_PRIVATE_KEY;
const TICKER = process.env.TICKER || "IWM";
// A referrer address (must differ from buyer) so the buyer's FIRST paid call
// earns welcome credits -> lets the redeem step actually run in one pass.
const REF = process.env.REFERRER || "0x000000000000000000000000000000000000dEaD";

if (!PK) { console.error("Set BUYER_PRIVATE_KEY=0x..."); process.exit(1); }

const account = privateKeyToAccount(PK);
const payFetch = wrapFetchWithPayment(fetch, account);
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const line = (s) => console.log("\n" + s);

async function main() {
  console.log("Buyer wallet:", account.address);
  console.log("API:", API);

  // --- 1) PAID CALL (x402 auto-pays) -------------------------------------
  line("1) Paid call -> GET /signal/" + TICKER);
  const r1 = await payFetch(`${API}/signal/${TICKER}?ref=${REF}`);
  const d1 = await j(r1);
  console.log("status:", r1.status);
  console.log("signal:", JSON.stringify(d1, null, 2));

  // --- 2) LOYALTY STATUS -------------------------------------------------
  line("2) Loyalty -> GET /loyalty/" + account.address);
  const d2 = await j(await fetch(`${API}/loyalty/${account.address}`));
  console.log(JSON.stringify(d2, null, 2));

  const free = d2.freeCallsAvailable || 0;
  if (free < 1) {
    line("Not enough credits to redeem yet (have " + free + ").");
    console.log("Make more paid calls or use a real referrer. Loop test stops here.");
    return;
  }

  // --- 3) REDEEM (sign to prove wallet ownership) ------------------------
  line("3) Redeem 1 free call (signed)");
  const ts = Math.floor(Date.now() / 1000);
  const message = `SML-REDEEM:${account.address.toLowerCase()}:${ts}`;
  const signature = await account.signMessage({ message });
  const d3 = await j(await fetch(`${API}/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: account.address, ts, signature, calls: 1 })
  }));
  console.log(JSON.stringify(d3, null, 2));
  if (!d3.token) { line("Redeem failed."); return; }

  // --- 4) FREE CALL with the credit token --------------------------------
  line("4) Free call -> GET /signal/" + TICKER + "  (Bearer credit token)");
  const r4 = await fetch(`${API}/signal/${TICKER}`, {
    headers: { Authorization: `Bearer ${d3.token}` }
  });
  const d4 = await j(r4);
  console.log("status:", r4.status, "| paidWith:", d4.paidWith);
  console.log("signal:", JSON.stringify(d4, null, 2));

  line("Loop complete: paid -> earned -> redeemed -> free call served. ✅");
}

main().catch((e) => { console.error("ERROR:", e.message || e); process.exit(1); });
