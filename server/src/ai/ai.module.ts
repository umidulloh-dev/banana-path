import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiRateLimitGuard } from './ai-rate-limit.guard';
import { AnthropicService } from './anthropic.service';
import { LessonCacheService } from './lesson-cache.service';

@Module({
  controllers: [AiController],
  providers: [AiService, AnthropicService, LessonCacheService, AiRateLimitGuard],
})
export class AiModule {}
