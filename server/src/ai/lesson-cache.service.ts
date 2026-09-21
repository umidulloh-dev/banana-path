import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Generated lessons are deterministic per prompt for a day, and a lesson costs
 * real money to generate — so an identical prompt is answered from Postgres.
 * Replaces the `cache: { gcTime: 86400000 }` option the claude.ai host provided.
 */
/** A cached value, or the fact that there was none — `undefined` would be ambiguous. */
export type CacheLookup = { hit: true; value: unknown } | { hit: false };

@Injectable()
export class LessonCacheService {
  private readonly logger = new Logger(LessonCacheService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async get(prompt: string): Promise<CacheLookup> {
    const key = this.keyFor(prompt);
    const row = await this.prisma.lessonCache.findUnique({ where: { key } });
    if (!row) return { hit: false };

    if (row.expiresAt.getTime() <= Date.now()) {
      await this.prisma.lessonCache.delete({ where: { key } }).catch(() => undefined);
      return { hit: false };
    }

    this.logger.debug(`Cache hit for ${key.slice(0, 12)}…`);
    return { hit: true, value: row.payload };
  }

  async set(prompt: string, payload: unknown): Promise<void> {
    const key = this.keyFor(prompt);
    const ttlMs = this.config.get('LESSON_CACHE_TTL_MS', { infer: true });
    const data = payload as Prisma.InputJsonValue;
    const expiresAt = new Date(Date.now() + ttlMs);

    await this.prisma.lessonCache.upsert({
      where: { key },
      create: { key, payload: data, expiresAt },
      update: { payload: data, expiresAt },
    });
  }

  /** Housekeeping for rows nobody will ever read again. */
  async purgeExpired(): Promise<number> {
    const { count } = await this.prisma.lessonCache.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    return count;
  }

  /** The model is part of the key: switching models must not reuse old answers. */
  private keyFor(prompt: string): string {
    const model = this.config.get('ANTHROPIC_MODEL', { infer: true });
    return createHash('sha256').update(`${model}\u0000${prompt}`).digest('hex');
  }
}
