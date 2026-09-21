import type { PrismaService } from '../src/prisma/prisma.service';

interface UserRow {
  id: string;
  username: string;
  createdAt: Date;
}
interface ProgressRow {
  userId: string;
  data: unknown;
  updatedAt: Date;
}
interface LessonCacheRow {
  key: string;
  payload: unknown;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * A tiny stand-in for the handful of Prisma calls this app makes, so the HTTP
 * layer (guards, pipes, cookies, SSE) can be tested without a database.
 * `progress.e2e-spec.ts` covers the same routes against real PostgreSQL.
 */
export class InMemoryPrisma {
  private readonly users = new Map<string, UserRow>();
  private readonly progressRows = new Map<string, ProgressRow>();
  private readonly cacheRows = new Map<string, LessonCacheRow>();
  private nextId = 1;

  $connect = (): Promise<void> => Promise.resolve();
  $disconnect = (): Promise<void> => Promise.resolve();

  readonly user = {
    upsert: ({ where }: { where: { username: string } }): Promise<UserRow> => {
      const existing = [...this.users.values()].find((u) => u.username === where.username);
      if (existing) return Promise.resolve(existing);

      const created: UserRow = {
        id: `user-${this.nextId++}`,
        username: where.username,
        createdAt: new Date(),
      };
      this.users.set(created.id, created);
      return Promise.resolve(created);
    },
    deleteMany: (): Promise<{ count: number }> => {
      const count = this.users.size;
      this.users.clear();
      this.progressRows.clear();
      return Promise.resolve({ count });
    },
  };

  readonly progress = {
    findUnique: ({ where }: { where: { userId: string } }): Promise<ProgressRow | null> =>
      Promise.resolve(this.progressRows.get(where.userId) ?? null),

    upsert: ({
      where,
      create,
    }: {
      where: { userId: string };
      create: { userId: string; data: unknown };
      update: { data: unknown };
    }): Promise<ProgressRow> => {
      const row: ProgressRow = {
        userId: where.userId,
        data: create.data,
        updatedAt: new Date(),
      };
      this.progressRows.set(where.userId, row);
      return Promise.resolve(row);
    },
  };

  readonly lessonCache = {
    findUnique: ({ where }: { where: { key: string } }): Promise<LessonCacheRow | null> =>
      Promise.resolve(this.cacheRows.get(where.key) ?? null),

    upsert: ({
      where,
      create,
    }: {
      where: { key: string };
      create: { key: string; payload: unknown; expiresAt: Date };
      update: { payload: unknown; expiresAt: Date };
    }): Promise<LessonCacheRow> => {
      const row: LessonCacheRow = { ...create, createdAt: new Date() };
      this.cacheRows.set(where.key, row);
      return Promise.resolve(row);
    },

    delete: ({ where }: { where: { key: string } }): Promise<void> => {
      this.cacheRows.delete(where.key);
      return Promise.resolve();
    },

    deleteMany: (): Promise<{ count: number }> => {
      const count = this.cacheRows.size;
      this.cacheRows.clear();
      return Promise.resolve({ count });
    },
  };

  /** Only the members the app actually touches are implemented. */
  asPrismaService(): PrismaService {
    return this as unknown as PrismaService;
  }
}
