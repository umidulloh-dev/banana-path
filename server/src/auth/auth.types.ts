import type { Request } from 'express';

/** Name of the httpOnly cookie that carries the session token. */
export const SESSION_COOKIE = 'banana_session';

export interface JwtPayload {
  /** User id. */
  sub: string;
  username: string;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
}

/** An Express request that passed `JwtAuthGuard`. */
export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
