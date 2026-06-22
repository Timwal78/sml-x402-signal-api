const { Client, Wallet, convertStringToHex } = require('xrpl');
const cfg = require('../config');

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
    return parseFloat(resp.result.account_data.Balance) / 1_000_000;
  } catch (err) {
    console.error('[Xahau] XAH balance failed:', err.message);
    return null;
  }
}

async function sendRLUSD(destination, amount, memo) {
  const net = await getNet('xrpl');
  return submitTx(net, {
    TransactionType: 'Payment',
    Account: net.wallet.address,
    Amount: { currency: cfg.xrpl.rlusdCurrency, issuer: cfg.xrpl.rlusdIssuer, value: String(amount) },
    Destination: destination,
    Memos: memoField(memo),
  });
}

async function sendXRP(destination, amount, memo) {
  const net = await getNet('xrpl');
  return submitTx(net, {
    TransactionType: 'Payment',
    Account: net.wallet.address,
    Amount: Math.floor(amount * 1_000_000).toString(),
    Destination: destination,
    Memos: memoField(memo),
  });
}

async function sendXAH(destination, amount, memo) {
  const net = await getNet('xahau');
  return submitTx(net, {
    TransactionType: 'Payment',
    Account: net.wallet.address,
    Amount: Math.floor(amount * 1_000_000).toString(),
    Destination: destination,
    Memos: memoField(memo),
  });
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

module.exports = { connect, disconnect, getBalance, sendRLUSD, sendXRP, sendXAH };
