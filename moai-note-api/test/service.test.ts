import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase, type Db } from '../src/storage/db.ts';
import { DocumentStore } from '../src/storage/documentStore.ts';
import { DocumentService } from '../src/service/documentService.ts';
import { ServiceError } from '../src/service/errors.ts';
import type { Principal } from '../src/storage/types.ts';

let db: Db;
let service: DocumentService;

const alice: Principal = { clientId: 'cli_a', subject: 'ws1:alice', subjectName: '앨리스' };
const bob: Principal = { clientId: 'cli_a', subject: 'ws1:bob' };

beforeEach(() => {
  db = openDatabase(':memory:');
  db.prepare(
    `INSERT INTO client (client_id, secret_hash, name, revoked, created_at)
     VALUES ('cli_a', 'x:y', 'test', 0, '2026-07-28T00:00:00Z')`,
  ).run();
  const store = new DocumentStore(db, { maxRevisionsPerDocument: 50 });
  service = new DocumentService(store, {
    maxContentBytes: 1000,
    maxTitleLength: 20,
    defaultListLimit: 20,
    maxListLimit: 100,
  });
});

function expectError(fn: () => unknown, code: string, status: number) {
  try {
    fn();
    throw new Error('오류가 발생하지 않았습니다.');
  } catch (e) {
    expect(e).toBeInstanceOf(ServiceError);
    expect((e as ServiceError).code).toBe(code);
    expect((e as ServiceError).status).toBe(status);
    return e as ServiceError;
  }
}

describe('DocumentService — 정상 흐름', () => {
  it('생성 → 조회 → 수정 → 삭제', () => {
    const created = service.create(alice, { title: 'T', content: 'C' });
    expect(service.get(alice, created.id).content).toBe('C');

    const updated = service.update(alice, created.id, {
      title: 'T2',
      content: 'C2',
      baseRevision: 1,
    });
    expect(updated.revision).toBe(2);

    service.delete(alice, created.id);
    expectError(() => service.get(alice, created.id), 'NOT_FOUND', 404);
  });

  it('되돌리기가 동작한다', () => {
    const doc = service.create(alice, { title: 't', content: 'c1' });
    service.update(alice, doc.id, { title: 't', content: 'c2', baseRevision: 1 });
    const restored = service.restore(alice, doc.id, 1);
    expect(restored.content).toBe('c1');
  });

  it('목록 limit 은 상한으로 잘린다', () => {
    for (let i = 0; i < 5; i += 1) service.create(alice, { title: `t${i}`, content: 'c' });
    expect(service.list(alice, { limit: 999 })).toHaveLength(5);
    expect(service.list(alice, { limit: 2 })).toHaveLength(2);
  });
});

describe('DocumentService — 인가', () => {
  it('남의 문서는 404 (403이 아니다 — 존재 여부를 숨긴다)', () => {
    const doc = service.create(alice, { title: 'T', content: 'C' });
    expectError(() => service.get(bob, doc.id), 'NOT_FOUND', 404);
    expectError(
      () => service.update(bob, doc.id, { title: 'X', content: 'X', baseRevision: 1 }),
      'NOT_FOUND',
      404,
    );
    expectError(() => service.delete(bob, doc.id), 'NOT_FOUND', 404);
    expectError(() => service.listRevisions(bob, doc.id), 'NOT_FOUND', 404);
  });
});

describe('DocumentService — 검증', () => {
  it('제목이 비면 거부한다', () => {
    expectError(() => service.create(alice, { title: '  ', content: 'c' }), 'INVALID_REQUEST', 400);
  });

  it('제목 길이 상한을 넘으면 거부한다', () => {
    expectError(
      () => service.create(alice, { title: 'a'.repeat(21), content: 'c' }),
      'INVALID_REQUEST',
      400,
    );
  });

  it('본문 크기는 바이트로 잰다 — 한글도 상한에 걸린다', () => {
    // 한글 1자 = 3바이트. 400자 = 1200바이트 > 1000
    expectError(
      () => service.create(alice, { title: 't', content: '가'.repeat(400) }),
      'CONTENT_TOO_LARGE',
      400,
    );
    // 300자 = 900바이트 → 통과
    expect(service.create(alice, { title: 't', content: '가'.repeat(300) })).toBeDefined();
  });

  it('baseRevision 이 잘못되면 거부한다', () => {
    const doc = service.create(alice, { title: 't', content: 'c' });
    expectError(
      () => service.update(alice, doc.id, { title: 't', content: 'c', baseRevision: 0 }),
      'INVALID_REQUEST',
      400,
    );
  });
});

describe('DocumentService — 충돌', () => {
  it('오래된 baseRevision 으로 저장하면 409와 현재 리비전을 준다', () => {
    const doc = service.create(alice, { title: 't', content: 'c1' });
    service.update(alice, doc.id, { title: 't', content: 'c2', baseRevision: 1 });

    const err = expectError(
      () => service.update(alice, doc.id, { title: 't', content: 'c3', baseRevision: 1 }),
      'REVISION_CONFLICT',
      409,
    );
    expect(err.toResponse().error).toMatchObject({
      code: 'REVISION_CONFLICT',
      currentRevision: 2,
    });
    // 충돌 시 내용이 바뀌지 않아야 한다
    expect(service.get(alice, doc.id).content).toBe('c2');
  });
});
