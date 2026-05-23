// Affiliate payout — sends pending USDC (Base mainnet) to affiliates.
// REAL transfers via viem. Gated by VENDOR_PRIVATE_KEY (the wallet that holds USDC).
// Not a trustless on-chain split — it's an automated batch payout you control.
//
// Dry run (no transfers):   node payout.js
// Execute payouts:          PAYOUT_EXECUTE=true node payout.js
//
// Requires: VENDOR_PRIVATE_KEY, RPC_URL (Base), MIN_PAYOUT_USD (default 1).

import { createWalletClient, http, parseUnits, getContract } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { listAffiliates, markAffiliatePaid } from "./ledger.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base mainnet
const ERC20_ABI = [{
  name: "transfer", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }]
}];

const PK = process.env.VENDOR_PRIVATE_KEY;
const RPC = process.env.RPC_URL || "https://mainnet.base.org";
const MIN = Number(process.env.MIN_PAYOUT_USD || 1);
const EXECUTE = process.env.PAYOUT_EXECUTE === "true";

async function main() {
  const affs = (await listAffiliates()).filter(a => a.pendingUsd >= MIN);
  if (!affs.length) { console.log(`No affiliates owed >= $${MIN}.`); return; }

  console.log(`${affs.length} affiliate(s) owed >= $${MIN}:`);
  for (const a of affs) console.log(`  ${a.affiliate}  pending $${a.pendingUsd}`);

  if (!EXECUTE) { console.log("\nDRY RUN. Set PAYOUT_EXECUTE=true to send."); return; }
  if (!PK) { console.error("VENDOR_PRIVATE_KEY required to execute."); process.exit(1); }

  const account = privateKeyToAccount(PK);
  const wallet = createWalletClient({ account, chain: base, transport: http(RPC) });
  const usdc = getContract({ address: USDC, abi: ERC20_ABI, client: wallet });

  for (const a of affs) {
    const amt = a.pendingUsd;
    try {
      const hash = await usdc.write.transfer([a.affiliate, parseUnits(amt.toFixed(6), 6)]);
      await markAffiliatePaid(a.affiliate, amt, hash);
      console.log(`PAID ${a.affiliate} $${amt} tx ${hash}`);
    } catch (e) {
      console.error(`FAILED ${a.affiliate}: ${e.message || e}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
