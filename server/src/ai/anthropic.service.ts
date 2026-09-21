import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiError } from '../common/api-error';
import type { Env } from '../config/env';

export interface StreamOptions {
  /** Aborted when the browser closes the SSE connection. */
  signal: AbortSignal;
  /** Called for every text delta as it arrives. */
  onDelta?: (delta: string) => void;
}

/**
 * The only place in the codebase that talks to the Anthropic API.
 * The API key lives here and never leaves the server.
 */
@Injectable()
export class AnthropicService implements OnModuleInit {
  private readonly logger = new Logger(AnthropicService.name);
  private client!: Anthropic;

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    this.client = new Anthropic({
      apiKey: this.config.get('ANTHROPIC_API_KEY', { infer: true }),
    });
    this.logger.log(`Using model ${this.config.get('ANTHROPIC_MODEL', { infer: true })}`);
  }

  /**
   * Streams one completion and resolves with the full text.
   * Deltas are pushed through `onDelta` while the request is in flight.
   */
  async complete(
    messages: Anthropic.MessageParam[],
    system: string,
    options: StreamOptions,
  ): Promise<string> {
    const stream = this.client.messages.stream(
      {
        model: this.config.get('ANTHROPIC_MODEL', { infer: true }),
        max_tokens: this.config.get('ANTHROPIC_MAX_TOKENS', { infer: true }),
        system,
        messages,
        thinking: { type: 'adaptive' },
        output_config: { effort: this.config.get('ANTHROPIC_EFFORT', { infer: true }) },
      },
      { signal: options.signal },
    );

    if (options.onDelta) {
      const onDelta = options.onDelta;
      stream.on('text', (delta: string) => onDelta(delta));
    }

    try {
      const message = await stream.finalMessage();

      // Safety classifiers can decline a request: HTTP 200, no usable content.
      if (message.stop_reason === 'refusal') {
        throw ApiError.refused();
      }

      return message.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');
    } catch (error) {
      throw this.toApiError(error);
    }
  }

  /** Maps SDK errors onto the error codes the frontend already understands. */
  private toApiError(error: unknown): unknown {
    if (error instanceof ApiError) return error;

    if (error instanceof Anthropic.RateLimitError) {
      return ApiError.rateLimited('The Anthropic API rate limit was reached, try again shortly');
    }
    if (error instanceof Anthropic.BadRequestError) {
      // Overwhelmingly this means the conversation no longer fits the window.
      this.logger.warn(`Anthropic rejected the request: ${error.message}`);
      return ApiError.promptTooLarge('The request was rejected — the prompt is likely too long');
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return ApiError.upstream('Could not reach the Anthropic API');
    }
    if (error instanceof Anthropic.APIError) {
      this.logger.error(`Anthropic API error: ${error.message}`);
      return ApiError.upstream();
    }
    return error;
  }
}
