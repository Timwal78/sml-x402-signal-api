require('dotenv').config();
const express = require('express');
const cfg = require('./config');
const xrpl = require('./xrpl/client');
const depositListener = require('./xrpl/depositListener');
const poller = require('./twitter/poller');
const registry = require('./registry');

const app = express();
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'tipmaster-x', ts: new Date().toISOString() }));

app.get('/tips', (_, res) => res.json(registry.recentTips()));

app.get('/balance', async (_, res) => {
  const b = await xrpl.getBalance();
  res.json(b);
});

app.get('/leaderboard', (_, res) => {
  res.json({
    topTippers:   registry.topTippers(10),
    topReceivers: registry.topReceivers(10),
  });
});

async function main() {
  try {
    await xrpl.connect();
    await depositListener.start(); // real-time deposit detection
    poller.start();                // mention polling

    app.listen(cfg.app.port, () =>
      console.log(`[TipMaster X] Live on port ${cfg.app.port}`)
    );

    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.on(sig, async () => {
        console.log(`[TipMaster X] ${sig} — shutting down`);
        poller.stop();
        await xrpl.disconnect();
        process.exit(0);
      });
    }
  } catch (err) {
    console.error('[TipMaster X] Startup failed:', err);
    process.exit(1);
  }
}

main();
