/**
 * 에디터 번들(embed.js) 정적 제공 — R-1030 F-010.
 *
 * 호스트에 번들을 복사하지 않는다. 여기서 제공해야 서버 갱신만으로
 * 모든 호스트에 반영된다.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.ts';

interface Cached {
  body: Buffer;
  etag: string;
  mtimeMs: number;
}

export function registerStaticRoutes(app: FastifyInstance, cfg: Config): void {
  const bundlePath = resolve(cfg.embedBundlePath);
  let cached: Cached | undefined;

  function load(): Cached | undefined {
    let stat;
    try {
      stat = statSync(bundlePath);
    } catch {
      return undefined;
    }
    // 파일이 바뀌면 다시 읽는다 — 재기동 없이 배포가 반영되게.
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached;

    const body = readFileSync(bundlePath);
    cached = {
      body,
      etag: `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`,
      mtimeMs: stat.mtimeMs,
    };
    return cached;
  }

  app.get('/embed.js', async (req, reply) => {
    const file = load();

    if (!file) {
      // 에디터를 아직 빌드하지 않았어도 API 자체는 떠야 한다.
      req.log.warn(
        { bundlePath },
        'embed.js 를 찾을 수 없습니다. moai-note-editor-web 을 빌드했는지 확인하십시오.',
      );
      return reply
        .code(404)
        .type('application/json; charset=utf-8')
        .send({
          error: {
            code: 'NOT_FOUND',
            message: '에디터 번들이 준비되지 않았습니다.',
          },
        });
    }

    if (req.headers['if-none-match'] === file.etag) {
      return reply.code(304).send();
    }

    return reply
      .type('application/javascript; charset=utf-8')
      .header('ETag', file.etag)
      // 갱신이 5분 안에 반영되면서도 매 요청 재다운로드하지 않는다.
      .header('Cache-Control', 'public, max-age=300, must-revalidate')
      .send(file.body);
  });
}
