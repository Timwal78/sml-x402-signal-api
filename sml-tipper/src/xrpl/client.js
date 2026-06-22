const { Client, Wallet, convertStringToHex } = require('xrpl');
const cfg = require('../config');

// Two network clients: XRPL mainnet (RLUSD + XRP) and Xahau (XAH)
const networks = {
  xrpl:  { client: null, wallet: null, cfg: cfg.xrpl,  node: cfg.xrpl.node },
  xahau: { client: null, wallet: null, cfg: cfg.xahau, node: cfg.xahau.node },
};

async function getNet(name) {
  const net = networks[name];
  if (!net.client || !net.client.isConnected()) {
    net.client = new Client(net.node);
    await net.client.connect();
    net.wallet = Wallet.fromSeed(net.cfg.seed);
    console.log(`[XRPL:${name}] Connected | Wallet: ${net.wallet.address}`);
  }
  return net;
}

async function connect() {
  await getNet('xrpl');
  await getNet('xahau');
}

async function getBalance() {
  const [rlusd, xrp, xah] = await Promise.all([getRLUSDBal(), getXRPBal(), getXAHBal()]);
  return { RLUSD: rlusd, XRP: xrp, XAH: xah };
}

async function getXRPBal() {
  try {
    const net = await getNet('xrpl');
    const resp = await net.client.request({ command: 'account_info', account: cfg.xrpl.address, ledger_index: 'validated' });
    return parseFloat(resp.result.account_data.Balance) / 1_000_000;
  } catch (err) {
    console.error('[XRPL] XRP balance failed:', err.message);
    return null;
  }
}

async function getRLUSDBal() {
  try {
    const net = await getNet('xrpl');
    const resp = await net.client.request({ command: 'account_lines', account: cfg.xrpl.address });
    const line = resp.result.lines.find(
      (l) => l.currency === cfg.xrpl.rlusdCurrency && l.account === cfg.xrpl.rlusdIssuer
    );
    return line ? parseFloat(line.balance) : 0;
  } catch (err) {
    console.error('[XRPL] RLUSD balance failed:', err.message);
    return null;
  }
}

async function getXAHBal() {
  try {
    const net = await getNet('xahau');
    const resp = await net.client.request({ command: 'account_info', account: cfg.xahau.address, ledger_index: 'validated' });
    // XAH balance is in drops (1 XAH = 1,000,000 drops)
    return parseFloat(resp.result.account_data.Balance) / 1_000_000;
  } catch (err) {
    console.error('[Xahau] XAH balance failed:', err.message);
    return null;
  }
}

// Subscribe to incoming payments on both network wallets.
// Calls handler(networkName, txData) for each confirmed incoming payment.
async function subscribeDeposits(handler) {
  for (const [name, _net] of Object.entries(networks)) {
    const net = await getNet(name);
    await net.client.request({ command: 'subscribe', accounts: [net.wallet.address] });
    net.client.on('transaction', (tx) => {
      if (
        tx.transaction?.Destination === net.wallet.address &&
        tx.transaction?.TransactionType === 'Payment' &&
        tx.meta?.TransactionResult === 'tesSUCCESS'
      ) {
        handler(name, tx);
      }
    });
    console.log(`[XRPL:${name}] Subscribed to deposits on ${net.wallet.address}`);
  }
}

async function sendRLUSD(destination, amount, memo) {
  const net = await getNet('xrpl');
  const tx = {
    TransactionType: 'Payment',
    Account: net.wallet.address,
    Amount: { currency: cfg.xrpl.rlusdCurrency, issuer: cfg.xrpl.rlusdIssuer, value: String(amount) },
    Destination: destination,
    Memos: memoField(memo),
  };
  return submitTx(net, tx);
}

async function sendXRP(destination, amount, memo) {
  const net = await getNet('xrpl');
  const drops = Math.floor(amount * 1_000_000).toString();
  const tx = {
    TransactionType: 'Payment',
    Account: net.wallet.address,
    Amount: drops,
    Destination: destination,
    Memos: memoField(memo),
  };
  return submitTx(net, tx);
}

async function sendXAH(destination, amount, memo) {
  const net = await getNet('xahau');
  const drops = Math.floor(amount * 1_000_000).toString();
  const tx = {
    TransactionType: 'Payment',
    Account: net.wallet.address,
    Amount: drops,
    Destination: destination,
    Memos: memoField(memo),
  };
  return submitTx(net, tx);
}

async function submitTx(net, tx) {
  const prepared = await net.client.autofill(tx);
  const signed = net.wallet.sign(prepared);
  const result = await net.client.submitAndWait(signed.tx_blob);
  if (result.result.meta.TransactionResult !== 'tesSUCCESS')
    throw new Error(`TX failed: ${result.result.meta.TransactionResult}`);
  return result.result.hash;
}

function memoField(memo) {
  if (!memo) return undefined;
  return [{ Memo: { MemoData: convertStringToHex(memo.slice(0, 256)), MemoType: convertStringToHex('tipmaster-x') } }];
}

async function disconnect() {
  for (const net of Object.values(networks)) {
    if (net.client?.isConnected()) await net.client.disconnect();
  }
}

module.exports = { connect, disconnect, subscribeDeposits, getBalance, sendRLUSD, sendXRP, sendXAH };
