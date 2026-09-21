import { z } from 'zod';

/**
 * The frontend owns the shape of its state object `S`; the server only checks
 * that it is a JSON object of a sane size and stores it as-is. That keeps the
 * two sides decoupled: adding a field in index.html needs no migration here.
 */
export const progressSchema = z.record(z.string(), z.unknown());
export type ProgressData = z.infer<typeof progressSchema>;

export interface ProgressResponse {
  exists: boolean;
  data: ProgressData | null;
  updatedAt: string | null;
}
