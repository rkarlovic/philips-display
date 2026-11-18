import type { ApiError, ErrorCode } from '@slidecast/shared';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message?: string,
    /** Extra fields for the JSON error body (e.g. `usedIn`). */
    readonly extra: Partial<ApiError> = {},
  ) {
    super(message ?? code);
  }
}

export const notFound = () => new HttpError(404, 'not_found', 'Not found');
export const unauthorized = () => new HttpError(401, 'unauthorized', 'Login required');
export const forbidden = () => new HttpError(403, 'forbidden', 'Not allowed');
