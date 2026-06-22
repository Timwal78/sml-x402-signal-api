require('dotenv').config();
const express = require('express');
const cfg = require('./config');
const xrpl = require('./xrpl/client');
const poller = require('./twitter/poller');
const registry = require('./registry');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'tipmaster-x', ts: new Date().toISOString() }));
app.get('/tips', (req, res) => res.json(registry.recentTips()));
app.get('/balance', async (req, res) => {
  const balance = await xrpl.getBalance();
  res.json({ balance, currency: 'RLUSD' });
});

async function main() {
  try {
    await xrpl.connect();
    poller.start();
    app.listen(cfg.app.port, () => console.log(`[TipMaster X] Listening on port ${cfg.app.port}`));
    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.on(sig, async () => { poller.stop(); await xrpl.disconnect(); process.exit(0); });
    }
  } catch (err) {
    console.error('[TipMaster X] Startup failed:', err);
    process.exit(1);
  }
}

main();
