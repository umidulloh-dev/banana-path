import { z } from 'zod';

/**
 * Every environment variable the server reads, in one place.
 * Parsed once at boot — a missing or malformed value stops the process
 * instead of surfacing as a confusing runtime error later.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-opus-5'),
  /**
   * Generating a full lesson (intro + cards + tasks) with adaptive thinking
   * runs long, and hitting the cap truncates the JSON mid-answer. Requests are
   * streamed, so a high ceiling costs nothing extra — only generated tokens bill.
   */
  ANTHROPIC_MAX_TOKENS: z.coerce.number().int().positive().default(48000),
  ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),

  APP_PASSWORD: z.string().min(1, 'APP_PASSWORD is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),

  /** Folder that holds index.html. Defaults to `<repo>/public`. */
  PUBLIC_DIR: z.string().optional(),

  /** AI rate limit: N requests per window, per user. */
  AI_RATE_LIMIT: z.coerce.number().int().positive().default(30),
  AI_RATE_WINDOW_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),

  /** How long a generated lesson stays cached. */
  LESSON_CACHE_TTL_MS: z.coerce.number().int().positive().default(24 * 60 * 60 * 1000),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}

/** `ConfigService` typed against our schema — `config.get('PORT')` is a number. */
export type TypedConfigService = import('@nestjs/config').ConfigService<Env, true>;
