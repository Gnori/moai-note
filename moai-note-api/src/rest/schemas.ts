/**
 * 요청·응답 스키마 (I §1.2).
 *
 * Fastify의 JSON Schema 검증으로 계약을 코드에 강제한다.
 * 라우트 핸들러가 형식 검사를 다시 하지 않도록 여기서 끝낸다.
 */

export const errorResponse = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['code', 'message'],
      additionalProperties: true, // currentRevision 등 부가 정보
    },
  },
  required: ['error'],
} as const;

const documentResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    content: { type: 'string' },
    revision: { type: 'integer' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    updatedBy: { type: ['string', 'null'] },
  },
  required: ['id', 'title', 'content', 'revision', 'createdAt', 'updatedAt'],
} as const;

const documentSummary = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    revision: { type: 'integer' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    updatedBy: { type: ['string', 'null'] },
  },
  required: ['id', 'title', 'revision', 'createdAt', 'updatedAt'],
} as const;

const idParam = {
  type: 'object',
  properties: { id: { type: 'string', minLength: 1 } },
  required: ['id'],
} as const;

const idRevisionParam = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    revision: { type: 'integer', minimum: 1 },
  },
  required: ['id', 'revision'],
} as const;

export const tokenSchema = {
  body: {
    type: 'object',
    properties: {
      client_id: { type: 'string', minLength: 1 },
      client_secret: { type: 'string', minLength: 1 },
      subject: { type: 'string', minLength: 1, maxLength: 512 },
      subject_name: { type: 'string', maxLength: 200 },
    },
    required: ['client_id', 'client_secret', 'subject'],
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      properties: {
        access_token: { type: 'string' },
        token_type: { type: 'string' },
        expires_in: { type: 'integer' },
      },
      required: ['access_token', 'token_type', 'expires_in'],
    },
    401: errorResponse,
  },
} as const;

export const createDocumentSchema = {
  body: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1 },
      content: { type: 'string' },
    },
    required: ['title', 'content'],
    additionalProperties: false,
  },
  response: { 201: documentResponse, 400: errorResponse, 401: errorResponse },
} as const;

export const listDocumentsSchema = {
  querystring: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      offset: { type: 'integer', minimum: 0 },
    },
    additionalProperties: false,
  },
  response: {
    200: {
      type: 'object',
      properties: { items: { type: 'array', items: documentSummary } },
      required: ['items'],
    },
    401: errorResponse,
  },
} as const;

export const getDocumentSchema = {
  params: idParam,
  response: { 200: documentResponse, 401: errorResponse, 404: errorResponse },
} as const;

export const updateDocumentSchema = {
  params: idParam,
  body: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1 },
      content: { type: 'string' },
      // 충돌 감지의 핵심 — 선택 항목이 아니다.
      baseRevision: { type: 'integer', minimum: 1 },
    },
    required: ['title', 'content', 'baseRevision'],
    additionalProperties: false,
  },
  response: {
    200: documentResponse,
    400: errorResponse,
    401: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
} as const;

export const deleteDocumentSchema = {
  params: idParam,
  response: { 204: { type: 'null' }, 401: errorResponse, 404: errorResponse },
} as const;

export const listRevisionsSchema = {
  params: idParam,
  response: {
    200: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              revision: { type: 'integer' },
              updatedAt: { type: 'string' },
              updatedBy: { type: ['string', 'null'] },
            },
            required: ['revision', 'updatedAt'],
          },
        },
      },
      required: ['items'],
    },
    401: errorResponse,
    404: errorResponse,
  },
} as const;

export const getRevisionSchema = {
  params: idRevisionParam,
  response: {
    200: {
      type: 'object',
      properties: {
        revision: { type: 'integer' },
        title: { type: 'string' },
        content: { type: 'string' },
        updatedAt: { type: 'string' },
        updatedBy: { type: ['string', 'null'] },
      },
      required: ['revision', 'title', 'content', 'updatedAt'],
    },
    401: errorResponse,
    404: errorResponse,
  },
} as const;

export const restoreRevisionSchema = {
  params: idRevisionParam,
  response: {
    200: documentResponse,
    401: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
} as const;
