const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('./config');

const dbDir = path.dirname(path.resolve(app.dbPath));
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.resolve(app.dbPath));

db.exec(`
  CREATE TABLE IF NOT EXISTS wallets (
    twitter_username TEXT PRIMARY KEY,
    twitter_user_id  TEXT,
    xrpl_address     TEXT NOT NULL,
    registered_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS processed_tweets (
    tweet_id TEXT PRIMARY KEY,
    processed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS tip_log (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    from_username    TEXT NOT NULL,
    to_username      TEXT NOT NULL,
    to_xrpl_address  TEXT NOT NULL,
    amount           TEXT NOT NULL,
    tx_hash          TEXT,
    tweet_id         TEXT,
    created_at       INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );
`);

const stmts = {
  upsertWallet: db.prepare(`
    INSERT INTO wallets (twitter_username, twitter_user_id, xrpl_address)
    VALUES (?, ?, ?)
    ON CONFLICT(twitter_username) DO UPDATE SET
      xrpl_address = excluded.xrpl_address,
      twitter_user_id = excluded.twitter_user_id
  `),
  getWallet: db.prepare(`SELECT xrpl_address FROM wallets WHERE twitter_username = ? COLLATE NOCASE`),
  markProcessed: db.prepare(`INSERT OR IGNORE INTO processed_tweets (tweet_id) VALUES (?)`),
  isProcessed: db.prepare(`SELECT 1 FROM processed_tweets WHERE tweet_id = ?`),
  logTip: db.prepare(`
    INSERT INTO tip_log (from_username, to_username, to_xrpl_address, amount, tx_hash, tweet_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  recentTips: db.prepare(`SELECT * FROM tip_log ORDER BY created_at DESC LIMIT 50`),
};

module.exports = {
  registerWallet(username, userId, xrplAddress) {
    stmts.upsertWallet.run(username.toLowerCase(), userId, xrplAddress);
  },
  getWallet(username) {
    const row = stmts.getWallet.get(username.toLowerCase());
    return row ? row.xrpl_address : null;
  },
  markProcessed(tweetId) { stmts.markProcessed.run(tweetId); },
  isProcessed(tweetId) { return !!stmts.isProcessed.get(tweetId); },
  logTip({ fromUsername, toUsername, toAddress, amount, txHash, tweetId }) {
    stmts.logTip.run(fromUsername, toUsername, toAddress, String(amount), txHash || null, tweetId || null);
  },
  recentTips() { return stmts.recentTips.all(); },
};
