import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Error codes the frontend knows how to render (see `ERR_COPY` in index.html).
 * Keeping them in one union means a new code cannot be invented by accident.
 */
export type ApiErrorCode =
  | 'unauthorized'
  | 'session_expired'
  | 'rate_limited'
  | 'invalid_json'
  | 'invalid_request'
  | 'refused'
  | 'prompt_too_large'
  | 'upstream_error';

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
}

/** An HTTP error whose body is always `{ code, message }`. */
export class ApiError extends HttpException {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    status: HttpStatus,
  ) {
    super({ code, message } satisfies ApiErrorBody, status);
  }

  static unauthorized(message = 'Authentication required'): ApiError {
    return new ApiError('unauthorized', message, HttpStatus.UNAUTHORIZED);
  }

  static rateLimited(message: string): ApiError {
    return new ApiError('rate_limited', message, HttpStatus.TOO_MANY_REQUESTS);
  }

  static invalidJson(message = 'The model did not return valid JSON'): ApiError {
    return new ApiError('invalid_json', message, HttpStatus.UNPROCESSABLE_ENTITY);
  }

  static invalidRequest(message: string): ApiError {
    return new ApiError('invalid_request', message, HttpStatus.BAD_REQUEST);
  }

  static refused(message = 'The model declined to answer this request'): ApiError {
    return new ApiError('refused', message, HttpStatus.UNPROCESSABLE_ENTITY);
  }

  static promptTooLarge(message = 'The prompt is too long'): ApiError {
    return new ApiError('prompt_too_large', message, HttpStatus.PAYLOAD_TOO_LARGE);
  }

  static upstream(message = 'The AI service is unavailable right now'): ApiError {
    return new ApiError('upstream_error', message, HttpStatus.BAD_GATEWAY);
  }
}
