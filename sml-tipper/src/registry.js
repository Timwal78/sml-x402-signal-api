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
    twitter_username TEXT,
    from_xrpl        TEXT,
    currency         TEXT NOT NULL,
    gross_amount     REAL NOT NULL,
    fee_amount       REAL NOT NULL DEFAULT 0,
    net_amount       REAL NOT NULL,
    tx_hash          TEXT UNIQUE,
    created_at       INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS airdrop_log (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    from_username    TEXT NOT NULL,
    tweet_id         TEXT NOT NULL,
    currency         TEXT NOT NULL,
    gross_amount     REAL NOT NULL,
    fee_amount       REAL NOT NULL DEFAULT 0,
    recipient_count  INTEGER NOT NULL,
    per_person       REAL NOT NULL,
    created_at       INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );
`);

const s = {
  upsertWallet: db.prepare(`INSERT INTO wallets (twitter_username,twitter_user_id,xrpl_address) VALUES (?,?,?)
    ON CONFLICT(twitter_username) DO UPDATE SET xrpl_address=excluded.xrpl_address, twitter_user_id=excluded.twitter_user_id`),
  getWallet: db.prepare(`SELECT xrpl_address FROM wallets WHERE twitter_username=? COLLATE NOCASE`),

  getAllBalances: db.prepare(`SELECT currency, amount FROM balances WHERE twitter_username=? COLLATE NOCASE`),
  getOneBal:     db.prepare(`SELECT amount FROM balances WHERE twitter_username=? AND currency=?`),
  creditBal:     db.prepare(`INSERT INTO balances (twitter_username,currency,amount) VALUES (?,?,?)
    ON CONFLICT(twitter_username,currency) DO UPDATE SET amount=amount+excluded.amount`),
  debitBal:      db.prepare(`UPDATE balances SET amount=amount-? WHERE twitter_username=? AND currency=? AND amount>=?`),

  markProcessed: db.prepare(`INSERT OR IGNORE INTO processed_tweets (tweet_id) VALUES (?)`),
  isProcessed:   db.prepare(`SELECT 1 FROM processed_tweets WHERE tweet_id=?`),

  logTip:    db.prepare(`INSERT INTO tip_log (from_username,to_username,to_xrpl_address,amount,currency,fee_amount,tx_hash,tweet_id) VALUES (?,?,?,?,?,?,?,?)`),
  recentTips: db.prepare(`SELECT * FROM tip_log ORDER BY created_at DESC LIMIT 50`),
  userHistory: db.prepare(`SELECT * FROM tip_log WHERE from_username=? OR to_username=? ORDER BY created_at DESC LIMIT 5`),
  topTippers:   db.prepare(`SELECT from_username as username, currency, SUM(amount) as total FROM tip_log GROUP BY from_username,currency ORDER BY total DESC LIMIT ?`),
  topReceivers: db.prepare(`SELECT to_username as username, currency, SUM(amount) as total FROM tip_log GROUP BY to_username,currency ORDER BY total DESC LIMIT ?`),

  logDeposit: db.prepare(`INSERT OR IGNORE INTO deposit_log (twitter_username,from_xrpl,currency,gross_amount,fee_amount,net_amount,tx_hash) VALUES (?,?,?,?,?,?,?)`),
  logAirdrop: db.prepare(`INSERT INTO airdrop_log (from_username,tweet_id,currency,gross_amount,fee_amount,recipient_count,per_person) VALUES (?,?,?,?,?,?,?)`),
};

module.exports = {
  registerWallet(u, uid, addr) { s.upsertWallet.run(u.toLowerCase(), uid, addr); },
  getWallet(u) { const r = s.getWallet.get(u.toLowerCase()); return r?.xrpl_address || null; },

  creditBalance(u, currency, amount) { s.creditBal.run(u.toLowerCase(), currency, amount); },
  debitBalance(u, currency, amount) { return s.debitBal.run(amount, u.toLowerCase(), currency, amount).changes > 0; },
  getUserBalance(u) {
    const rows = s.getAllBalances.all(u.toLowerCase());
    const b = { RLUSD: 0, XAH: 0, XRP: 0 };
    for (const r of rows) b[r.currency] = r.amount;
    return b;
  },
  getCurrencyBalance(u, currency) { return s.getOneBal.get(u.toLowerCase(), currency)?.amount || 0; },

  markProcessed(id) { s.markProcessed.run(id); },
  isProcessed(id)   { return !!s.isProcessed.get(id); },

  logTip({ fromUsername, toUsername, toAddress, amount, currency, feeAmount, txHash, tweetId }) {
    s.logTip.run(fromUsername, toUsername, toAddress, amount, currency, feeAmount||0, txHash||null, tweetId||null);
  },
  logDeposit({ twitterUsername, fromXrpl, currency, grossAmount, feeAmount, netAmount, txHash }) {
    s.logDeposit.run(twitterUsername, fromXrpl, currency, grossAmount, feeAmount, netAmount, txHash);
  },
  logAirdrop({ fromUsername, tweetId, currency, grossAmount, feeAmount, recipientCount, perPerson }) {
    s.logAirdrop.run(fromUsername, tweetId, currency, grossAmount, feeAmount, recipientCount, perPerson);
  },

  recentTips()         { return s.recentTips.all(); },
  userHistory(u)       { return s.userHistory.all(u.toLowerCase(), u.toLowerCase()); },
  topTippers(n=10)     { return s.topTippers.all(n); },
  topReceivers(n=10)   { return s.topReceivers.all(n); },
};
