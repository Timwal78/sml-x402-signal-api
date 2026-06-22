const { TwitterApi } = require('twitter-api-v2');
const cfg = require('../config');

// Read-only client (bearer token) — for searching mentions without burning OAuth rate limits
const roClient = new TwitterApi(cfg.twitter.bearerToken).readOnly;

// Read-write client (OAuth 1.0a) — for posting replies
const rwClient = new TwitterApi({
  appKey: cfg.twitter.apiKey,
  appSecret: cfg.twitter.apiSecret,
  accessToken: cfg.twitter.accessToken,
  accessSecret: cfg.twitter.accessSecret,
}).readWrite;

// Search recent mentions of the bot.
// Rate limit on Basic tier: 60 req / 15 min — one per 15s is safe.
async function getMentions(sinceId) {
  const query = `@${cfg.twitter.botUsername} -is:retweet`;
  const params = {
    max_results: 100,
    'tweet.fields': ['author_id', 'created_at', 'text', 'in_reply_to_user_id'],
    'user.fields': ['username'],
    expansions: ['author_id'],
  };
  if (sinceId) params.since_id = sinceId;
  return roClient.v2.search(query, params);
}

// Fetch users who retweeted a given tweet (used by airdrop command).
async function getRetweeters(tweetId) {
  try {
    const resp = await roClient.v2.tweetRetweetedBy(tweetId, { 'user.fields': ['username'] });
    return resp.data?.data || [];
  } catch {
    return [];
  }
}

async function reply(text, inReplyToTweetId) {
  return rwClient.v2.reply(text, inReplyToTweetId);
}

async function tweet(text) {
  return rwClient.v2.tweet(text);
}

module.exports = { getMentions, getRetweeters, reply, tweet };
