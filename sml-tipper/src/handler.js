const cfg = require('./config');
const registry = require('./registry');
const xrpl = require('./xrpl/client');
const { reply, getRetweeters } = require('./twitter/client');

async function handleMention({ tweet, authorUsername }) {
  const text    = tweet.text.trim();
  const tweetId = tweet.id;
  if (tweet.author_id === cfg.twitter.botUserId) return;
  console.log(`[Handler] @${authorUsername}: ${text.slice(0, 100)}`);

  const tipMatch = text.match(cfg.app.tipRegex);
  if (tipMatch) {
    const currency = normalizeCurrency(tipMatch[3]);
    return handleTip({ tweetId, authorUsername, recipientUsername: tipMatch[1].replace('@',''), amount: parseFloat(tipMatch[2]), currency });
  }

  const splitMatch = text.match(cfg.app.splitRegex);
  if (splitMatch) {
    const currency    = normalizeCurrency(splitMatch[2]);
    const recipients  = [...splitMatch[3].matchAll(/@(\S+)/g)].map(m => m[1]);
    return handleSplit({ tweetId, authorUsername, grossAmount: parseFloat(splitMatch[1]), currency, recipients });
  }

  const airdropMatch = text.match(cfg.app.airdropRegex);
  if (airdropMatch) {
    const currency = normalizeCurrency(airdropMatch[2]);
    return handleAirdrop({ tweetId, authorUsername, grossAmount: parseFloat(airdropMatch[1]), currency, targetTweetId: airdropMatch[3] });
  }

  const regMatch = text.match(cfg.app.registerRegex);
  if (regMatch) return handleRegister({ tweetId, authorUsername, userId: tweet.author_id, xrplAddress: regMatch[1] });

  if (cfg.app.balanceRegex.test(text))  return handleMyBalance({ tweetId, authorUsername });
  if (cfg.app.topupRegex.test(text))    return handleTopup({ tweetId, authorUsername });
  if (cfg.app.historyRegex.test(text))  return handleHistory({ tweetId, authorUsername });
  if (cfg.app.helpRegex.test(text))     return handleHelp({ tweetId });
}

// ─── TIP ──────────────────────────────────────────────────────────────────────
async function handleTip({ tweetId, authorUsername, recipientUsername, amount, currency }) {
  if (isNaN(amount) || amount < cfg.app.minTip)
    return safeReply(`@${authorUsername} Minimum tip is ${cfg.app.minTip}.`, tweetId);
  if (amount > cfg.app.maxTip)
    return safeReply(`@${authorUsername} Maximum tip is ${cfg.app.maxTip}.`, tweetId);
  if (recipientUsername.toLowerCase() === cfg.twitter.botUsername.toLowerCase())
    return safeReply(`@${authorUsername} Can't tip the bot 😅`, tweetId);

  const destAddress = registry.getWallet(recipientUsername);
  if (!destAddress)
    return safeReply(
      `@${authorUsername} @${recipientUsername} hasn't registered a wallet.\n@${recipientUsername}: reply @${cfg.twitter.botUsername} register rYOUR_ADDRESS`,
      tweetId
    );

  const balance = registry.getCurrencyBalance(authorUsername, currency);
  if (balance < amount)
    return safeReply(
      `@${authorUsername} Insufficient balance (${balance} ${currency}). ` +
      `Send ${currency} to ${getDepositAddress(currency)} with memo: twitter:@${authorUsername}`,
      tweetId
    );

  const fee             = parseFloat((amount * cfg.fee.tipPct).toFixed(6));
  const recipientAmount = parseFloat((amount - fee).toFixed(6));

  const debited = registry.debitBalance(authorUsername, currency, amount);
  if (!debited) return safeReply(`@${authorUsername} Balance deduction failed — try again.`, tweetId);

  try {
    const memo = `tip @${authorUsername} -> @${recipientUsername} tweet:${tweetId}`;
    const txHash = await send(currency, destAddress, recipientAmount, memo);
    sendFee(currency, fee, `tip-fee:${tweetId}`);

    registry.logTip({ fromUsername: authorUsername, toUsername: recipientUsername, toAddress: destAddress, amount, currency, feeAmount: fee, txHash, tweetId });
    console.log(`[Tip] ${authorUsername} -> ${recipientUsername} ${amount} ${currency} | tx:${txHash}`);

    return safeReply(
      `@${authorUsername} sent ${amount} ${currency} to @${recipientUsername} ✅\nTX: ${explorerUrl(currency, txHash)}`,
      tweetId
    );
  } catch (err) {
    registry.creditBalance(authorUsername, currency, amount); // refund on failure
    console.error('[Tip] Failed:', err.message);
    return safeReply(`@${authorUsername} Payment failed: ${err.message.slice(0, 80)}`, tweetId);
  }
}

