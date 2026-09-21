import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import type { AuthenticatedUser, JwtPayload } from './auth.types';

/** The site has exactly one account; the password in env unlocks it. */
const OWNER_USERNAME = 'owner';

export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /** Verifies the password and returns a signed session token. */
  async login(password: string): Promise<{ token: string; user: AuthenticatedUser }> {
    if (!this.passwordMatches(password)) {
      throw ApiError.unauthorized('Wrong password');
    }

    const user = await this.prisma.user.upsert({
      where: { username: OWNER_USERNAME },
      update: {},
      create: { username: OWNER_USERNAME },
    });

    const payload: JwtPayload = { sub: user.id, username: user.username };
    const token = await this.jwt.signAsync(payload);
    return { token, user: { id: user.id, username: user.username } };
  }

  /** Decodes and verifies a session token; throws when it is invalid. */
  async verify(token: string): Promise<AuthenticatedUser> {
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      return { id: payload.sub, username: payload.username };
    } catch {
      throw new ApiError('session_expired', 'Session expired, sign in again', 401);
    }
  }

  /**
   * Constant-time comparison so a wrong password cannot be guessed byte by byte
   * from how long the response takes.
   */
  private passwordMatches(candidate: string): boolean {
    const expected = Buffer.from(this.config.get('APP_PASSWORD', { infer: true }), 'utf8');
    const given = Buffer.from(candidate, 'utf8');
    if (expected.length !== given.length) {
      // Still burn a comparison so the length check is not a timing signal.
      timingSafeEqual(expected, expected);
      return false;
    }
    return timingSafeEqual(expected, given);
  }
}
