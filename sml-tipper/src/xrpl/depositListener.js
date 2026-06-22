// Real-time deposit listener — subscribes to both XRPL and Xahau network wallets.
// When a payment arrives with a Twitter handle in the memo, credits the user's balance
// after taking the 1% deposit fee.
const { convertHexToString } = require('xrpl');
const xrplClient = require('./client');
const registry = require('../registry');
const cfg = require('../config');

function parseMemoHandle(tx) {
  try {
    const memos = tx.transaction?.Memos || [];
    for (const { Memo } of memos) {
      if (!Memo?.MemoData) continue;
      const text = convertHexToString(Memo.MemoData);
      // Accept: "twitter:@username" or "twitter:username" or bare "@username"
      const m = text.match(/twitter:@?(\w+)/i) || text.match(/@(\w+)/);
      if (m) return m[1].toLowerCase();
    }
  } catch {}
  return null;
}

function parseAmount(tx, networkName) {
  const amt = tx.transaction.Amount;
  if (typeof amt === 'string') {
    const currency = networkName === 'xahau' ? 'XAH' : 'XRP';
    return { amount: parseFloat(amt) / 1_000_000, currency };
  }
  // IOU (e.g. RLUSD): currency code 'USD' maps to display name 'RLUSD'
  return { amount: parseFloat(amt.value), currency: amt.currency === 'USD' ? 'RLUSD' : amt.currency };
}

async function handleTx(networkName, tx) {
  const txHash = tx.transaction.hash || tx.transaction.TxHash;
  const dedupKey = `deposit:${txHash}`;
  if (registry.isProcessed(dedupKey)) return;
  registry.markProcessed(dedupKey);

  const username = parseMemoHandle(tx);
  if (!username) {
    console.log(`[Deposit] No Twitter handle in memo — tx ${txHash} (unattributed)`);
    return;
  }

  const { amount, currency } = parseAmount(tx, networkName);
  const fee = cfg.fee.depositPct > 0 ? parseFloat((amount * cfg.fee.depositPct).toFixed(6)) : 0;
  const netAmount = parseFloat((amount - fee).toFixed(6));

  registry.creditBalance(username, currency, netAmount);
  registry.logDeposit({ username, xrplAddress: tx.transaction.Account, amount, currency, feeAmount: fee, txHash });

  console.log(`[Deposit] @${username} +${netAmount} ${currency} (fee ${fee}) | tx: ${txHash}`);

  if (fee > 0) {
    const { sendXRP, sendXAH, sendRLUSD } = require('./client');
    const memo = `deposit-fee:${txHash}`;
    try {
      if (currency === 'XAH' && cfg.fee.walletXahau) await sendXAH(cfg.fee.walletXahau, fee, memo);
      else if (currency === 'XRP' && cfg.fee.walletXrpl) await sendXRP(cfg.fee.walletXrpl, fee, memo);
      else if (currency === 'RLUSD' && cfg.fee.walletXrpl) await sendRLUSD(cfg.fee.walletXrpl, fee, memo);
    } catch (err) {
      console.error('[Deposit] Fee forward failed:', err.message);
    }
  }
}

function start() {
  xrplClient.subscribeDeposits(handleTx).catch((err) => {
    console.error('[Deposit] Subscribe failed:', err.message);
  });
  console.log('[Deposit] Listener started');
}

module.exports = { start };
