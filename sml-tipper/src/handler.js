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
    const recipientUsername = tipMatch[1].replace('@', '');
    const amount = parseFloat(tipMatch[2]);
    const rawCurrency = (tipMatch[3] || cfg.app.defaultCurrency).toUpperCase().replace('$', '');
    const currency = ['XAH', 'XRP', 'RLUSD'].includes(rawCurrency) ? rawCurrency : cfg.app.defaultCurrency;
    return handleTip({ tweetId, authorUsername, recipientUsername, amount, currency });
  }

  const regMatch = text.match(cfg.app.registerRegex);
  if (regMatch) return handleRegister({ tweetId, authorUsername, userId: tweet.author_id, xrplAddress: regMatch[1] });
  if (cfg.app.balanceRegex.test(text)) return handleBalance({ tweetId, authorUsername });
  if (cfg.app.helpRegex.test(text)) return handleHelp({ tweetId });
}

async function handleTip({ tweetId, authorUsername, recipientUsername, amount, currency }) {
  if (isNaN(amount) || amount < cfg.app.minTip)
    return safeReply(`@${authorUsername} Minimum tip is ${cfg.app.minTip}.`, tweetId);
  if (amount > cfg.app.maxTip)
    return safeReply(`@${authorUsername} Maximum tip is ${cfg.app.maxTip}.`, tweetId);
  if (recipientUsername.toLowerCase() === cfg.twitter.botUsername.toLowerCase())
    return safeReply(`@${authorUsername} Can't tip the bot 😅`, tweetId);

  const destAddress = registry.getWallet(recipientUsername);
  if (!destAddress) {
    return safeReply(
      `@${authorUsername} @${recipientUsername} hasn't registered an XRPL wallet yet.\n` +
      `@${recipientUsername} reply: @${cfg.twitter.botUsername} register rYOUR_ADDRESS`,
      tweetId
    );
  }

  try {
    const memo = `tip @${authorUsername} -> @${recipientUsername} tweet:${tweetId}`;
    const fee = cfg.fee.pct > 0 ? parseFloat((amount * cfg.fee.pct).toFixed(6)) : 0;
    const recipientAmount = parseFloat((amount - fee).toFixed(6));
    let txHash;

    if (currency === 'RLUSD') {
      txHash = await xrpl.sendRLUSD(destAddress, recipientAmount, memo);
      if (fee > 0 && cfg.fee.walletXrpl) await xrpl.sendRLUSD(cfg.fee.walletXrpl, fee, `fee:${tweetId}`).catch(() => {});
    } else if (currency === 'XAH') {
      txHash = await xrpl.sendXAH(destAddress, recipientAmount, memo);
      if (fee > 0 && cfg.fee.walletXahau) await xrpl.sendXAH(cfg.fee.walletXahau, fee, `fee:${tweetId}`).catch(() => {});
    } else if (currency === 'XRP') {
      txHash = await xrpl.sendXRP(destAddress, recipientAmount, memo);
      if (fee > 0 && cfg.fee.walletXrpl) await xrpl.sendXRP(cfg.fee.walletXrpl, fee, `fee:${tweetId}`).catch(() => {});
    }

    registry.logTip({ fromUsername: authorUsername, toUsername: recipientUsername, toAddress: destAddress, amount, currency, txHash, tweetId });
    console.log(`[Tip] ${authorUsername} → ${recipientUsername} ${amount} ${currency} | tx: ${txHash}`);

    const explorer = currency === 'XAH'
      ? `https://xahauexplorer.com/tx/${txHash}`
      : `https://livenet.xrpl.org/transactions/${txHash}`;

    return safeReply(
      `@${authorUsername} sent ${amount} ${currency} to @${recipientUsername} ✅\nTX: ${explorer}`,
      tweetId
    );
  } catch (err) {
    console.error('[Tip] Payment failed:', err.message);
    return safeReply(`@${authorUsername} Payment failed: ${err.message.slice(0, 100)}`, tweetId);
  }
}

async function handleRegister({ tweetId, authorUsername, userId, xrplAddress }) {
  if (!/^r[A-Za-z0-9]{24,34}$/.test(xrplAddress))
    return safeReply(`@${authorUsername} Invalid address — must start with 'r'.`, tweetId);
  registry.registerWallet(authorUsername, userId, xrplAddress);
  console.log(`[Register] @${authorUsername} → ${xrplAddress}`);
  return safeReply(`@${authorUsername} Registered! ✅ You can now receive RLUSD, XAH, and XRP tips.`, tweetId);
}

async function handleBalance({ tweetId, authorUsername }) {
  const bal = await xrpl.getBalance();
  const rlusd = bal.RLUSD !== null ? `${bal.RLUSD} RLUSD` : 'RLUSD unavailable';
  const xah   = bal.XAH   !== null ? `${bal.XAH} XAH`     : 'XAH unavailable';
  const xrp   = bal.XRP   !== null ? `${bal.XRP} XRP`     : 'XRP unavailable';
  return safeReply(`@${authorUsername} Balance: ${rlusd} | ${xah} | ${xrp}`, tweetId);
}

async function handleHelp({ tweetId }) {
  const bot = `@${cfg.twitter.botUsername}`;
  return safeReply(
    `TipMaster X — tip on X.com\n\nTip: ${bot} tip @user 5 RLUSD\n     ${bot} tip @user 2 XAH\n     ${bot} tip @user 1 XRP\nRegister: ${bot} register rADDRESS\nBalance: ${bot} balance`,
    tweetId
  );
}

async function safeReply(text, tweetId) {
  try { await reply(text.slice(0, 280), tweetId); }
  catch (err) { console.error('[Reply] Failed:', err.message); }
}

module.exports = { handleMention };
