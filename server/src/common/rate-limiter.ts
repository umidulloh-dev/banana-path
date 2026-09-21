/**
 * Sliding-window rate limiter.
 *
 * Keeps the timestamps of the recent hits per key and drops the ones that fell
 * out of the window. In-memory on purpose: one Railway instance, one owner —
 * swapping this for Redis later only means reimplementing `hit()`.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the next hit would be allowed; 0 when allowed. */
  retryAfterMs: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    if (limit < 1) throw new Error('RateLimiter: limit must be at least 1');
    if (windowMs < 1) throw new Error('RateLimiter: windowMs must be at least 1');
  }

  hit(key: string, now: number = Date.now()): RateLimitResult {
    const windowStart = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((at) => at > windowStart);

    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      const oldest = recent[0];
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1, oldest + this.windowMs - now),
      };
    }

    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, remaining: this.limit - recent.length, retryAfterMs: 0 };
  }

  reset(key?: string): void {
    if (key === undefined) this.hits.clear();
    else this.hits.delete(key);
  }

  /** Drops keys with no hits left in the window, so the map cannot grow forever. */
  prune(now: number = Date.now()): void {
    const windowStart = now - this.windowMs;
    for (const [key, timestamps] of this.hits) {
      const recent = timestamps.filter((at) => at > windowStart);
      if (recent.length === 0) this.hits.delete(key);
      else this.hits.set(key, recent);
    }
  }
}
