const { Client, Wallet, convertStringToHex } = require('xrpl');
const cfg = require('../config');

let client = null;
let wallet = null;

async function connect() {
  client = new Client(cfg.xrpl.node);
  await client.connect();
  wallet = Wallet.fromSeed(cfg.xrpl.seed);
  console.log(`[XRPL] Connected | Wallet: ${wallet.address}`);
}

async function getBalance() {
  if (!client || !client.isConnected()) await connect();
  try {
    const resp = await client.request({ command: 'account_lines', account: cfg.xrpl.address });
    const rlusd = resp.result.lines.find(l => l.currency === cfg.xrpl.rlusdCurrency && l.account === cfg.xrpl.rlusdIssuer);
    return rlusd ? parseFloat(rlusd.balance) : 0;
  } catch (err) {
    console.error('[XRPL] Balance fetch failed:', err.message);
    return null;
  }
}

async function sendRLUSD(destination, amount, memo) {
  if (!client || !client.isConnected()) await connect();
  const tx = {
    TransactionType: 'Payment',
    Account: wallet.address,
    Amount: { currency: cfg.xrpl.rlusdCurrency, issuer: cfg.xrpl.rlusdIssuer, value: String(amount) },
    Destination: destination,
    Memos: memo ? [{ Memo: { MemoData: convertStringToHex(memo.slice(0, 256)), MemoType: convertStringToHex('tipmaster-x') } }] : undefined,
  };
  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);
  if (result.result.meta.TransactionResult !== 'tesSUCCESS')
    throw new Error(`XRPL tx failed: ${result.result.meta.TransactionResult}`);
  return result.result.hash;
}

async function disconnect() {
  if (client && client.isConnected()) await client.disconnect();
}

module.exports = { connect, disconnect, getBalance, sendRLUSD };
