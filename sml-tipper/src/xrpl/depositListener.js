// Listens for incoming XRPL/Xahau payments to the bot's address.
// Parses the Twitter handle from the tx memo, credits the user's balance,
// and forwards the deposit fee (cut 1) to the treasury wallet.
const { convertHexToString } = require('xrpl');
const cfg = require('../config');
const registry = require('../registry');
const xrplClient = require('./client');

async function start() {
  await xrplClient.subscribeDeposits(handleTx);
  console.log('[Deposit] Listening for incoming deposits on XRPL + Xahau');
}

async function handleTx(network, data) {
  const tx   = data.transaction || data;
  const meta = data.meta;

  if (tx.TransactionType !== 'Payment') return;

  const botAddr = network === 'xahau' ? cfg.xahau.address : cfg.xrpl.address;
  if (tx.Destination !== botAddr) return;
  if (meta?.TransactionResult !== 'tesSUCCESS') return;

  // Dedup: prefix 'deposit:' so it doesn't collide with tweet IDs
  const dedupKey = `deposit:${tx.hash}`;
  if (registry.isProcessed(dedupKey)) return;
  registry.markProcessed(dedupKey);

  const handle = parseMemo(tx.Memos);
  if (!handle) {
    console.log(`[Deposit:${network}] No Twitter handle in memo — tx ${tx.hash}`);
    return;
  }

  const { currency, grossAmount } = parseAmount(tx.Amount, network);
  if (!currency || grossAmount <= 0) return;

  const fee       = cfg.fee.depositPct > 0 ? parseFloat((grossAmount * cfg.fee.depositPct).toFixed(6)) : 0;
  const netAmount = parseFloat((grossAmount - fee).toFixed(6));

  registry.creditBalance(handle, currency, netAmount);
  registry.logDeposit({ twitterUsername: handle, fromXrpl: tx.Account, currency, grossAmount, feeAmount: fee, netAmount, txHash: tx.hash });

  console.log(`[Deposit:${network}] @${handle} +${netAmount} ${currency} (fee ${fee}) tx:${tx.hash}`);

  // Forward deposit fee to treasury (cut 1)
  if (fee > 0) {
    const feeWallet = network === 'xahau' ? cfg.fee.walletXahau : cfg.fee.walletXrpl;
    if (feeWallet) {
      const send = currency === 'XAH' ? xrplClient.sendXAH
                 : currency === 'RLUSD' ? xrplClient.sendRLUSD
                 : xrplClient.sendXRP;
      send(feeWallet, fee, `deposit-fee:${tx.hash}`).catch(e =>
        console.error('[Deposit] Fee forward failed:', e.message)
      );
    }
  }
}

function parseMemo(memos) {
  if (!memos?.length) return null;
  for (const m of memos) {
    try {
      const txt = convertHexToString(m.Memo?.MemoData || '');
      const match = txt.match(/twitter:@?(\w+)/i) || txt.match(/@(\w+)/);
      if (match) return match[1].toLowerCase();
    } catch {}
  }
  return null;
}

function parseAmount(amount, network) {
  if (typeof amount === 'string') {
    return { currency: network === 'xahau' ? 'XAH' : 'XRP', grossAmount: parseInt(amount, 10) / 1_000_000 };
  }
  if (typeof amount === 'object') {
    return { currency: amount.currency === 'USD' ? 'RLUSD' : amount.currency, grossAmount: parseFloat(amount.value) };
  }
  return { currency: null, grossAmount: 0 };
}

module.exports = { start };
