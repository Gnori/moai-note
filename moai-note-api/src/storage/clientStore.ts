/**
 * 클라이언트(호스트) 등록 저장소.
 *
 * client_secret 은 평문으로 저장하지 않는다. scrypt 해시만 보관한다.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.ts';

export interface ClientRow {
  clientId: string;
  name: string;
  revoked: boolean;
  createdAt: string;
}

interface RawClient {
  client_id: string;
  secret_hash: string;
  name: string;
  revoked: number;
  created_at: string;
}

const KEY_LENGTH = 64;

export function hashSecret(secret: string, salt = randomBytes(16).toString('hex')): string {
  const derived = scryptSync(secret, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${derived}`;
}

/**
 * 시크릿 검증 — 타이밍 공격을 피해 상수 시간으로 비교한다.
 * 일반 문자열 비교(===)는 앞부분이 얼마나 맞았는지 시간으로 새어 나간다.
 */
export function verifySecret(secret: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;

  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(secret, salt, KEY_LENGTH);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export class ClientStore {
  private readonly db: Db;
  private readonly now: () => string;

  constructor(db: Db, now: () => string = () => new Date().toISOString()) {
    this.db = db;
    this.now = now;
  }

  /** 등록 — 생성된 시크릿은 이 시점에만 알 수 있다(해시만 저장). */
  create(name: string): { clientId: string; clientSecret: string } {
    const clientId = `cli_${randomBytes(9).toString('base64url')}`;
    const clientSecret = randomBytes(32).toString('base64url');

    this.db
      .prepare(
        `INSERT INTO client (client_id, secret_hash, name, revoked, created_at)
         VALUES (?, ?, ?, 0, ?)`,
      )
      .run(clientId, hashSecret(clientSecret), name, this.now());

    return { clientId, clientSecret };
  }

  /** 자격증명 검증. 폐기된 클라이언트는 통과시키지 않는다. */
  verify(clientId: string, clientSecret: string): ClientRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM client WHERE client_id = ?`)
      .get(clientId) as RawClient | undefined;

    if (!row) {
      // 존재하지 않는 client_id 여도 해시 계산을 수행해 응답 시간을 맞춘다.
      verifySecret(clientSecret, hashSecret('dummy'));
      return undefined;
    }
    if (row.revoked !== 0) return undefined;
    if (!verifySecret(clientSecret, row.secret_hash)) return undefined;

    return {
      clientId: row.client_id,
      name: row.name,
      revoked: false,
      createdAt: row.created_at,
    };
  }

  /** 토큰 검증 시 폐기 여부만 확인한다 (시크릿 없이) */
  isActive(clientId: string): boolean {
    const row = this.db
      .prepare(`SELECT revoked FROM client WHERE client_id = ?`)
      .get(clientId) as { revoked: number } | undefined;
    return row !== undefined && row.revoked === 0;
  }

  list(): ClientRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM client ORDER BY created_at DESC`)
      .all() as RawClient[];
    return rows.map((r) => ({
      clientId: r.client_id,
      name: r.name,
      revoked: r.revoked !== 0,
      createdAt: r.created_at,
    }));
  }

  revoke(clientId: string): boolean {
    const result = this.db
      .prepare(`UPDATE client SET revoked = 1 WHERE client_id = ?`)
      .run(clientId);
    return result.changes > 0;
  }
}
