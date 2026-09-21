import { Body, Controller, Get, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { progressSchema, type ProgressData, type ProgressResponse } from './progress.dto';
import { ProgressService } from './progress.service';

@Controller('api/progress')
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser): Promise<ProgressResponse> {
    return this.progress.get(user.id);
  }

  @Put()
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(progressSchema)) data: ProgressData,
  ): Promise<ProgressResponse> {
    return this.progress.save(user.id, data);
  }
}
