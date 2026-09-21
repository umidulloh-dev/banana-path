import { Body, Controller, Logger, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError, type ApiErrorBody } from '../common/api-error';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AiRateLimitGuard } from './ai-rate-limit.guard';
import { AiService } from './ai.service';
import {
  chatRequestSchema,
  jsonRequestSchema,
  type ChatRequest,
  type ChatStreamEvent,
  type JsonRequest,
} from './ai.dto';

@Controller('api/ai')
@UseGuards(AiRateLimitGuard)
export class AiController {
  private readonly logger = new Logger(AiController.name);

  constructor(private readonly ai: AiService) {}

  /**
   * Streams the mentor's answer as Server-Sent Events.
   *
   * The response is written by hand instead of through an interceptor because
   * errors have to reach the client *inside* the stream: once the headers are
   * out, Nest's exception filter can no longer turn them into a status code.
   */
  @Post('chat')
  async chat(
    @Body(new ZodValidationPipe(chatRequestSchema)) body: ChatRequest,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    // The browser closing the tab (or calling `AbortController.abort()`) ends
    // the request — pass that straight through to the Anthropic call so we
    // stop paying for tokens nobody will read.
    const controller = new AbortController();
    req.on('close', () => controller.abort());

    try {
      await this.ai.chat(
        body,
        (delta) => this.send(res, { type: 'delta', text: delta }),
        controller.signal,
      );
      this.send(res, { type: 'done' });
    } catch (error) {
      if (controller.signal.aborted) {
        this.logger.debug('Chat stream cancelled by the client');
      } else {
        const body = this.errorBody(error);
        this.logger.warn(`Chat stream failed: ${body.code} — ${body.message}`);
        this.send(res, { type: 'error', ...body });
      }
    } finally {
      res.end();
    }
  }

  /** One prompt in, parsed JSON out. Used for lesson generation and code review. */
  @Post('json')
  async json(
    @Body(new ZodValidationPipe(jsonRequestSchema)) body: JsonRequest,
    @Req() req: Request,
  ): Promise<unknown> {
    const controller = new AbortController();
    req.on('close', () => controller.abort());
    return this.ai.json(body.prompt, body.cache, controller.signal);
  }

  private send(res: Response, event: ChatStreamEvent): void {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  private errorBody(error: unknown): ApiErrorBody {
    if (error instanceof ApiError) {
      return { code: error.code, message: error.message };
    }
    this.logger.error(error instanceof Error ? error.stack : String(error));
    return { code: 'upstream_error', message: 'Something went wrong on the server' };
  }
}
