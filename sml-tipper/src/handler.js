const cfg = require('./config');
const registry = require('./registry');
const xrpl = require('./xrpl/client');
const { reply, getRetweeters } = require('./twitter/client');

async function handleMention({ tweet, authorUsername }) {
  const text = tweet.text.trim();
  const tweetId = tweet.id;

  if (tweet.author_id === cfg.twitter.botUserId) return;
  console.log(`[Handler] @${authorUsername}: ${text.slice(0, 100)}`);

  const tipMatch = text.match(cfg.app.tipRegex);
  if (tipMatch) {
    const recipientUsername = tipMatch[1].replace('@', '');
    const amount = parseFloat(tipMatch[2]);
    const currency = normalizeCurrency(tipMatch[3]);
    return handleTip({ tweetId, authorUsername, recipientUsername, amount, currency });
  }

  const splitMatch = text.match(cfg.app.splitRegex);
  if (splitMatch) {
    const totalAmount = parseFloat(splitMatch[1]);
    const currency = normalizeCurrency(splitMatch[2]);
    const recipients = (splitMatch[3].match(/@(\S+)/g) || []).map(u => u.replace('@', ''));
    return handleSplit({ tweetId, authorUsername, recipients, totalAmount, currency });
  }

  const airdropMatch = text.match(cfg.app.airdropRegex);
  if (airdropMatch) {
    const amountEach = parseFloat(airdropMatch[1]);
    const currency = normalizeCurrency(airdropMatch[2]);
    const sourceTweetId = airdropMatch[3];
    return handleAirdrop({ tweetId, authorUsername, amountEach, currency, sourceTweetId });
  }

  const regMatch = text.match(cfg.app.registerRegex);
  if (regMatch) return handleRegister({ tweetId, authorUsername, userId: tweet.author_id, xrplAddress: regMatch[1] });
  if (cfg.app.balanceRegex.test(text)) return handleMyBalance({ tweetId, authorUsername });
  if (cfg.app.topupRegex.test(text)) return handleTopup({ tweetId, authorUsername });
  if (cfg.app.historyRegex.test(text)) return handleHistory({ tweetId, authorUsername });
  if (cfg.app.helpRegex.test(text)) return handleHelp({ tweetId });
}

async function handleTip({ tweetId, authorUsername, recipientUsername, amount, currency }) {
  if (isNaN(amount) || amount < cfg.app.minTip)
    return safeReply(`@${authorUsername} Minimum tip is ${cfg.app.minTip}.`, tweetId);
  if (amount > cfg.app.maxTip)
    return safeReply(`@${authorUsername} Maximum tip is ${cfg.app.maxTip}.`, tweetId);
  if (recipientUsername.toLowerCase() === cfg.twitter.botUsername.toLowerCase())
    return safeReply(`@${authorUsername} Can't tip the bot 😅`, tweetId);

  const bal = registry.getCurrencyBalance(authorUsername, currency);
  if (bal < amount)
    return safeReply(
      `@${authorUsername} Insufficient balance (${bal.toFixed(4)} ${currency}). ` +
      `Reply "@${cfg.twitter.botUsername} topup" to deposit.`,
      tweetId
    );

  const destAddress = registry.getWallet(recipientUsername);
  if (!destAddress) {
    return safeReply(
      `@${authorUsername} @${recipientUsername} hasn't registered an XRPL wallet yet.\n` +
      `@${recipientUsername} reply: @${cfg.twitter.botUsername} register rYOUR_ADDRESS`,
      tweetId
    );
  }

  const fee = parseFloat((amount * cfg.fee.tipPct).toFixed(6));
  const recipientAmount = parseFloat((amount - fee).toFixed(6));

  if (!registry.debitBalance(authorUsername, currency, amount))
    return safeReply(`@${authorUsername} Insufficient balance. Reply "topup" to deposit.`, tweetId);

  try {
    const memo = `tip @${authorUsername} -> @${recipientUsername} tweet:${tweetId}`;
    const txHash = await send(currency, destAddress, recipientAmount, memo);
    await sendFee(currency, fee, `fee:${tweetId}`);

    registry.logTip({ fromUsername: authorUsername, toUsername: recipientUsername, toAddress: destAddress, amount, currency, feeAmount: fee, txHash, tweetId });
    console.log(`[Tip] ${authorUsername} → ${recipientUsername} ${recipientAmount} ${currency} | fee ${fee} | tx: ${txHash}`);

    return safeReply(
      `@${authorUsername} sent ${recipientAmount} ${currency} to @${recipientUsername} ✅\nTX: ${explorerUrl(currency, txHash)}`,
      tweetId
    );
  } catch (err) {
    registry.creditBalance(authorUsername, currency, amount); // refund on failure
    console.error('[Tip] Payment failed:', err.message);
    return safeReply(`@${authorUsername} Payment failed: ${err.message.slice(0, 100)}`, tweetId);
  }
}

