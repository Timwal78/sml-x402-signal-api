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

  CREATE TABLE IF NOT EXISTS balances (
    twitter_username TEXT NOT NULL,
    currency         TEXT NOT NULL,
    amount           REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (twitter_username, currency)
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
    amount           REAL NOT NULL,
    currency         TEXT NOT NULL DEFAULT 'RLUSD',
    fee_amount       REAL NOT NULL DEFAULT 0,
    tx_hash          TEXT,
    tweet_id         TEXT,
    created_at       INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS deposit_log (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    twitter_username TEXT NOT NULL,
    xrpl_address     TEXT NOT NULL,
    amount           REAL NOT NULL,
    currency         TEXT NOT NULL,
    fee_amount       REAL NOT NULL DEFAULT 0,
    tx_hash          TEXT UNIQUE,
    created_at       INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS airdrop_log (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    from_username    TEXT NOT NULL,
    recipient_count  INTEGER NOT NULL,
    amount_each      REAL NOT NULL,
    currency         TEXT NOT NULL,
    source_tweet_id  TEXT,
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

  getBalance: db.prepare(`SELECT amount FROM balances WHERE twitter_username = ? AND currency = ?`),
  upsertBalance: db.prepare(`
    INSERT INTO balances (twitter_username, currency, amount) VALUES (?, ?, ?)
    ON CONFLICT(twitter_username, currency) DO UPDATE SET amount = amount + excluded.amount
  `),
  // Atomic debit: only succeeds if balance >= requested amount
  debitBalance: db.prepare(`
    UPDATE balances SET amount = amount - ?
    WHERE twitter_username = ? AND currency = ? AND amount >= ?
  `),

  logTip: db.prepare(`
    INSERT INTO tip_log (from_username, to_username, to_xrpl_address, amount, currency, fee_amount, tx_hash, tweet_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  recentTips: db.prepare(`SELECT * FROM tip_log ORDER BY created_at DESC LIMIT 50`),
  userTipsSent: db.prepare(`SELECT * FROM tip_log WHERE from_username = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 5`),
  userTipsReceived: db.prepare(`SELECT * FROM tip_log WHERE to_username = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 5`),

  topTippers: db.prepare(`
    SELECT from_username, currency, SUM(amount) as total
    FROM tip_log GROUP BY from_username, currency ORDER BY total DESC LIMIT ?
  `),
  topReceivers: db.prepare(`
    SELECT to_username, currency, SUM(amount) as total
    FROM tip_log GROUP BY to_username, currency ORDER BY total DESC LIMIT ?
  `),

  logDeposit: db.prepare(`
    INSERT OR IGNORE INTO deposit_log (twitter_username, xrpl_address, amount, currency, fee_amount, tx_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `),

  logAirdrop: db.prepare(`
    INSERT INTO airdrop_log (from_username, recipient_count, amount_each, currency, source_tweet_id)
    VALUES (?, ?, ?, ?, ?)
  `),
};

module.exports = {
  registerWallet(username, userId, xrplAddress) {
    stmts.upsertWallet.run(username.toLowerCase(), userId, xrplAddress);
  },

  getWallet(username) {
    const row = stmts.getWallet.get(username.toLowerCase());
    return row ? row.xrpl_address : null;
  },

  markProcessed(tweetId) {
    stmts.markProcessed.run(tweetId);
  },

  isProcessed(tweetId) {
    return !!stmts.isProcessed.get(tweetId);
  },

  getCurrencyBalance(username, currency) {
    const row = stmts.getBalance.get(username.toLowerCase(), currency);
    return row ? row.amount : 0;
  },

  getUserBalance(username) {
    const u = username.toLowerCase();
    return {
      RLUSD: module.exports.getCurrencyBalance(u, 'RLUSD'),
      XAH:   module.exports.getCurrencyBalance(u, 'XAH'),
      XRP:   module.exports.getCurrencyBalance(u, 'XRP'),
    };
  },

  creditBalance(username, currency, amount) {
    stmts.upsertBalance.run(username.toLowerCase(), currency, amount);
  },

  // Returns true if debit succeeded (had sufficient balance), false otherwise
  debitBalance(username, currency, amount) {
    const info = stmts.debitBalance.run(amount, username.toLowerCase(), currency, amount);
    return info.changes > 0;
  },

  logTip({ fromUsername, toUsername, toAddress, amount, currency, feeAmount, txHash, tweetId }) {
    stmts.logTip.run(
      fromUsername, toUsername, toAddress,
      amount, currency, feeAmount || 0,
      txHash || null, tweetId || null
    );
  },

  logDeposit({ username, xrplAddress, amount, currency, feeAmount, txHash }) {
    stmts.logDeposit.run(username.toLowerCase(), xrplAddress, amount, currency, feeAmount || 0, txHash || null);
  },

  logAirdrop({ fromUsername, recipientCount, amountEach, currency, sourceTweetId }) {
    stmts.logAirdrop.run(fromUsername, recipientCount, amountEach, currency, sourceTweetId || null);
  },

  recentTips() {
    return stmts.recentTips.all();
  },

  userHistory(username) {
    const u = username.toLowerCase();
    return {
      sent: stmts.userTipsSent.all(u),
      received: stmts.userTipsReceived.all(u),
    };
  },

  topTippers(n = 10) {
    return stmts.topTippers.all(n);
  },

  topReceivers(n = 10) {
    return stmts.topReceivers.all(n);
  },
};
