import express from 'express';
import { config } from './config.js';
import { fetchAllRewardTokens, fetchTokenRewards } from './apiClient.js';
import { resolveField, VOLUME_CANDIDATES, HOLDERS_CANDIDATES, PENDING_REWARDS_USD_CANDIDATES } from './fieldPaths.js';
import { sendAlert } from './alert.js';

let debuggedToken = false;
let debuggedRewards = false;

// mint -> last time we alerted on it, to avoid spamming every sweep.
const lastAlertedAt = new Map();

let lastSweep = {
  startedAt: null,
  finishedAt: null,
  scanned: 0,
  matches: [],
  errors: 0,
};

async function checkOneToken(token) {
  const mint = token.mint || token.address || token.id;
  if (!mint) return null;

  if (config.debugRaw && !debuggedToken) {
    debuggedToken = true;
    console.log('[DEBUG RAW] sample token object from GET /tokens:\n', JSON.stringify(token, null, 2));
  }

  const { value: volumeUsd, matchedPath: volPath } = resolveField(token, VOLUME_CANDIDATES);
  const { value: holders, matchedPath: holdersPath } = resolveField(token, HOLDERS_CANDIDATES);

  let rewardsData;
  try {
    rewardsData = await fetchTokenRewards(mint);
  } catch (err) {
    console.error(`rewards fetch failed for ${mint}: ${err.message}`);
    lastSweep.errors += 1;
    return null;
  }

  if (config.debugRaw && !debuggedRewards) {
    debuggedRewards = true;
    console.log('[DEBUG RAW] sample response from GET /tokens/{mint}/rewards:\n', JSON.stringify(rewardsData, null, 2));
  }

  const { value: pendingRewardsUsd, matchedPath: rewardsPath } = resolveField(rewardsData, PENDING_REWARDS_USD_CANDIDATES);

  if (rewardsPath === 'rewards.totalUsd' || rewardsPath === 'rewards.total.usd') {
    console.warn(
      `[WARN] ${mint}: no "pending/unclaimed" reward field matched — falling back to a lifetime ` +
        `total (${rewardsPath}). This likely overcounts. Check DEBUG RAW output and update fieldPaths.js.`
    );
  }

  if ([volumeUsd, holders, pendingRewardsUsd].some((v) => v === undefined)) {
    // Missing data for this token — can't safely evaluate the filter, skip it
    // rather than false-matching or false-excluding it.
    return null;
  }

  const matches =
    pendingRewardsUsd > config.minRewardsUsd &&
    holders <= config.maxHolders &&
    volumeUsd >= config.minVolumeUsd;

  if (!matches) return null;

  return {
    mint,
    symbol: token.symbol,
    name: token.name,
    pendingRewardsUsd,
    holders,
    volumeUsd,
    fieldPaths: { volPath, holdersPath, rewardsPath },
  };
}

async function runSweep() {
  const startedAt = new Date();
  let tokens = [];

  try {
    tokens = await fetchAllRewardTokens();
  } catch (err) {
    console.error('Failed to list reward tokens:', err.message);
    lastSweep = { ...lastSweep, finishedAt: new Date(), errors: lastSweep.errors + 1 };
    return;
  }

  console.log(`[sweep] scanning ${tokens.length} reward-mode tokens...`);

  const matches = [];
  let errors = 0;

  // Bounded concurrency so we use the rate-limit headroom without firing
  // hundreds of requests at once.
  let cursor = 0;
  async function worker() {
    while (cursor < tokens.length) {
      const token = tokens[cursor];
      cursor += 1;
      try {
        const result = await checkOneToken(token);
        if (result) matches.push(result);
      } catch (err) {
        errors += 1;
        console.error('Error checking token:', err.message);
      }
    }
  }
  await Promise.all(Array.from({ length: config.concurrency }, worker));

  const now = Date.now();
  for (const match of matches) {
    const last = lastAlertedAt.get(match.mint) || 0;
    if (now - last >= config.realertCooldownMs) {
      lastAlertedAt.set(match.mint, now);
      await sendAlert(match);
    } else {
      console.log(`(still matching, cooldown active) ${match.symbol || match.mint}`);
    }
  }

  lastSweep = {
    startedAt,
    finishedAt: new Date(),
    scanned: tokens.length,
    matches,
    errors,
  };

  console.log(
    `[sweep] done in ${lastSweep.finishedAt - startedAt}ms — ${tokens.length} scanned, ${matches.length} matched, ${errors} errors`
  );
}

async function loop() {
  for (;;) {
    const t0 = Date.now();
    try {
      await runSweep();
    } catch (err) {
      console.error('Sweep crashed:', err);
    }
    const elapsed = Date.now() - t0;
    const wait = Math.max(0, config.scanIntervalMs - elapsed);
    await new Promise((r) => setTimeout(r, wait));
  }
}

// --- tiny status server (also satisfies Railway's expectation of a listening port) ---
const app = express();

app.get('/', (_req, res) => res.json({ ok: true, service: 'stonkfun-rewards-bot' }));

app.get('/status', (_req, res) => {
  res.json({
    filters: {
      minRewardsUsd: config.minRewardsUsd,
      maxHolders: config.maxHolders,
      minVolumeUsd: config.minVolumeUsd,
    },
    lastSweep: {
      startedAt: lastSweep.startedAt,
      finishedAt: lastSweep.finishedAt,
      scanned: lastSweep.scanned,
      errors: lastSweep.errors,
      matchCount: lastSweep.matches.length,
    },
    matches: lastSweep.matches,
  });
});

app.listen(config.port, () => {
  console.log(`status server listening on :${config.port}`);
  console.log(
    `filters -> rewards > $${config.minRewardsUsd}, holders <= ${config.maxHolders}, volume >= $${config.minVolumeUsd}`
  );
  loop();
});
