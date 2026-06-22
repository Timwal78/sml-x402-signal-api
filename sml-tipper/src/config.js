require('dotenv').config();

const required = (key) => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
};

module.exports = {
  twitter: {
    bearerToken: required('TWITTER_BEARER_TOKEN'),
    apiKey: required('TWITTER_API_KEY'),
    apiSecret: required('TWITTER_API_SECRET'),
    accessToken: required('TWITTER_ACCESS_TOKEN'),
    accessSecret: required('TWITTER_ACCESS_SECRET'),
    botUsername: process.env.TWITTER_BOT_USERNAME || 'TipMasterX',
    botUserId: required('TWITTER_BOT_USER_ID'),
  },
  xrpl: {
    seed: required('XRPL_SEED'),
    address: required('XRPL_ADDRESS'),
    node: process.env.XRPL_NODE || 'wss://xrplcluster.com',
    rlusdIssuer: process.env.RLUSD_ISSUER || 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
    rlusdCurrency: 'USD',
  },
  fee: {
    depositPct: parseFloat(process.env.DEPOSIT_FEE_PCT || '0.01'),   // 1% on deposit (cut 1)
    tipPct: parseFloat(process.env.TIP_FEE_PCT || '0.03'),           // 3% on tip send (cut 2)
    walletXrpl:  process.env.FEE_WALLET_XRPL  || '',
    walletXahau: process.env.FEE_WALLET_XAHAU || '',
  },
  xahau: {
    seed: process.env.XAH_SEED || process.env.XRPL_SEED,
    address: process.env.XAH_ADDRESS || process.env.XRPL_ADDRESS,
    node: process.env.XAH_NODE || 'wss://xahau.network',
  },
  app: {
    port: parseInt(process.env.PORT || '3000', 10),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '15000', 10),
    dbPath: process.env.DB_PATH || './data/registry.db',
    minTip: parseFloat(process.env.MIN_TIP || '0.01'),
    maxTip: parseFloat(process.env.MAX_TIP || '1000'),
    defaultCurrency: process.env.DEFAULT_TIP_CURRENCY || 'RLUSD',
    // Captures: recipient, amount, optional currency (RLUSD / XAH / XRP / $XAH / $RLUSD)
    tipRegex: /^@\S+\s+tip\s+@(\S+)\s+([\d.]+)(?:\s+(\$?(?:RLUSD|XAH|XRP)))?/i,
    // split 10 RLUSD @user1 @user2 ...
    splitRegex: /^@\S+\s+split\s+([\d.]+)(?:\s+(\$?(?:RLUSD|XAH|XRP)))?\s+((?:@\S+\s*)+)/i,
    // airdrop 5 RLUSD tweet:1234567890
    airdropRegex: /^@\S+\s+airdrop\s+([\d.]+)(?:\s+(\$?(?:RLUSD|XAH|XRP)))?\s+tweet:(\d+)/i,
    registerRegex: /^@\S+\s+register\s+(r[A-Za-z0-9]{24,34})/i,
    balanceRegex: /^@\S+\s+(?:balance|mybalance)/i,
    topupRegex: /^@\S+\s+topup/i,
    historyRegex: /^@\S+\s+history/i,
    helpRegex: /^@\S+\s+help/i,
  },
};
