import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { ZodType } from 'zod';
import { ApiError } from './api-error';

/**
 * Validates a request body against a zod schema and returns the parsed value,
 * so controllers receive data that is already narrowed to the right type.
 */
@Injectable()
export class ZodValidationPipe<TOut> implements PipeTransform<unknown, TOut> {
  constructor(private readonly schema: ZodType<TOut>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): TOut {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const details = result.error.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; ');
      throw ApiError.invalidRequest(details);
    }
    return result.data;
  }
}
