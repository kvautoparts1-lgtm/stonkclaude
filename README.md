# StonkFun Rewards Bot

Continuously scans every reward-mode token on [StonkFun](https://www.stonkfun.xyz)
via the public API and alerts when a token matches **all three** filters:

- pending rewards to be distributed **> $47**
- holder count **≤ 2**
- volume **≥ $5,500**

No API key needed — the StonkFun public API is open, per the
[developer docs](https://www.stonkfun.xyz/developers).

## ⚠️ Before you trust the output: calibrate field names

The StonkFun docs publish query parameters and endpoint *purpose*, but not
the full JSON response schema — so this bot doesn't hardcode one guessed key
name for "holders" or "pending rewards in USD". Instead `src/fieldPaths.js`
tries a short list of plausible field names in order, and `DEBUG_RAW=true`
(on by default) prints the **full raw JSON** of the first token and first
`/rewards` response it sees straight to the logs.

**On your first deploy:**
1. Watch the Railway logs for two `[DEBUG RAW]` blocks.
2. Confirm the actual key names for volume, holder count, and pending
   reward USD.
3. If they differ from what's in `src/fieldPaths.js`, add/reorder the
   candidates there — put the real key first in each list.
4. Set `DEBUG_RAW=false` once you've confirmed it (Railway → Variables).

If a token is ever missing one of the three values, the bot skips it rather
than guessing — you'll see a count of scanned vs. matched in `/status`.

## How it scans "as fast as possible" without getting rate-limited

- Filters server-side to `mode=reward` tokens only via `GET /tokens` (no
  point scanning standard-launch tokens, they have no holder rewards).
- Runs `GET /tokens/{mint}/rewards` for each candidate with **bounded
  concurrency** (`CONCURRENCY`, default 12 in flight).
- A token-bucket rate limiter keeps total requests under
  `MAX_REQUESTS_PER_MINUTE` (default 260, under the documented 300/min/IP
  ceiling) and backs off on `429` using the `Retry-After` header.
- Repeats the full sweep every `SCAN_INTERVAL_MS` (default 8s). The docs
  note that CDN cache hits on GET endpoints don't count against the rate
  limit, so frequent polling is cheap — the limiter is there as a safety
  net for the cache-miss case, not a normal operating constraint.

## Deploy on Railway (via GitHub)

1. Push this folder to a new GitHub repo.
2. In Railway: **New Project → Deploy from GitHub repo** → pick the repo.
3. Railway auto-detects Node via `package.json` (Nixpacks). No Dockerfile
   needed.
4. In **Variables**, set whatever you want to override — at minimum leave
   the defaults, or copy from `.env.example`. The three filters
   (`MIN_REWARDS_USD`, `MAX_HOLDERS`, `MIN_VOLUME_USD`) already match your
   request out of the box.
5. Deploy. Check the logs for the `[DEBUG RAW]` calibration output
   described above.
6. Optional: open the generated Railway URL — `/status` shows the last
   sweep's stats and current matches as JSON.

## Alerts

Both are optional — leave blank to just use logs/`​/status`.

- **Discord**: set `DISCORD_WEBHOOK_URL` to a channel webhook URL.
- **Telegram**: set `TELEGRAM_BOT_TOKEN` (from @BotFather) and
  `TELEGRAM_CHAT_ID` (your chat/channel/group id).

A matched token won't re-alert again for `REALERT_COOLDOWN_MS` (default 15
minutes) even if it still matches on the next sweep, to avoid spam while a
token sits in the qualifying range.

## Local run

```bash
cp .env.example .env
npm install
npm start
```

## Files

| File               | Purpose                                              |
| ------------------- | ----------------------------------------------------- |
| `index.js`         | Main sweep loop + `/status` HTTP endpoint            |
| `apiClient.js`     | Fetch wrapper: pagination, retries, 429 handling     |
| `rateLimiter.js`   | Token-bucket limiter under the documented 300/min cap |
| `fieldPaths.js`    | Candidate field-name resolution (see calibration ⚠️ above) |
| `alert.js`         | Discord/Telegram webhook senders                     |
| `config.js`        | All env-var driven settings                          |
