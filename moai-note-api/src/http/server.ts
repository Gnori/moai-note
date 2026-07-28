/**
 * HTTP 서버 조립 — TLS · CORS · 빈도 제한 · 인증 관문 · 라우트.
 *
 * 등록 순서가 중요하다: 인증 관문이 라우트보다 먼저 등록돼야 모든 경로를 덮는다.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { readFileSync } from 'node:fs';
import type { Config } from '../config.ts';
import { openDatabase, type Db } from '../storage/db.ts';
import { DocumentStore } from '../storage/documentStore.ts';
import { ClientStore } from '../storage/clientStore.ts';
import { DocumentService } from '../service/documentService.ts';
import { ServiceError } from '../service/errors.ts';
import { registerAuthGuard } from '../auth/guard.ts';
import { registerAuthRoutes } from '../rest/authRoutes.ts';
import { registerDocumentRoutes } from '../rest/documentRoutes.ts';
import { registerStaticRoutes } from './staticRoutes.ts';
import { registerMcpRoute } from '../mcp/server.ts';

export interface BuiltServer {
  app: FastifyInstance;
  db: Db;
  service: DocumentService;
  clients: ClientStore;
}

export async function buildServer(cfg: Config): Promise<BuiltServer> {
  const db = openDatabase(cfg.dbPath);
  const clients = new ClientStore(db);
  const store = new DocumentStore(db, {
    maxRevisionsPerDocument: cfg.maxRevisionsPerDocument,
  });
  const service = new DocumentService(store, {
    maxContentBytes: cfg.maxContentBytes,
    maxTitleLength: cfg.maxTitleLength,
    defaultListLimit: 20,
    maxListLimit: 100,
  });

  const app = Fastify({
    // 리버스 프록시가 TLS를 종단하는 구성에서 X-Forwarded-Proto 를 인식한다.
    trustProxy: true,
    // 본문 상한 — service 검증에 도달하기 전에 과도한 페이로드를 끊는다.
    bodyLimit: cfg.maxContentBytes + 64 * 1024,
    logger: {
      level: process.env.MOAI_NOTE_LOG_LEVEL ?? 'info',
      // 토큰·시크릿이 로그에 남지 않도록 가린다.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.body.client_secret',
          'req.body.client_id',
        ],
        censor: '***',
      },
    },
    ...(cfg.tls
      ? {
          https: {
            cert: readFileSync(cfg.tls.certPath),
            key: readFileSync(cfg.tls.keyPath),
          },
        }
      : {}),
  });

  // ── CORS ──────────────────────────────────────────────────
  // 화이트리스트가 비면 크로스 오리진을 전부 거부한다.
  // 와일드카드로 폴백하지 않는다 — 토큰만 있으면 아무 사이트에서나 호출된다.
  if (cfg.corsOrigins.length === 0) {
    app.log.warn(
      'MOAI_NOTE_CORS_ORIGINS 가 비어 있습니다. 크로스 오리진 요청을 모두 거부합니다.',
    );
  }
  await app.register(cors, {
    origin: cfg.corsOrigins.length > 0 ? cfg.corsOrigins : false,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await app.register(rateLimit, {
    max: cfg.rateLimitMax,
    timeWindow: cfg.rateLimitWindow,
    errorResponseBuilder: () => ({
      error: { code: 'RATE_LIMITED', message: '요청이 너무 많습니다.' },
    }),
  });

  // ── 오류 처리 ─────────────────────────────────────────────
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ServiceError) {
      return reply.code(err.status).send(err.toResponse());
    }
    // Fastify 스키마 검증 실패 — 어느 필드가 틀렸는지는 알려준다(비밀값이 아니다).
    if ((err as { validation?: unknown }).validation) {
      const message = err instanceof Error ? err.message : '요청 형식이 올바르지 않습니다.';
      return reply.code(400).send({
        error: { code: 'INVALID_REQUEST', message },
      });
    }
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: '요청이 너무 많습니다.' },
      });
    }
    // 그 밖의 오류는 원인을 응답에 노출하지 않는다.
    req.log.error({ err }, '처리되지 않은 오류');
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: '서버 오류가 발생했습니다.' },
    });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: '경로를 찾을 수 없습니다.' } }),
  );

  // ── 인증 관문 — 라우트보다 먼저 ────────────────────────────
  registerAuthGuard(app, cfg, clients);

  // ── 라우트 ────────────────────────────────────────────────
  app.get('/health', async () => ({ status: 'ok' }));
  registerAuthRoutes(app, cfg, clients);
  registerDocumentRoutes(app, service);
  registerStaticRoutes(app, cfg);
  await registerMcpRoute(app, service);

  return { app, db, service, clients };
}
