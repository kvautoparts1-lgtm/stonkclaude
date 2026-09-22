// The StonkFun developer docs (https://www.stonkfun.xyz/developers) document
// query params and endpoint *purpose*, but not the full JSON response schema.
// So instead of hardcoding one guessed field name (and silently filtering on
// `undefined` forever), we try a short list of plausible candidates in order.
//
// IMPORTANT: run once with DEBUG_RAW=true, check the Railway logs for the
// "[DEBUG RAW]" blocks, and confirm/adjust the candidate arrays below to
// match what the API actually returns. Whichever key matched is logged too.

function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

// Returns { value, matchedPath } for the first candidate path that resolves
// to a defined value, or { value: undefined, matchedPath: null }.
export function resolveField(obj, candidates) {
  for (const path of candidates) {
    const value = getPath(obj, path);
    if (value !== undefined && value !== null) {
      return { value, matchedPath: path };
    }
  }
  return { value: undefined, matchedPath: null };
}

// Candidate field paths on a single token object from GET /tokens (or
// GET /tokens/{mint}).
export const VOLUME_CANDIDATES = [
  'volume',
  'volume24h',
  'volumeUsd',
  'volume24hUsd',
  'volume.usd',
  'volume.h24',
  'marketData.volume',
  'marketData.volume24h',
  'stats.volume24h',
];

export const HOLDERS_CANDIDATES = [
  'holders',
  'holderCount',
  'numHolders',
  'holdersCount',
  'holderTotal',
  'stats.holders',
  'marketData.holders',
];

// Candidate field paths on the object returned by
// GET /tokens/{mint}/rewards. We prefer a "pending / not yet distributed"
// figure over a lifetime total, since the filter is about what's ABOUT to
// be paid out. Ordered most-specific-first.
export const PENDING_REWARDS_USD_CANDIDATES = [
  'rewards.pendingUsd',
  'rewards.pending.usd',
  'rewards.unclaimedUsd',
  'rewards.unclaimed.usd',
  'rewards.nextDistributionUsd',
  'rewards.nextDistribution.usd',
  'rewards.accruedUsd',
  'rewards.accrued.usd',
  'pendingUsd',
  'pending.usd',
  'unclaimedUsd',
  // Fallback only — this is likely a LIFETIME total, not "about to be
  // distributed". Kept last on purpose; if this is what matches, the bot
  // logs a warning so you know to double check against the live shape.
  'rewards.totalUsd',
  'rewards.total.usd',
];
