// Simple token-bucket limiter. Refills continuously so requests spread out
// rather than bursting to the cap and then stalling for a whole minute.
export class RateLimiter {
  constructor(maxPerMinute) {
    this.capacity = maxPerMinute;
    this.tokens = maxPerMinute;
    this.refillPerMs = maxPerMinute / 60000;
    this.last = Date.now();
    // Set when a 429 tells us to cool down; overrides normal refill logic.
    this.blockedUntil = 0;
  }

  _refill() {
    const now = Date.now();
    const elapsed = now - this.last;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.last = now;
  }

  // Called when the API tells us to back off (429 + Retry-After).
  block(ms) {
    this.blockedUntil = Date.now() + ms;
    this.tokens = 0;
  }

  async acquire() {
    for (;;) {
      const now = Date.now();
      if (now < this.blockedUntil) {
        await sleep(this.blockedUntil - now);
        continue;
      }
      this._refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      // Not enough tokens yet — wait for roughly one token's worth of time.
      await sleep(Math.max(20, 1 / this.refillPerMs / 10));
    }
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
