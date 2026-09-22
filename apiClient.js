import { config } from './config.js';
import { RateLimiter, sleep } from './rateLimiter.js';
import { resolveField, VOLUME_CANDIDATES } from './fieldPaths.js';

const limiter = new RateLimiter(config.maxRequestsPerMinute);

// Any of these are treated as transient — worth a retry with backoff rather
// than failing the whole sweep. 502/503/504 are gateway/upstream hiccups,
// not something wrong with the request itself.
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);

// Small retry wrapper: honours Retry-After on 429, retries gateway-ish 5xx
// errors a few times with backoff, and rethrows everything else.
export async function apiGet(path, { retries = 4 } = {}) {
  const url = `${config.apiBase}${path}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    await limiter.acquire();

    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(500 * (attempt + 1));
      continue;
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after')) || 5;
      limiter.block(retryAfter * 1000);
      if (attempt === retries) {
        throw new Error(`rate_limited on ${path} after ${retries} retries`);
      }
      continue;
    }

    if (RETRYABLE_STATUSES.has(res.status)) {
      if (attempt === retries) {
        throw new Error(`${res.status} from ${path} after ${retries} retries`);
      }
      // Exponential-ish backoff: 500ms, 1000ms, 1500ms, 2000ms...
      await sleep(500 * (attempt + 1));
      continue;
    }

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      const code = body?.error?.code || `http_${res.status}`;
      const message = body?.error?.message || res.statusText;
      const err = new Error(`${code}: ${message} (${path})`);
      err.code = code;
      err.status = res.status;
      throw err;
    }

    return body?.data;
  }

  throw new Error(`unreachable: exhausted retries for ${path}`);
}

// Pulls pages of GET /tokens?mode=reward into one array. Stops early once a
// page has nothing above the volume filter (see earlyStopOnLowVolume in
// config.js), and if a page fails after retries, keeps whatever was already
// gathered instead of losing the whole sweep.
export async function fetchAllRewardTokens() {
  const all = [];
  let page = 1;

  for (;;) {
    let data;
    try {
      data = await apiGet(
        `/tokens?mode=reward&sort=volume&page=${page}&pageSize=${config.pageSize}`
      );
    } catch (err) {
      console.error(
        `[sweep] giving up on page ${page} after retries (${err.message}) — ` +
          `keeping the ${all.length} tokens already fetched this sweep.`
      );
      break;
    }

    const tokens = data?.tokens || data?.items || (Array.isArray(data) ? data : []);
    if (!Array.isArray(tokens) || tokens.length === 0) break;

    all.push(...tokens);

    if (config.debugRaw && (page === 1 || page % 10 === 0)) {
      const firstVol = resolveField(tokens[0], VOLUME_CANDIDATES).value;
      const lastVol = resolveField(tokens[tokens.length - 1], VOLUME_CANDIDATES).value;
      console.log(`[DEBUG RAW] page ${page}: first token volume=${firstVol}, last token volume=${lastVol}`);
    }

    if (config.earlyStopOnLowVolume) {
      const anyAboveThreshold = tokens.some((t) => {
        const { value } = resolveField(t, VOLUME_CANDIDATES);
        return value !== undefined && value >= config.minVolumeUsd;
      });
      if (!anyAboveThreshold) {
        console.log(
          `[sweep] page ${page}: no tokens above $${config.minVolumeUsd} volume — stopping pagination early.`
        );
        break;
      }
    }

    // Stop once a page comes back short of a full page (last page), or if
    // the response tells us directly there's no more.
    const hasMore =
      data?.pagination?.hasMore ??
      data?.hasMore ??
      tokens.length === config.pageSize;

    if (!hasMore) break;
    page += 1;

    // Sanity cap so a schema surprise can't spin this into an infinite loop.
    if (page > 200) break;
  }

  return all;
}

export function fetchTokenRewards(mint) {
  return apiGet(`/tokens/${mint}/rewards`);
}
