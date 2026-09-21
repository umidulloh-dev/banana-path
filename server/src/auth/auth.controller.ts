import { Body, Controller, Get, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Env } from '../config/env';
import { AuthService, SESSION_MAX_AGE_MS } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import { SESSION_COOKIE, type AuthenticatedUser } from './auth.types';

const loginSchema = z.object({
  password: z.string().min(1, 'password is required').max(256),
});
type LoginBody = z.infer<typeof loginSchema>;

@Controller('api')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthenticatedUser> {
    const { token, user } = await this.auth.login(body.password);
    res.cookie(SESSION_COOKIE, token, this.cookieOptions());
    return user;
  }

  @Public()
  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(SESSION_COOKIE, { ...this.cookieOptions(), maxAge: undefined });
  }

  /** The frontend calls this on boot: 200 means "signed in", 401 means "show login". */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      maxAge: SESSION_MAX_AGE_MS,
      path: '/',
    };
  }
}
