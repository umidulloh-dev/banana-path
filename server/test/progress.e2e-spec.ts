import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { TEST_PASSWORD } from './env';
import { SESSION_COOKIE } from '../src/auth/auth.types';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * End-to-end coverage for the progress API.
 * Needs a real PostgreSQL — `docker compose up -d db` locally, a service
 * container in CI — with the migrations already applied.
 */
const PASSWORD = TEST_PASSWORD();

describe('Progress API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sessionCookie: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication<INestApplication<App>>();
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.user.deleteMany({ where: { username: 'owner' } });

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ password: PASSWORD })
      .expect(200);

    sessionCookie = extractSessionCookie(login);
    expect(sessionCookie).toContain(SESSION_COOKIE);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: 'owner' } });
    await app.close();
  });

  describe('authentication', () => {
    it('rejects an anonymous request', async () => {
      await request(app.getHttpServer())
        .get('/api/progress')
        .expect(401)
        .expect((res) => expect(res.body).toMatchObject({ code: 'unauthorized' }));
    });

    it('rejects a tampered session cookie', async () => {
      await request(app.getHttpServer())
        .get('/api/progress')
        .set('Cookie', `${SESSION_COOKIE}=not-a-real-token`)
        .expect(401)
        .expect((res) => expect(res.body).toMatchObject({ code: 'session_expired' }));
    });

    it('rejects a wrong password', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ password: 'definitely-not-it' })
        .expect(401);
    });

    it('reports the signed-in user on /api/me', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/me')
        .set('Cookie', sessionCookie)
        .expect(200);

      expect(res.body).toMatchObject({ username: 'owner' });
      expect(typeof (res.body as { id: unknown }).id).toBe('string');
    });
  });

  describe('GET/PUT /api/progress', () => {
    it('reports no progress before anything is saved', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/progress')
        .set('Cookie', sessionCookie)
        .expect(200);

      expect(res.body).toEqual({ exists: false, data: null, updatedAt: null });
    });

    it('stores the state object and reads it back unchanged', async () => {
      const state = {
        v: 1,
        xp: 120,
        bananas: 3,
        streak: 2,
        lastDay: '2026-09-21',
        done: { 'ts-basic': { xp: 20, at: 1758400000000 } },
        leet: { easy: 1, medium: 0 },
        sound: true,
      };

      await request(app.getHttpServer())
        .put('/api/progress')
        .set('Cookie', sessionCookie)
        .send(state)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/progress')
        .set('Cookie', sessionCookie)
        .expect(200);

      expect(res.body).toMatchObject({ exists: true, data: state });
      expect(typeof (res.body as { updatedAt: unknown }).updatedAt).toBe('string');
    });

    it('overwrites the previous state on the next save', async () => {
      await request(app.getHttpServer())
        .put('/api/progress')
        .set('Cookie', sessionCookie)
        .send({ v: 1, xp: 999 })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/progress')
        .set('Cookie', sessionCookie)
        .expect(200);

      expect(res.body).toMatchObject({ exists: true, data: { v: 1, xp: 999 } });
    });

    it('refuses a body that is not a JSON object', async () => {
      await request(app.getHttpServer())
        .put('/api/progress')
        .set('Cookie', sessionCookie)
        .send('[1, 2, 3]')
        .set('Content-Type', 'application/json')
        .expect(400)
        .expect((res) => expect(res.body).toMatchObject({ code: 'invalid_request' }));
    });

    it('needs a session to write, too', async () => {
      await request(app.getHttpServer()).put('/api/progress').send({ xp: 1 }).expect(401);
    });
  });
});

function extractSessionCookie(res: request.Response): string {
  const raw: unknown = res.headers['set-cookie'];
  const cookies: string[] = Array.isArray(raw)
    ? raw.filter((cookie): cookie is string => typeof cookie === 'string')
    : typeof raw === 'string'
      ? [raw]
      : [];

  const match = cookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
  if (!match) throw new Error('login did not set a session cookie');
  return match.split(';')[0];
}
