/**
 * 토큰 발급 라우트.
 *
 * 이 경로는 인증 관문의 예외다(토큰을 받으러 오는 곳이라 토큰이 있을 수 없다).
 * 대신 client_secret 으로 검증한다.
 *
 * ⚠️ 브라우저에서 호출하는 경로가 아니다. 호스트 백엔드가 서버 간으로만 호출한다.
 */
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.ts';
import type { ClientStore } from '../storage/clientStore.ts';
import { issueToken } from '../auth/token.ts';
import { tokenSchema } from './schemas.ts';

interface TokenBody {
  client_id: string;
  client_secret: string;
  subject: string;
  subject_name?: string;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  cfg: Config,
  clients: ClientStore,
): void {
  app.post('/api/v1/auth/token', { schema: tokenSchema }, async (req, reply) => {
    const body = req.body as TokenBody;

    const client = clients.verify(body.client_id, body.client_secret);
    if (!client) {
      // 원인(없는 id / 틀린 시크릿 / 폐기됨)을 구분해 알려주지 않는다.
      // 시크릿은 로그에도 남기지 않는다.
      req.log.warn({ clientId: body.client_id }, '토큰 발급 실패: 자격증명 불일치');
      return reply.code(401).send({
        error: { code: 'INVALID_CLIENT', message: '클라이언트 자격증명이 올바르지 않습니다.' },
      });
    }

    const issued = await issueToken({
      tokenSecret: cfg.tokenSecret,
      ttlSeconds: cfg.tokenTtlSeconds,
      clientId: client.clientId,
      subject: body.subject,
      ...(body.subject_name ? { subjectName: body.subject_name } : {}),
    });

    return {
      access_token: issued.accessToken,
      token_type: 'Bearer',
      expires_in: issued.expiresIn,
    };
  });
}