// ─── SPLIT TIP ────────────────────────────────────────────────────────────────
async function handleSplit({ tweetId, authorUsername, grossAmount, currency, recipients }) {
  const unique = [...new Set(recipients.map(r => r.toLowerCase()))]
    .filter(r => r !== cfg.twitter.botUsername.toLowerCase());
  if (unique.length === 0)
    return safeReply(`@${authorUsername} No valid recipients.`, tweetId);

  const balance = registry.getCurrencyBalance(authorUsername, currency);
  if (balance < grossAmount)
    return safeReply(`@${authorUsername} Insufficient balance (${balance} ${currency}).`, tweetId);

  const fee        = parseFloat((grossAmount * cfg.fee.tipPct).toFixed(6));
  const netPool    = parseFloat((grossAmount - fee).toFixed(6));
  const perPerson  = parseFloat((netPool / unique.length).toFixed(6));

  if (perPerson < cfg.app.minTip)
    return safeReply(`@${authorUsername} Per-person amount too small. Increase total or reduce recipients.`, tweetId);

  if (!registry.debitBalance(authorUsername, currency, grossAmount))
    return safeReply(`@${authorUsername} Balance deduction failed.`, tweetId);

  sendFee(currency, fee, `split-fee:${tweetId}`);

  let ok = 0;
  for (const r of unique) {
    const addr = registry.getWallet(r);
    if (!addr) continue;
    try {
      const hash = await send(currency, addr, perPerson, `split from @${authorUsername}`);
      registry.logTip({ fromUsername: authorUsername, toUsername: r, toAddress: addr, amount: perPerson, currency, feeAmount: 0, txHash: hash, tweetId });
      ok++;
    } catch (e) { console.error(`[Split] @${r} failed:`, e.message); }
  }

  return safeReply(`@${authorUsername} Split complete ✅ ${perPerson} ${currency} sent to ${ok}/${unique.length} recipients.`, tweetId);
}

// ─── AIRDROP ──────────────────────────────────────────────────────────────────
async function handleAirdrop({ tweetId, authorUsername, grossAmount, currency, targetTweetId }) {
  const balance = registry.getCurrencyBalance(authorUsername, currency);
  if (balance < grossAmount)
    return safeReply(
      `@${authorUsername} Insufficient balance (${balance} ${currency}).\nTopup: @${cfg.twitter.botUsername} topup`,
      tweetId
    );

  const retweeters = await getRetweeters(targetTweetId);
  if (retweeters.length === 0)
    return safeReply(`@${authorUsername} No retweeters found for tweet ${targetTweetId}.`, tweetId);

  const eligible = retweeters.filter(u => registry.getWallet(u.username));
  if (eligible.length === 0)
    return safeReply(`@${authorUsername} None of the ${retweeters.length} retweeters have registered wallets.`, tweetId);

  const fee       = parseFloat((grossAmount * cfg.fee.tipPct).toFixed(6));
  const netPool   = parseFloat((grossAmount - fee).toFixed(6));
  const perPerson = parseFloat((netPool / eligible.length).toFixed(6));

  if (perPerson < cfg.app.minTip)
    return safeReply(`@${authorUsername} Per-person drop (${perPerson} ${currency}) is below minimum. Increase total or target a smaller tweet.`, tweetId);

  if (!registry.debitBalance(authorUsername, currency, grossAmount))
    return safeReply(`@${authorUsername} Balance deduction failed.`, tweetId);

  sendFee(currency, fee, `airdrop-fee:${tweetId}`);

  let ok = 0;
  for (const u of eligible) {
    const addr = registry.getWallet(u.username);
    try {
      const hash = await send(currency, addr, perPerson, `airdrop from @${authorUsername}`);
      registry.logTip({ fromUsername: authorUsername, toUsername: u.username, toAddress: addr, amount: perPerson, currency, feeAmount: 0, txHash: hash, tweetId });
      ok++;
    } catch (e) { console.error(`[Airdrop] @${u.username} failed:`, e.message); }
  }

  registry.logAirdrop({ fromUsername: authorUsername, tweetId: targetTweetId, currency, grossAmount, feeAmount: fee, recipientCount: ok, perPerson });
  return safeReply(
    `@${authorUsername} Airdrop complete ✅\n${perPerson} ${currency} dropped to ${ok}/${eligible.length} registered retweeters.`,
    tweetId
  );
}