async function handleSplit({ tweetId, authorUsername, recipients, totalAmount, currency }) {
  if (!recipients.length)
    return safeReply(`@${authorUsername} No recipients found for split.`, tweetId);
  if (isNaN(totalAmount) || totalAmount < cfg.app.minTip * recipients.length)
    return safeReply(`@${authorUsername} Amount too small to split among ${recipients.length} users.`, tweetId);

  const unregistered = recipients.filter(u => !registry.getWallet(u));
  if (unregistered.length)
    return safeReply(
      `@${authorUsername} These users haven't registered: ${unregistered.map(u => '@' + u).join(' ')}`,
      tweetId
    );

  const fee = parseFloat((totalAmount * cfg.fee.tipPct).toFixed(6));
  const netTotal = parseFloat((totalAmount - fee).toFixed(6));
  const amountEach = parseFloat((netTotal / recipients.length).toFixed(6));

  const bal = registry.getCurrencyBalance(authorUsername, currency);
  if (bal < totalAmount)
    return safeReply(`@${authorUsername} Need ${totalAmount} ${currency} (you have ${bal.toFixed(4)}).`, tweetId);

  if (!registry.debitBalance(authorUsername, currency, totalAmount))
    return safeReply(`@${authorUsername} Insufficient balance. Reply "topup" to deposit.`, tweetId);

  const results = [];
  for (const recipient of recipients) {
    const destAddress = registry.getWallet(recipient);
    try {
      const txHash = await send(currency, destAddress, amountEach, `split @${authorUsername} tweet:${tweetId}`);
      registry.logTip({ fromUsername: authorUsername, toUsername: recipient, toAddress: destAddress, amount: amountEach, currency, feeAmount: 0, txHash, tweetId });
      results.push(`@${recipient} ✅`);
    } catch (err) {
      results.push(`@${recipient} ❌`);
      console.error(`[Split] Failed for ${recipient}:`, err.message);
    }
  }
  await sendFee(currency, fee, `fee-split:${tweetId}`);

  return safeReply(
    `@${authorUsername} Split ${amountEach} ${currency} each → ${results.join(' ')}`,
    tweetId
  );
}

async function handleAirdrop({ tweetId, authorUsername, amountEach, currency, sourceTweetId }) {
  if (isNaN(amountEach) || amountEach < cfg.app.minTip)
    return safeReply(`@${authorUsername} Minimum airdrop per person is ${cfg.app.minTip}.`, tweetId);

  const retweeters = await getRetweeters(sourceTweetId);
  const eligible = retweeters.filter(u => registry.getWallet(u.username));
  if (!eligible.length)
    return safeReply(
      `@${authorUsername} No registered users found among retweeters of tweet:${sourceTweetId}.`,
      tweetId
    );

  const gross = parseFloat((amountEach * eligible.length * (1 + cfg.fee.tipPct)).toFixed(6));
  const fee = parseFloat((amountEach * eligible.length * cfg.fee.tipPct).toFixed(6));

  const bal = registry.getCurrencyBalance(authorUsername, currency);
  if (bal < gross)
    return safeReply(
      `@${authorUsername} Need ${gross} ${currency} for ${eligible.length} retweeters. You have ${bal.toFixed(4)}.`,
      tweetId
    );

  if (!registry.debitBalance(authorUsername, currency, gross))
    return safeReply(`@${authorUsername} Insufficient balance.`, tweetId);

  let sent = 0;
  for (const user of eligible) {
    const destAddress = registry.getWallet(user.username);
    try {
      await send(currency, destAddress, amountEach, `airdrop @${authorUsername} tweet:${sourceTweetId}`);
      registry.logTip({ fromUsername: authorUsername, toUsername: user.username, toAddress: destAddress, amount: amountEach, currency, feeAmount: 0, txHash: null, tweetId });
      sent++;
    } catch (err) {
      console.error(`[Airdrop] Failed for ${user.username}:`, err.message);
    }
  }
  await sendFee(currency, fee, `fee-airdrop:${tweetId}`);
  registry.logAirdrop({ fromUsername: authorUsername, recipientCount: sent, amountEach, currency, sourceTweetId });

  return safeReply(
    `@${authorUsername} Airdropped ${amountEach} ${currency} to ${sent}/${eligible.length} retweeters ✅`,
    tweetId
  );
}

