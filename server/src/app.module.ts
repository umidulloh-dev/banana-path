import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { validateEnv, type Env } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { ProgressModule } from './progress/progress.module';

/** `dist/app.module.js` → `server/` → repo root → `public/`. */
const DEFAULT_PUBLIC_DIR = join(__dirname, '..', '..', 'public');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '../.env'],
      validate: validateEnv,
    }),
    ServeStaticModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [
        {
          rootPath: config.get('PUBLIC_DIR', { infer: true }) ?? DEFAULT_PUBLIC_DIR,
          // Never let the static handler answer an API route.
          exclude: ['/api/{*splat}'],
        },
      ],
    }),
    PrismaModule,
    AuthModule,
    AiModule,
    ProgressModule,
  ],
  providers: [
    // Every route is behind the session guard unless it is marked @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
