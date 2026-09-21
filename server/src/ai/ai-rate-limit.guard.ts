import { CanActivate, ExecutionContext, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiError } from '../common/api-error';
import { RateLimiter } from '../common/rate-limiter';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { Env } from '../config/env';

const PRUNE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Caps how many AI calls one user can make per window. The site is private,
 * so this is not about abuse — it is about not waking up to a surprise bill
 * because a retry loop ran all night.
 */
@Injectable()
export class AiRateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly limiter: RateLimiter;
  private readonly pruneTimer: NodeJS.Timeout;

  constructor(config: ConfigService<Env, true>) {
    this.limiter = new RateLimiter(
      config.get('AI_RATE_LIMIT', { infer: true }),
      config.get('AI_RATE_WINDOW_MS', { infer: true }),
    );
    this.pruneTimer = setInterval(() => this.limiter.prune(), PRUNE_INTERVAL_MS);
    this.pruneTimer.unref();
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const key = request.user?.id ?? request.ip ?? 'anonymous';
    const result = this.limiter.hit(key);

    if (!result.allowed) {
      const seconds = Math.ceil(result.retryAfterMs / 1000);
      throw ApiError.rateLimited(`Too many AI requests. Try again in ${seconds}s.`);
    }
    return true;
  }

  /** Clears the recorded hits — used by tests to start from a known budget. */
  reset(): void {
    this.limiter.reset();
  }

  onModuleDestroy(): void {
    clearInterval(this.pruneTimer);
  }
}
