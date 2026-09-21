import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  it('allows hits up to the limit and blocks the next one', () => {
    const limiter = new RateLimiter(3, 1000);

    expect(limiter.hit('user', 0)).toEqual({ allowed: true, remaining: 2, retryAfterMs: 0 });
    expect(limiter.hit('user', 100)).toEqual({ allowed: true, remaining: 1, retryAfterMs: 0 });
    expect(limiter.hit('user', 200)).toEqual({ allowed: true, remaining: 0, retryAfterMs: 0 });

    const blocked = limiter.hit('user', 300);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('reports how long to wait until the oldest hit leaves the window', () => {
    const limiter = new RateLimiter(2, 1000);
    limiter.hit('user', 0);
    limiter.hit('user', 400);

    // The hit at t=0 expires at t=1000, so at t=600 the wait is 400ms.
    expect(limiter.hit('user', 600).retryAfterMs).toBe(400);
  });

  it('lets requests through again once the window slides past old hits', () => {
    const limiter = new RateLimiter(2, 1000);
    limiter.hit('user', 0);
    limiter.hit('user', 100);
    expect(limiter.hit('user', 500).allowed).toBe(false);

    // t=1101 — both earlier hits are older than the 1000ms window.
    expect(limiter.hit('user', 1101).allowed).toBe(true);
  });

  it('counts each key separately', () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.hit('umid', 0).allowed).toBe(true);
    expect(limiter.hit('umid', 1).allowed).toBe(false);
    expect(limiter.hit('someone-else', 1).allowed).toBe(true);
  });

  it('forgets keys whose hits all fell out of the window', () => {
    const limiter = new RateLimiter(1, 1000);
    limiter.hit('user', 0);
    limiter.prune(2000);
    expect(limiter.hit('user', 2001).allowed).toBe(true);
  });

  it('reset clears one key or everything', () => {
    const limiter = new RateLimiter(1, 1000);
    limiter.hit('a', 0);
    limiter.hit('b', 0);

    limiter.reset('a');
    expect(limiter.hit('a', 1).allowed).toBe(true);
    expect(limiter.hit('b', 1).allowed).toBe(false);

    limiter.reset();
    expect(limiter.hit('b', 2).allowed).toBe(true);
  });

  it('rejects nonsensical configuration', () => {
    expect(() => new RateLimiter(0, 1000)).toThrow('limit must be at least 1');
    expect(() => new RateLimiter(1, 0)).toThrow('windowMs must be at least 1');
  });
});
