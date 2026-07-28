/**
 * 서비스 오류 — I §1.3 의 오류 계약을 타입으로 고정한다.
 *
 * REST와 MCP가 같은 오류를 각자 방식으로 표현하되, 판정은 여기서 한 번만 한다.
 */

export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'CONTENT_TOO_LARGE'
  | 'UNAUTHENTICATED'
  | 'INVALID_CLIENT'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

const HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  CONTENT_TOO_LARGE: 400,
  UNAUTHENTICATED: 401,
  INVALID_CLIENT: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export class ServiceError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.status = HTTP_STATUS[code];
    this.details = details;
  }

  toResponse(): { error: { code: ErrorCode; message: string } & Record<string, unknown> } {
    return { error: { code: this.code, message: this.message, ...(this.details ?? {}) } };
  }
}

export const notFound = (): ServiceError =>
  // 남의 문서도 여기로 온다 — 존재 여부를 노출하지 않기 위해서다.
  new ServiceError('NOT_FOUND', '문서를 찾을 수 없습니다.');

export const conflict = (currentRevision: number): ServiceError =>
  new ServiceError('REVISION_CONFLICT', '문서가 이미 변경되었습니다.', { currentRevision });

export const invalidRequest = (message: string): ServiceError =>
  new ServiceError('INVALID_REQUEST', message);

export const contentTooLarge = (limitBytes: number): ServiceError =>
  new ServiceError('CONTENT_TOO_LARGE', `본문이 너무 큽니다. 최대 ${limitBytes} 바이트.`, {
    limitBytes,
  });