async function handleRegister({ tweetId, authorUsername, userId, xrplAddress }) {
  if (!/^r[A-Za-z0-9]{24,34}$/.test(xrplAddress))
    return safeReply(`@${authorUsername} Invalid address — must start with 'r'.`, tweetId);
  registry.registerWallet(authorUsername, userId, xrplAddress);
  console.log(`[Register] @${authorUsername} → ${xrplAddress}`);
  return safeReply(`@${authorUsername} Registered! ✅ You can now receive RLUSD, XAH, and XRP tips.`, tweetId);
}

async function handleMyBalance({ tweetId, authorUsername }) {
  const bal = registry.getUserBalance(authorUsername);
  return safeReply(
    `@${authorUsername} Your TipMaster balance:\n` +
    `RLUSD: ${bal.RLUSD.toFixed(4)}\n` +
    `XRP:   ${bal.XRP.toFixed(4)}\n` +
    `XAH:   ${bal.XAH.toFixed(4)}\n` +
    `Reply "topup" to deposit more.`,
    tweetId
  );
}

async function handleTopup({ tweetId, authorUsername }) {
  const addr = { xrpl: cfg.xrpl.address, xahau: cfg.xahau.address };
  return safeReply(
    `@${authorUsername} To top up:\n` +
    `RLUSD/XRP → ${addr.xrpl}\n` +
    `XAH → ${addr.xahau}\n` +
    `Memo: twitter:@${authorUsername}\n` +
    `(1% deposit fee applies, credited in ~10s)`,
    tweetId
  );
}

async function handleHistory({ tweetId, authorUsername }) {
  const { sent, received } = registry.userHistory(authorUsername);
  const all = [
    ...sent.map(t => `${t.amount} ${t.currency} → @${t.to_username}`),
    ...received.map(t => `${t.amount} ${t.currency} ← @${t.from_username}`),
  ].slice(0, 5);
  const msg = all.length ? all.join('\n') : 'No tip history yet.';
  return safeReply(`@${authorUsername} Recent tips:\n${msg}`, tweetId);
}

async function handleHelp({ tweetId }) {
  const bot = `@${cfg.twitter.botUsername}`;
  return safeReply(
    `TipMaster X — tip on X.com\n\n` +
    `Tip:     ${bot} tip @user 5 RLUSD\n` +
    `Split:   ${bot} split 10 RLUSD @u1 @u2\n` +
    `Airdrop: ${bot} airdrop 2 RLUSD tweet:ID\n` +
    `Deposit: ${bot} topup\n` +
    `Balance: ${bot} balance\n` +
    `History: ${bot} history\n` +
    `Reg:     ${bot} register rADDRESS`,
    tweetId
  );
}

// --- helpers ---

function normalizeCurrency(raw) {
  if (!raw) return cfg.app.defaultCurrency;
  const c = raw.toUpperCase().replace('$', '');
  return ['XAH', 'XRP', 'RLUSD'].includes(c) ? c : cfg.app.defaultCurrency;
}

function explorerUrl(currency, txHash) {
  return currency === 'XAH'
    ? `https://xahauexplorer.com/tx/${txHash}`
    : `https://livenet.xrpl.org/transactions/${txHash}`;
}

async function send(currency, destination, amount, memo) {
  if (currency === 'RLUSD') return xrpl.sendRLUSD(destination, amount, memo);
  if (currency === 'XAH') return xrpl.sendXAH(destination, amount, memo);
  return xrpl.sendXRP(destination, amount, memo);
}

async function sendFee(currency, fee, memo) {
  if (fee <= 0) return;
  try {
    if (currency === 'XAH' && cfg.fee.walletXahau) await xrpl.sendXAH(cfg.fee.walletXahau, fee, memo);
    else if (currency === 'XRP' && cfg.fee.walletXrpl) await xrpl.sendXRP(cfg.fee.walletXrpl, fee, memo);
    else if (currency === 'RLUSD' && cfg.fee.walletXrpl) await xrpl.sendRLUSD(cfg.fee.walletXrpl, fee, memo);
  } catch (err) {
    console.error('[Fee] Forward failed:', err.message);
  }
}

async function safeReply(text, tweetId) {
  try { await reply(text.slice(0, 280), tweetId); }
  catch (err) { console.error('[Reply] Failed:', err.message); }
}

module.exports = { handleMention };
