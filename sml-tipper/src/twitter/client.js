const { TwitterApi } = require('twitter-api-v2');
const cfg = require('../config');

const roClient = new TwitterApi(cfg.twitter.bearerToken).readOnly;
const rwClient = new TwitterApi({
  appKey: cfg.twitter.apiKey,
  appSecret: cfg.twitter.apiSecret,
  accessToken: cfg.twitter.accessToken,
  accessSecret: cfg.twitter.accessSecret,
}).readWrite;

async function getMentions(sinceId) {
  const params = {
    max_results: 100,
    'tweet.fields': ['author_id', 'created_at', 'text'],
    'user.fields': ['username'],
    expansions: ['author_id'],
  };
  if (sinceId) params.since_id = sinceId;
  return roClient.v2.search(`@${cfg.twitter.botUsername} -is:retweet`, params);
}

async function reply(text, inReplyToTweetId) {
  return rwClient.v2.reply(text, inReplyToTweetId);
}

async function tweet(text) {
  return rwClient.v2.tweet(text);
}

module.exports = { getMentions, reply, tweet };
