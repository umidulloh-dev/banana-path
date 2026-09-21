import { z } from 'zod';

/** Matches the message shape the frontend sends to `sample()`. */
export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(40_000),
});

export const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(60),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const jsonRequestSchema = z.object({
  prompt: z.string().min(1).max(40_000),
  /** `false` bypasses the lesson cache (the "generate a fresh one" button). */
  cache: z.boolean().default(true),
});
export type JsonRequest = z.infer<typeof jsonRequestSchema>;

/** Events pushed over SSE by `POST /api/ai/chat`. */
export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; code: string; message: string };
