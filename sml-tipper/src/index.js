require('dotenv').config();
const express = require('express');
const cfg = require('./config');
const xrpl = require('./xrpl/client');
const depositListener = require('./xrpl/depositListener');
const poller = require('./twitter/poller');
const registry = require('./registry');

const app = express();
app.use(express.json());

// Health check — Render uses this
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'tipmaster-x', ts: new Date().toISOString() });
});

// Recent tip log (last 50)
app.get('/tips', (req, res) => {
  res.json(registry.recentTips());
});

// Bot wallet balances across all networks
app.get('/balance', async (req, res) => {
  const balance = await xrpl.getBalance();
  res.json(balance);
});

// Tip leaderboard
app.get('/leaderboard', (req, res) => {
  res.json({
    topTippers: registry.topTippers(10),
    topReceivers: registry.topReceivers(10),
  });
});

async function main() {
  // Bind the HTTP server first so Render's health check passes immediately
  await new Promise((resolve) => {
    app.listen(cfg.app.port, () => {
      console.log(`[TipMaster X] Listening on port ${cfg.app.port}`);
      resolve();
    });
  });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
      console.log(`[TipMaster X] ${sig} received — shutting down`);
      poller.stop();
      await xrpl.disconnect();
      process.exit(0);
    });
  }

  // Connect to XRPL networks and start services in the background
  xrpl.connect()
    .then(() => {
      depositListener.start();
      poller.start();
    })
    .catch((err) => {
      console.error('[TipMaster X] XRPL connect failed:', err.message);
      process.exit(1);
    });
}

main();
