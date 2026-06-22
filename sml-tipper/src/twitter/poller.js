const { getMentions } = require('./client');
const handler = require('../handler');
const registry = require('../registry');
const cfg = require('../config');

let sinceId = null;
let pollTimer = null;

async function poll() {
  try {
    const resp = await getMentions(sinceId);
    const tweets = resp.data?.data || [];
    const users = resp.data?.includes?.users || [];
    const userMap = {};
    for (const u of users) userMap[u.id] = u.username;
    if (tweets.length === 0) return;
    for (const tweet of [...tweets].reverse()) {
      if (registry.isProcessed(tweet.id)) continue;
      registry.markProcessed(tweet.id);
      const authorUsername = userMap[tweet.author_id] || tweet.author_id;
      await handler.handleMention({ tweet, authorUsername });
      if (!sinceId || BigInt(tweet.id) > BigInt(sinceId)) sinceId = tweet.id;
    }
  } catch (err) {
    console.error('[Poller] Error:', err.message);
  }
}

function start() {
  console.log(`[Poller] Starting — every ${cfg.app.pollIntervalMs / 1000}s for @${cfg.twitter.botUsername}`);
  poll();
  pollTimer = setInterval(poll, cfg.app.pollIntervalMs);
}

function stop() { if (pollTimer) clearInterval(pollTimer); }

module.exports = { start, stop };
