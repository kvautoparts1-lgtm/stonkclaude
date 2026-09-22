import { config } from './config.js';
import { RateLimiter, sleep } from './rateLimiter.js';

const limiter = new RateLimiter(config.maxRequestsPerMinute);

// Small retry wrapper: honours Retry-After on 429, retries 500/503 a couple
// times with backoff, and rethrows everything else.
export async function apiGet(path, { retries = 3 } = {}) {
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

    if (res.status === 500 || res.status === 503) {
      if (attempt === retries) {
        throw new Error(`${res.status} from ${path} after ${retries} retries`);
      }
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

// Pulls every page of GET /tokens?mode=reward into one array.
export async function fetchAllRewardTokens() {
  const all = [];
  let page = 1;

  for (;;) {
    const data = await apiGet(
      `/tokens?mode=reward&sort=volume&page=${page}&pageSize=${config.pageSize}`
    );
    const tokens = data?.tokens || data?.items || (Array.isArray(data) ? data : []);
    if (!Array.isArray(tokens) || tokens.length === 0) break;

    all.push(...tokens);

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
