import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { SESSION_COOKIE } from '../src/auth/auth.types';
import { AiRateLimitGuard } from '../src/ai/ai-rate-limit.guard';
import { AnthropicService } from '../src/ai/anthropic.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TEST_PASSWORD, requireEnv } from './env';
import { InMemoryPrisma } from './in-memory-prisma';

/**
 * Covers the HTTP surface — auth guard, validation, cookies, SSE framing and
 * the lesson cache — with the database and the Anthropic API replaced by
 * doubles, so it runs anywhere. `progress.e2e-spec.ts` re-checks the progress
 * routes against real PostgreSQL.
 */
const PASSWORD = TEST_PASSWORD();

/** Stands in for the Anthropic API: replays a canned answer delta by delta. */
class FakeAnthropic {
  answer = 'привет';
  calls = 0;

  complete = async (
    _messages: unknown,
    _system: string,
    options: { signal: AbortSignal; onDelta?: (delta: string) => void },
  ): Promise<string> => {
    this.calls += 1;
    for (const chunk of this.answer.split(' ')) {
      if (options.signal.aborted) break;
      options.onDelta?.(chunk);
      await Promise.resolve();
    }
    return this.answer.split(' ').join('');
  };
}

describe('API surface (e2e, in-memory)', () => {
  let app: INestApplication<App>;
  let anthropic: FakeAnthropic;
  let rateLimit: AiRateLimitGuard;
  let sessionCookie: string;

  beforeAll(async () => {
    anthropic = new FakeAnthropic();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(new InMemoryPrisma().asPrismaService())
      .overrideProvider(AnthropicService)
      .useValue(anthropic)
      .compile();

    app = moduleRef.createNestApplication<INestApplication<App>>();
    app.use(cookieParser());
    await app.init();

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ password: PASSWORD })
      .expect(200);
    sessionCookie = sessionCookieOf(login);
    rateLimit = app.get(AiRateLimitGuard);
  });

  // Each test starts with the full AI budget; the rate-limit test spends it on purpose.
  beforeEach(() => rateLimit.reset());

  afterAll(async () => {
    await app.close();
  });

  describe('auth', () => {
    it('sets an httpOnly session cookie on login', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ password: PASSWORD })
        .expect(200);

      const raw = rawSessionCookie(res);
      expect(raw.toLowerCase()).toContain('httponly');
      expect(res.body).toMatchObject({ username: 'owner' });
    });

    it('rejects an empty password with a validation error', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ password: '' })
        .expect(400)
        .expect((res) => expect(res.body).toMatchObject({ code: 'invalid_request' }));
    });

    it('closes every /api route to anonymous callers', async () => {
      await request(app.getHttpServer()).get('/api/me').expect(401);
      await request(app.getHttpServer()).get('/api/progress').expect(401);
      await request(app.getHttpServer())
        .post('/api/ai/json')
        .send({ prompt: 'hi' })
        .expect(401);
    });

    it('clears the cookie on logout', async () => {
      const res = await request(app.getHttpServer()).post('/api/auth/logout').expect(204);
      expect(rawSessionCookie(res)).toContain(`${SESSION_COOKIE}=;`);
    });
  });

  // Static file serving is not asserted here on purpose: `ServeStaticModule`
  // picks its loader from the HTTP adapter, and under `Test.createTestingModule`
  // the providers are built before the adapter exists — so it degrades to a
  // no-op loader and would never serve anything, whatever the configuration.
  describe('routing', () => {
    it('keeps /api routes owned by the controllers', async () => {
      await request(app.getHttpServer()).get('/api/me').expect(401);
      await request(app.getHttpServer()).get('/api/nothing-here').expect(404);
    });
  });

  describe('POST /api/ai/chat', () => {
    it('streams the answer as SSE and ends with a done event', async () => {
      anthropic.answer = 'Node это runtime';

      const res = await request(app.getHttpServer())
        .post('/api/ai/chat')
        .set('Cookie', sessionCookie)
        .send({ messages: [{ role: 'user', content: 'что такое Node?' }] })
        .expect(200);

      expect(res.headers['content-type']).toContain('text/event-stream');

      const events = parseSse(res.text);
      expect(events).toEqual([
        { type: 'delta', text: 'Node' },
        { type: 'delta', text: 'это' },
        { type: 'delta', text: 'runtime' },
        { type: 'done' },
      ]);
    });

    it('rejects a malformed message list', async () => {
      await request(app.getHttpServer())
        .post('/api/ai/chat')
        .set('Cookie', sessionCookie)
        .send({ messages: [{ role: 'system', content: 'nope' }] })
        .expect(400);

      await request(app.getHttpServer())
        .post('/api/ai/chat')
        .set('Cookie', sessionCookie)
        .send({ messages: [] })
        .expect(400);
    });
  });

  describe('POST /api/ai/json', () => {
    it('returns the parsed JSON the model produced', async () => {
      anthropic.answer = '{"pass":true}';

      const res = await request(app.getHttpServer())
        .post('/api/ai/json')
        .set('Cookie', sessionCookie)
        .send({ prompt: 'проверь решение', cache: false })
        .expect(201);

      expect(res.body).toEqual({ pass: true });
    });

    it('answers 422 when the model did not produce JSON', async () => {
      anthropic.answer = 'извини не могу';

      await request(app.getHttpServer())
        .post('/api/ai/json')
        .set('Cookie', sessionCookie)
        .send({ prompt: 'сгенерируй урок', cache: false })
        .expect(422)
        .expect((res) => expect(res.body).toMatchObject({ code: 'invalid_json' }));
    });

    it('serves a repeated prompt from the cache instead of calling the model twice', async () => {
      anthropic.answer = '{"cards":[]}';
      const prompt = 'урок про замыкания, вариант 7';
      const before = anthropic.calls;

      await request(app.getHttpServer())
        .post('/api/ai/json')
        .set('Cookie', sessionCookie)
        .send({ prompt })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/ai/json')
        .set('Cookie', sessionCookie)
        .send({ prompt })
        .expect(201)
        .expect((res) => expect(res.body).toEqual({ cards: [] }));

      expect(anthropic.calls - before).toBe(1);
    });
  });

  describe('rate limiting', () => {
    it('answers 429 once the per-window budget is spent', async () => {
      anthropic.answer = '{"ok":true}';
      const budget = Number(requireEnv('AI_RATE_LIMIT'));

      for (let spent = 0; spent < budget; spent += 1) {
        await request(app.getHttpServer())
          .post('/api/ai/json')
          .set('Cookie', sessionCookie)
          .send({ prompt: `запрос номер ${spent}`, cache: false })
          .expect(201);
      }

      await request(app.getHttpServer())
        .post('/api/ai/json')
        .set('Cookie', sessionCookie)
        .send({ prompt: 'на один больше', cache: false })
        .expect(429)
        .expect((res) => expect(res.body).toMatchObject({ code: 'rate_limited' }));
    });
  });
});

function rawSessionCookie(res: request.Response): string {
  const raw: unknown = res.headers['set-cookie'];
  const cookies: string[] = Array.isArray(raw)
    ? raw.filter((cookie): cookie is string => typeof cookie === 'string')
    : typeof raw === 'string'
      ? [raw]
      : [];

  const match = cookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
  if (!match) throw new Error('response did not set a session cookie');
  return match;
}

function sessionCookieOf(res: request.Response): string {
  return rawSessionCookie(res).split(';')[0];
}

/** Parses the `data: {...}` frames of an SSE body. */
function parseSse(body: string): unknown[] {
  return body
    .split('\n\n')
    .map((frame) => frame.trim())
    .filter((frame) => frame.startsWith('data:'))
    .map((frame) => JSON.parse(frame.slice(5).trim()) as unknown);
}
