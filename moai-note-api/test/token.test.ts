import { describe, it, expect } from 'vitest';
import { issueToken, verifyToken, InvalidTokenError } from '../src/auth/token.ts';
import { SignJWT } from 'jose';

const SECRET = 'x'.repeat(48);
const OTHER_SECRET = 'y'.repeat(48);

async function issue(overrides: Partial<Parameters<typeof issueToken>[0]> = {}) {
  return issueToken({
    tokenSecret: SECRET,
    ttlSeconds: 3600,
    clientId: 'cli_a',
    subject: 'ws1:alice',
    subjectName: '앨리스',
    ...overrides,
  });
}

describe('토큰 발급·검증', () => {
  it('발급한 토큰은 검증을 통과하고 주체를 돌려준다', async () => {
    const { accessToken } = await issue();
    const principal = await verifyToken(accessToken, SECRET);
    expect(principal).toEqual({
      clientId: 'cli_a',
      subject: 'ws1:alice',
      subjectName: '앨리스',
    });
  });

  it('다른 키로 서명된 토큰은 거부한다', async () => {
    const { accessToken } = await issue({ tokenSecret: OTHER_SECRET });
    await expect(verifyToken(accessToken, SECRET)).rejects.toThrow(InvalidTokenError);
  });

  it('만료된 토큰은 거부한다', async () => {
    const { accessToken } = await issue({ ttlSeconds: -10 });
    await expect(verifyToken(accessToken, SECRET)).rejects.toThrow(InvalidTokenError);
  });

  it('형식이 깨진 토큰은 거부한다', async () => {
    await expect(verifyToken('not-a-jwt', SECRET)).rejects.toThrow(InvalidTokenError);
    await expect(verifyToken('', SECRET)).rejects.toThrow(InvalidTokenError);
  });

  it('발급자·대상이 다르면 거부한다', async () => {
    const forged = await new SignJWT({ cid: 'cli_a' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('someone-else')
      .setAudience('moai-note-api')
      .setSubject('ws1:alice')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    await expect(verifyToken(forged, SECRET)).rejects.toThrow(InvalidTokenError);
  });

  it('alg=none 위조 토큰은 거부한다', async () => {
    // 서명 없는 토큰을 손으로 만들어 본다
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ cid: 'cli_a', sub: 'ws1:alice', exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString('base64url');
    await expect(verifyToken(`${header}.${payload}.`, SECRET)).rejects.toThrow(InvalidTokenError);
  });

  it('필수 클레임이 없으면 거부한다', async () => {
    const noCid = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('moai-note')
      .setAudience('moai-note-api')
      .setSubject('ws1:alice')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    await expect(verifyToken(noCid, SECRET)).rejects.toThrow(InvalidTokenError);
  });

  it('subjectName 이 없어도 발급·검증된다', async () => {
    const { accessToken } = await issue({ subjectName: undefined });
    const principal = await verifyToken(accessToken, SECRET);
    expect(principal.subjectName).toBeUndefined();
    expect(principal.subject).toBe('ws1:alice');
  });
});
