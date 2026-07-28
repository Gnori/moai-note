/**
 * 환경변수를 한곳에서 읽는다.
 *
 * 원칙: 비밀값에는 기본값을 주지 않는다.
 * 기본값을 주면 개발용 키가 그대로 운영에 나갈 수 있다 — 없으면 기동을 실패시킨다.
 */

export interface TlsConfig {
  certPath: string;
  keyPath: string;
}

export interface Config {
  port: number;
  host: string;
  dbPath: string;
  tokenSecret: string;
  tokenTtlSeconds: number;
  corsOrigins: string[];
  tls?: TlsConfig;
  maxContentBytes: number;
  maxTitleLength: number;
  maxRevisionsPerDocument: number;
  embedBundlePath: string;
  rateLimitMax: number;
  rateLimitWindow: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `환경변수 ${name} 가 필요합니다. .env.example 을 참고해 설정하십시오.`,
    );
  }
  return value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`환경변수 ${name} 는 숫자여야 합니다: ${raw}`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const certPath = env.MOAI_NOTE_TLS_CERT;
  const keyPath = env.MOAI_NOTE_TLS_KEY;

  // 인증서는 둘 다 있어야 의미가 있다. 하나만 준 것은 설정 실수다.
  if ((certPath && !keyPath) || (!certPath && keyPath)) {
    throw new Error(
      'MOAI_NOTE_TLS_CERT 와 MOAI_NOTE_TLS_KEY 는 함께 설정해야 합니다.',
    );
  }

  const tokenSecret = env.MOAI_NOTE_TOKEN_SECRET;
  if (!tokenSecret) {
    throw new Error(
      '환경변수 MOAI_NOTE_TOKEN_SECRET 가 필요합니다. .env.example 을 참고해 설정하십시오.',
    );
  }
  // HS256 서명키가 너무 짧으면 무차별 대입에 취약하다.
  if (tokenSecret.length < 32) {
    throw new Error('MOAI_NOTE_TOKEN_SECRET 는 32자 이상이어야 합니다.');
  }

  const corsOrigins = (env.MOAI_NOTE_CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // 와일드카드는 금지한다 — 임의 사이트에서 토큰만 있으면 호출할 수 있게 된다.
  if (corsOrigins.includes('*')) {
    throw new Error(
      'MOAI_NOTE_CORS_ORIGINS 에 와일드카드(*)는 사용할 수 없습니다. 오리진을 명시하십시오.',
    );
  }

  return {
    port: num('MOAI_NOTE_PORT', 7100),
    host: env.MOAI_NOTE_HOST ?? '0.0.0.0',
    dbPath: env.MOAI_NOTE_DB_PATH ?? './data/moai-note.db',
    tokenSecret,
    tokenTtlSeconds: num('MOAI_NOTE_TOKEN_TTL', 3600),
    corsOrigins,
    ...(certPath && keyPath ? { tls: { certPath, keyPath } } : {}),
    maxContentBytes: num('MOAI_NOTE_MAX_CONTENT_BYTES', 1_000_000),
    maxTitleLength: num('MOAI_NOTE_MAX_TITLE_LENGTH', 300),
    maxRevisionsPerDocument: num('MOAI_NOTE_MAX_REVISIONS', 50),
    embedBundlePath:
      env.MOAI_NOTE_EMBED_BUNDLE ?? '../moai-note-editor-web/dist/embed.js',
    rateLimitMax: num('MOAI_NOTE_RATE_LIMIT_MAX', 300),
    rateLimitWindow: env.MOAI_NOTE_RATE_LIMIT_WINDOW ?? '1 minute',
  };
}
