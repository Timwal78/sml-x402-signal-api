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
    network: process.env.XRPL_NETWORK || 'mainnet',
    node: process.env.XRPL_NODE || 'wss://xrplcluster.com',
    rlusdIssuer: process.env.RLUSD_ISSUER || 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
    rlusdCurrency: 'USD',
    minTip: parseFloat(process.env.MIN_TIP || '0.01'),
    maxTip: parseFloat(process.env.MAX_TIP || '1000'),
  },
  app: {
    port: parseInt(process.env.PORT || '3000', 10),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '15000', 10),
    dbPath: process.env.DB_PATH || './data/registry.db',
    tipRegex: /^@\S+\s+tip\s+@(\S+)\s+([\d.]+)(?:\s+RLUSD)?/i,
    registerRegex: /^@\S+\s+register\s+(r[A-Za-z0-9]{24,34})/i,
    balanceRegex: /^@\S+\s+balance/i,
    helpRegex: /^@\S+\s+help/i,
  },
};
