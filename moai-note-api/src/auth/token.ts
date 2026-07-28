/**
 * 자체 토큰 발급·검증.
 *
 * 토큰에는 소유자를 판정할 최소 정보만 담는다.
 * 이 값들은 **서버가 발급 시점에 넣은 것**이며, 이후 요청에서 클라이언트가
 * 바꿀 수 없다. 소유권 판정을 클라이언트 입력이 아니라 토큰에서 얻는 이유다.
 */
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { Principal } from '../storage/types.ts';

const ALGORITHM = 'HS256';
const ISSUER = 'moai-note';
const AUDIENCE = 'moai-note-api';

export interface TokenClaims extends JWTPayload {
  /** client_id */
  cid: string;
  /** 호스트가 준 사용자 식별자 (subject) */
  sub: string;
  /** 표시용 이름 (선택) */
  nm?: string;
}

function secretKey(tokenSecret: string): Uint8Array {
  return new TextEncoder().encode(tokenSecret);
}

export async function issueToken(params: {
  tokenSecret: string;
  ttlSeconds: number;
  clientId: string;
  subject: string;
  subjectName?: string;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const now = Math.floor(Date.now() / 1000);

  const builder = new SignJWT({
    cid: params.clientId,
    ...(params.subjectName ? { nm: params.subjectName } : {}),
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(params.subject)
    .setIssuedAt(now)
    .setExpirationTime(now + params.ttlSeconds);

  const accessToken = await builder.sign(secretKey(params.tokenSecret));
  return { accessToken, expiresIn: params.ttlSeconds };
}

export class InvalidTokenError extends Error {
  constructor(message = '토큰이 유효하지 않습니다.') {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

/**
 * 토큰 검증 — 서명·발급자·대상·만료를 모두 확인한다.
 * 하나라도 어긋나면 InvalidTokenError.
 */
export async function verifyToken(
  token: string,
  tokenSecret: string,
): Promise<Principal> {
  let payload: TokenClaims;
  try {
    const result = await jwtVerify(token, secretKey(tokenSecret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALGORITHM],
    });
    payload = result.payload as TokenClaims;
  } catch {
    // 실패 원인(만료/위조/형식)을 호출측에 흘리지 않는다.
    throw new InvalidTokenError();
  }

  if (typeof payload.cid !== 'string' || typeof payload.sub !== 'string') {
    throw new InvalidTokenError();
  }

  return {
    clientId: payload.cid,
    subject: payload.sub,
    ...(typeof payload.nm === 'string' ? { subjectName: payload.nm } : {}),
  };
}
