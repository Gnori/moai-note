/**
 * 인증 관문 — REST와 MCP가 함께 지나는 단 하나의 지점.
 *
 * ⚠️ 표면별로 인증을 따로 구현하지 말 것.
 *    한쪽만 손대면 다른 쪽이 열린 채로 남는다. 그 사고가 실제로 있었다.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.ts';
import type { ClientStore } from '../storage/clientStore.ts';
import type { Principal } from '../storage/types.ts';
import { verifyToken } from './token.ts';

/**
 * 인증을 요구하지 않는 경로 — 이 목록이 전부다.
 *
 *  /api/v1/auth/token : 토큰을 받으러 오는 곳이라 토큰이 있을 수 없다.
 *                       대신 client_secret 으로 검증한다.
 *  /embed.js          : 공개 정적 자산. 파일 자체에는 데이터가 없다.
 *  /health            : 기동 확인용. 상태값만 반환한다.
 *
 * 라우트 파일에서 개별적으로 인증을 우회하지 말 것. 예외는 여기서만 늘린다.
 */
export const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  '/api/v1/auth/token',
  '/embed.js',
  '/health',
]);

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

function unauthenticated(reply: FastifyReply): FastifyReply {
  return reply
    .code(401)
    .header('WWW-Authenticate', 'Bearer')
    .send({
      error: { code: 'UNAUTHENTICATED', message: '인증이 필요합니다.' },
    });
}

function pathOf(req: FastifyRequest): string {
  const raw = req.url ?? '';
  const q = raw.indexOf('?');
  return q >= 0 ? raw.slice(0, q) : raw;
}

export function registerAuthGuard(
  app: FastifyInstance,
  cfg: Config,
  clients: ClientStore,
): void {
  app.addHook('onRequest', async (req, reply) => {
    if (PUBLIC_PATHS.has(pathOf(req))) return;

    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      req.log.warn({ path: pathOf(req) }, '인증 실패: 토큰 없음');
      return unauthenticated(reply);
    }

    let principal: Principal;
    try {
      // 토큰 원문은 로그에 남기지 않는다.
      principal = await verifyToken(header.slice('Bearer '.length), cfg.tokenSecret);
    } catch {
      req.log.warn({ path: pathOf(req) }, '인증 실패: 토큰 검증 불가');
      return unauthenticated(reply);
    }

    // 발급 이후 폐기된 클라이언트의 토큰은 만료 전이라도 거부한다.
    if (!clients.isActive(principal.clientId)) {
      req.log.warn({ clientId: principal.clientId }, '인증 실패: 폐기된 클라이언트');
      return unauthenticated(reply);
    }

    req.principal = principal;
  });
}

/** 라우트 핸들러에서 주체를 꺼낸다. 관문을 지났다면 반드시 존재한다. */
export function requirePrincipal(req: FastifyRequest): Principal {
  if (!req.principal) {
    // 여기 도달하면 관문 등록이 누락된 것이다 — 조용히 통과시키지 않는다.
    throw new Error('인증 관문을 거치지 않은 요청입니다. registerAuthGuard 등록을 확인하십시오.');
  }
  return req.principal;
}
