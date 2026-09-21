import type Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { AnthropicService } from './anthropic.service';
import { extractJson } from './json-extract';
import { LessonCacheService } from './lesson-cache.service';
import type { ChatRequest } from './ai.dto';

const CHAT_SYSTEM = [
  'You are the mentor inside "Banana Path", a Duolingo-style course on Node.js and TypeScript.',
  'Answer in Russian unless the student writes in another language.',
  'Be concrete, show small code samples, and keep explanations short.',
].join(' ');

const JSON_SYSTEM = [
  'You are the lesson engine of "Banana Path", a Node.js/TypeScript course.',
  'Reply with a single valid JSON value and nothing else — no prose, no code fences.',
].join(' ');

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly anthropic: AnthropicService,
    private readonly cache: LessonCacheService,
  ) {}

  /** Streaming chat: every delta is handed to `onDelta` as it arrives. */
  async chat(
    request: ChatRequest,
    onDelta: (delta: string) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const messages: Anthropic.MessageParam[] = request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    await this.anthropic.complete(messages, CHAT_SYSTEM, { signal, onDelta });
  }

  /**
   * One prompt in, parsed JSON out — with a 24h cache in front of it.
   * Answers that cannot be parsed as JSON are a 422, never a half-broken lesson.
   */
  async json(prompt: string, useCache: boolean, signal: AbortSignal): Promise<unknown> {
    if (useCache) {
      const cached = await this.cache.get(prompt);
      if (cached.hit) return cached.value;
    }

    const text = await this.anthropic.complete(
      [{ role: 'user', content: prompt }],
      JSON_SYSTEM,
      { signal },
    );

    const parsed = extractJson(text);
    if (!parsed.ok) {
      this.logger.warn(`Model answer was not JSON (${text.length} chars)`);
      throw ApiError.invalidJson();
    }

    if (useCache) {
      // A failed cache write must not fail the request the user is waiting on.
      await this.cache.set(prompt, parsed.value).catch((error: unknown) => {
        this.logger.warn(`Could not cache the lesson: ${String(error)}`);
      });
    }

    return parsed.value;
  }
}
