/*
 * Runs before the test modules are imported, because `AppModule` validates the
 * environment while it is being loaded — setting these inside `beforeAll`
 * would already be too late.
 *
 * Values that CI (or a local shell) already provides are left alone, so the
 * real-PostgreSQL suite picks up the real DATABASE_URL.
 */
process.env.NODE_ENV = 'test';
process.env.APP_PASSWORD ??= 'banana-test-password';
process.env.JWT_SECRET ??= 'banana-test-secret-long-enough';
process.env.ANTHROPIC_API_KEY ??= 'sk-ant-test-placeholder';
process.env.ANTHROPIC_MODEL ??= 'claude-opus-5';
process.env.DATABASE_URL ??= 'postgresql://banana:banana@localhost:5432/banana_path_test?schema=public';

// A small budget keeps the rate-limit test fast.
process.env.AI_RATE_LIMIT ??= '3';
process.env.AI_RATE_WINDOW_MS ??= '60000';
