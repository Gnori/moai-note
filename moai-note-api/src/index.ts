/**
 * moai-note-api 진입점.
 */
import { loadConfig } from './config.ts';
import { buildServer } from './http/server.ts';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { app, db } = await buildServer(cfg);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, '종료 신호를 받았습니다.');
    try {
      await app.close();
      db.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: cfg.port, host: cfg.host });

  const scheme = cfg.tls ? 'https' : 'http';
  app.log.info(
    {
      url: `${scheme}://${cfg.host}:${cfg.port}`,
      tls: Boolean(cfg.tls),
      corsOrigins: cfg.corsOrigins,
      db: cfg.dbPath,
    },
    'moai-note-api 기동 완료',
  );
}

main().catch((err: unknown) => {
  // 설정 오류는 스택보다 메시지가 중요하다.
  console.error(`기동 실패: ${(err as Error).message}`);
  process.exit(1);
});
