const cfg = require('./config');
const registry = require('./registry');
const xrpl = require('./xrpl/client');
const { reply } = require('./twitter/client');

async function handleMention({ tweet, authorUsername }) {
  const text = tweet.text.trim();
  const tweetId = tweet.id;

  if (tweet.author_id === cfg.twitter.botUserId) return;
  console.log(`[Handler] @${authorUsername}: ${text.slice(0, 100)}`);

  const tipMatch = text.match(cfg.app.tipRegex);
  if (tipMatch) {
    return handleTip({ tweetId, authorUsername, recipientUsername: tipMatch[1].replace('@', ''), amount: parseFloat(tipMatch[2]) });
  }

  const regMatch = text.match(cfg.app.registerRegex);
  if (regMatch) return handleRegister({ tweetId, authorUsername, userId: tweet.author_id, xrplAddress: regMatch[1] });
  if (cfg.app.balanceRegex.test(text)) return handleBalance({ tweetId, authorUsername });
  if (cfg.app.helpRegex.test(text)) return handleHelp({ tweetId });
}

async function handleTip({ tweetId, authorUsername, recipientUsername, amount }) {
  if (isNaN(amount) || amount < cfg.xrpl.minTip)
    return safeReply(`@${authorUsername} Minimum tip is ${cfg.xrpl.minTip} RLUSD.`, tweetId);
  if (amount > cfg.xrpl.maxTip)
    return safeReply(`@${authorUsername} Maximum single tip is ${cfg.xrpl.maxTip} RLUSD.`, tweetId);
  if (recipientUsername.toLowerCase() === cfg.twitter.botUsername.toLowerCase())
    return safeReply(`@${authorUsername} Can't tip the bot 😅`, tweetId);

  const destAddress = registry.getWallet(recipientUsername);
  if (!destAddress) {
    return safeReply(
      `@${authorUsername} @${recipientUsername} hasn't registered an XRPL wallet yet.\n@${recipientUsername} reply:\n@${cfg.twitter.botUsername} register rYOUR_XRPL_ADDRESS`,
      tweetId
    );
  }

  try {
    const txHash = await xrpl.sendRLUSD(destAddress, amount, `tip @${authorUsername} -> @${recipientUsername} tweet:${tweetId}`);
    registry.logTip({ fromUsername: authorUsername, toUsername: recipientUsername, toAddress: destAddress, amount, txHash, tweetId });
    console.log(`[Tip] ${authorUsername} → ${recipientUsername} ${amount} RLUSD | tx: ${txHash}`);
    return safeReply(`@${authorUsername} sent ${amount} RLUSD to @${recipientUsername} ✅\nTX: https://livenet.xrpl.org/transactions/${txHash}`, tweetId);
  } catch (err) {
    console.error('[Tip] Payment failed:', err.message);
    return safeReply(`@${authorUsername} Payment failed: ${err.message.slice(0, 100)}`, tweetId);
  }
}

async function handleRegister({ tweetId, authorUsername, userId, xrplAddress }) {
  if (!/^r[A-Za-z0-9]{24,34}$/.test(xrplAddress))
    return safeReply(`@${authorUsername} Invalid XRPL address — must start with 'r'.`, tweetId);
  registry.registerWallet(authorUsername, userId, xrplAddress);
  console.log(`[Register] @${authorUsername} → ${xrplAddress}`);
  return safeReply(`@${authorUsername} Registered! ✅ You can now receive RLUSD tips.`, tweetId);
}

async function handleBalance({ tweetId, authorUsername }) {
  const balance = await xrpl.getBalance();
  return safeReply(`@${authorUsername} TipMaster X balance: ${balance !== null ? balance + ' RLUSD' : 'unavailable'}`, tweetId);
}

async function handleHelp({ tweetId }) {
  const bot = `@${cfg.twitter.botUsername}`;
  return safeReply(`TipMaster X — RLUSD tips on X\n\nTip: ${bot} tip @user 5\nRegister: ${bot} register rADDRESS\nBalance: ${bot} balance`, tweetId);
}

async function safeReply(text, tweetId) {
  try { await reply(text.slice(0, 280), tweetId); }
  catch (err) { console.error('[Reply] Failed:', err.message); }
}

module.exports = { handleMention };
