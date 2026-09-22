// All thresholds and tunables live here, sourced from env vars (set these in
// Railway's "Variables" tab) with sensible defaults so it also runs locally.

function num(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}

export const config = {
  apiBase: process.env.API_BASE || 'https://www.stonkfun.xyz/api/public/v1',

  // ---- your filters ----
  minRewardsUsd: num('MIN_REWARDS_USD', 47),
  maxHolders: num('MAX_HOLDERS', 2),
  minVolumeUsd: num('MIN_VOLUME_USD', 5500),

  // ---- scan behaviour ----
  // How often a full sweep of every reward token kicks off, in ms.
  // Kept low because CDN cache hits on GET /tokens and GET /tokens/{mint}/rewards
  // don't count against the per-minute rate limit (per the docs), but the
  // rate limiter below still protects you against real (non-cached) traffic.
  scanIntervalMs: num('SCAN_INTERVAL_MS', 8000),

  // Requests per minute we allow ourselves to make, kept under the documented
  // 300/min per-IP ceiling to leave headroom for the /tokens pagination calls.
  maxRequestsPerMinute: num('MAX_REQUESTS_PER_MINUTE', 260),

  // How many /tokens/{mint}/rewards calls to run concurrently per batch.
  concurrency: num('CONCURRENCY', 12),

  pageSize: num('PAGE_SIZE', 100),

  // sort=volume is assumed to return highest-volume tokens first. Since the
  // volume filter is a hard floor anyway, once a whole page has nothing
  // above minVolumeUsd there's no point fetching deeper pages — and this
  // avoids the deep-offset pages (30+) that were timing out. Set to false
  // if DEBUG_RAW logs show the sort is actually ascending.
  earlyStopOnLowVolume: bool('EARLY_STOP_ON_LOW_VOLUME', true),


  // Prints the FULL raw JSON of the first token + first rewards response it
  // sees, once, so you can confirm exact field names and fix the candidate
  // lists in fieldPaths.js if the API's actual shape differs. Turn this on
  // for your first deploy, check the Railway logs, then turn it off.
  debugRaw: bool('DEBUG_RAW', true),

  // Optional alerting
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',

  // Don't re-alert on the same mint within this window (ms) even if it
  // still matches on the next sweep.
  realertCooldownMs: num('REALERT_COOLDOWN_MS', 15 * 60 * 1000),

  port: num('PORT', 3000),
};