// ─── REGISTER ─────────────────────────────────────────────────────────────────
async function handleRegister({ tweetId, authorUsername, userId, xrplAddress }) {
  if (!/^r[A-Za-z0-9]{24,34}$/.test(xrplAddress))
    return safeReply(`@${authorUsername} Invalid address — must start with 'r'.`, tweetId);
  registry.registerWallet(authorUsername, userId, xrplAddress);
  console.log(`[Register] @${authorUsername} -> ${xrplAddress}`);
  return safeReply(`@${authorUsername} Wallet registered ✅ You can now receive RLUSD, XAH, and XRP tips.`, tweetId);
}

// ─── MY BALANCE ───────────────────────────────────────────────────────────────
async function handleMyBalance({ tweetId, authorUsername }) {
  const b = registry.getUserBalance(authorUsername);
  return safeReply(
    `@${authorUsername} Your TipMaster X balance:\n` +
    `RLUSD: ${b.RLUSD} | XAH: ${b.XAH} | XRP: ${b.XRP}\n` +
    `To top up: @${cfg.twitter.botUsername} topup`,
    tweetId
  );
}

// ─── TOPUP ────────────────────────────────────────────────────────────────────
async function handleTopup({ tweetId, authorUsername }) {
  return safeReply(
    `@${authorUsername} To load your tip balance, send RLUSD/XRP to:\n` +
    `${cfg.xrpl.address}\n` +
    `With memo: twitter:@${authorUsername}\n\n` +
    `For XAH send to: ${cfg.xahau.address}\n` +
    `1% deposit fee applies. Funds credited instantly.`,
    tweetId
  );
}

// ─── HISTORY ──────────────────────────────────────────────────────────────────
async function handleHistory({ tweetId, authorUsername }) {
  const rows = registry.userHistory(authorUsername);
  if (rows.length === 0)
    return safeReply(`@${authorUsername} No tip history yet.`, tweetId);
  const lines = rows.map(r =>
    r.from_username === authorUsername.toLowerCase()
      ? `↑ ${r.amount} ${r.currency} to @${r.to_username}`
      : `↓ ${r.amount} ${r.currency} from @${r.from_username}`
  );
  return safeReply(`@${authorUsername} Recent tips:\n${lines.join('\n')}`, tweetId);
}

// ─── HELP ─────────────────────────────────────────────────────────────────────
async function handleHelp({ tweetId }) {
  const b = `@${cfg.twitter.botUsername}`;
  return safeReply(
    `TipMaster X\n` +
    `${b} tip @user 5 RLUSD\n` +
    `${b} split 20 RLUSD @user1 @user2\n` +
    `${b} airdrop 100 RLUSD tweet:ID\n` +
    `${b} register rADDRESS\n` +
    `${b} topup | balance | history`,
    tweetId
  );
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function normalizeCurrency(raw) {
  if (!raw) return cfg.app.defaultCurrency;
  const c = raw.toUpperCase().replace('$', '');
  return ['RLUSD', 'XAH', 'XRP'].includes(c) ? c : cfg.app.defaultCurrency;
}

function getDepositAddress(currency) {
  return currency === 'XAH' ? cfg.xahau.address : cfg.xrpl.address;
}

function explorerUrl(currency, hash) {
  return currency === 'XAH'
    ? `https://xahauexplorer.com/tx/${hash}`
    : `https://livenet.xrpl.org/transactions/${hash}`;
}

async function send(currency, dest, amount, memo) {
  if (currency === 'RLUSD') return xrpl.sendRLUSD(dest, amount, memo);
  if (currency === 'XAH')   return xrpl.sendXAH(dest, amount, memo);
  return xrpl.sendXRP(dest, amount, memo);
}

function sendFee(currency, fee, memo) {
  if (fee <= 0) return;
  const wallet = currency === 'XAH' ? cfg.fee.walletXahau : cfg.fee.walletXrpl;
  if (!wallet) return;
  send(currency, wallet, fee, memo).catch(e => console.error('[Fee] Forward failed:', e.message));
}

async function safeReply(text, tweetId) {
  try { await reply(text.slice(0, 280), tweetId); }
  catch (err) { console.error('[Reply] Failed:', err.message); }
}

module.exports = { handleMention };
