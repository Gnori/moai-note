import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase, type Db } from '../src/storage/db.ts';
import { DocumentStore } from '../src/storage/documentStore.ts';
import { ClientStore, hashSecret, verifySecret } from '../src/storage/clientStore.ts';
import type { Principal } from '../src/storage/types.ts';

let db: Db;
let docs: DocumentStore;
let clients: ClientStore;

const alice: Principal = { clientId: 'cli_a', subject: 'ws1:alice', subjectName: '앨리스' };
const bob: Principal = { clientId: 'cli_a', subject: 'ws1:bob', subjectName: '밥' };
/** 같은 subject 라도 client 가 다르면 남이다 */
const aliceOtherClient: Principal = { clientId: 'cli_b', subject: 'ws1:alice' };

beforeEach(() => {
  db = openDatabase(':memory:');
  // 외래키 제약 때문에 client 행이 먼저 있어야 한다
  for (const id of ['cli_a', 'cli_b']) {
    db.prepare(
      `INSERT INTO client (client_id, secret_hash, name, revoked, created_at)
       VALUES (?, 'x:y', ?, 0, '2026-07-28T00:00:00Z')`,
    ).run(id, id);
  }
  docs = new DocumentStore(db, { maxRevisionsPerDocument: 3 });
  clients = new ClientStore(db);
});

describe('DocumentStore — 기본 동작', () => {
  it('생성하면 revision 1로 시작한다', () => {
    const doc = docs.create(alice, { title: '제목', content: '# 본문' });
    expect(doc.revision).toBe(1);
    expect(doc.title).toBe('제목');
    expect(doc.updatedBy).toBe('앨리스');
  });

  it('소유자가 조회할 수 있다', () => {
    const created = docs.create(alice, { title: 'T', content: 'C' });
    expect(docs.get(alice, created.id)?.content).toBe('C');
  });

  it('목록은 본문을 싣지 않는다', () => {
    docs.create(alice, { title: 'T', content: '아주 긴 본문'.repeat(100) });
    const list = docs.list(alice, { limit: 10, offset: 0 });
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('content');
  });

  it('삭제하면 조회되지 않는다', () => {
    const doc = docs.create(alice, { title: 'T', content: 'C' });
    expect(docs.delete(alice, doc.id)).toBe(true);
    expect(docs.get(alice, doc.id)).toBeUndefined();
  });
});

describe('DocumentStore — 소유권 격리 (인가)', () => {
  it('다른 사용자의 문서는 조회되지 않는다', () => {
    const doc = docs.create(alice, { title: 'T', content: 'C' });
    expect(docs.get(bob, doc.id)).toBeUndefined();
  });

  it('client가 다르면 subject가 같아도 남이다', () => {
    const doc = docs.create(alice, { title: 'T', content: 'C' });
    expect(docs.get(aliceOtherClient, doc.id)).toBeUndefined();
  });

  it('다른 사용자는 수정할 수 없다', () => {
    const doc = docs.create(alice, { title: 'T', content: 'C' });
    const res = docs.update(bob, doc.id, { title: 'X', content: 'X', baseRevision: 1 });
    expect(res.kind).toBe('not_found');
    // 원본이 그대로인지 확인
    expect(docs.get(alice, doc.id)?.content).toBe('C');
  });

  it('다른 사용자는 삭제할 수 없다', () => {
    const doc = docs.create(alice, { title: 'T', content: 'C' });
    expect(docs.delete(bob, doc.id)).toBe(false);
    expect(docs.get(alice, doc.id)).toBeDefined();
  });

  it('다른 사용자는 리비전을 볼 수 없다', () => {
    const doc = docs.create(alice, { title: 'T', content: 'C' });
    docs.update(alice, doc.id, { title: 'T2', content: 'C2', baseRevision: 1 });
    expect(docs.listRevisions(bob, doc.id)).toBeUndefined();
    expect(docs.getRevision(bob, doc.id, 1)).toBeUndefined();
  });

  it('다른 사용자의 목록에 섞이지 않는다', () => {
    docs.create(alice, { title: 'A', content: 'A' });
    docs.create(bob, { title: 'B', content: 'B' });
    expect(docs.list(alice, { limit: 10, offset: 0 })).toHaveLength(1);
    expect(docs.list(alice, { limit: 10, offset: 0 })[0]?.title).toBe('A');
  });
});

describe('DocumentStore — 리비전', () => {
  it('수정하면 직전 내용이 리비전으로 보존된다', () => {
    const doc = docs.create(alice, { title: 'v1', content: 'c1' });
    docs.update(alice, doc.id, { title: 'v2', content: 'c2', baseRevision: 1 });

    const revs = docs.listRevisions(alice, doc.id);
    expect(revs).toHaveLength(1);
    expect(revs?.[0]?.revision).toBe(1);
    expect(docs.getRevision(alice, doc.id, 1)?.content).toBe('c1');
    expect(docs.get(alice, doc.id)?.content).toBe('c2');
    expect(docs.get(alice, doc.id)?.revision).toBe(2);
  });

  it('baseRevision이 다르면 충돌로 거부한다', () => {
    const doc = docs.create(alice, { title: 'v1', content: 'c1' });
    docs.update(alice, doc.id, { title: 'v2', content: 'c2', baseRevision: 1 });

    const res = docs.update(alice, doc.id, { title: 'v3', content: 'c3', baseRevision: 1 });
    expect(res).toEqual({ kind: 'conflict', currentRevision: 2 });
    // 충돌 시 본문이 바뀌지 않아야 한다
    expect(docs.get(alice, doc.id)?.content).toBe('c2');
  });

  it('보관 상한을 넘으면 오래된 리비전부터 지운다', () => {
    const doc = docs.create(alice, { title: 't', content: 'c1' });
    for (let i = 2; i <= 8; i += 1) {
      docs.update(alice, doc.id, { title: 't', content: `c${i}`, baseRevision: i - 1 });
    }
    const revs = docs.listRevisions(alice, doc.id)!;
    expect(revs).toHaveLength(3); // maxRevisionsPerDocument = 3
    expect(revs.map((r) => r.revision)).toEqual([7, 6, 5]);
  });

  it('되돌리면 새 리비전이 생기고 이력은 남는다', () => {
    const doc = docs.create(alice, { title: 't', content: 'c1' });
    docs.update(alice, doc.id, { title: 't', content: 'c2', baseRevision: 1 });
    docs.update(alice, doc.id, { title: 't', content: 'c3', baseRevision: 2 });

    const res = docs.restore(alice, doc.id, 1);
    expect(res.kind).toBe('ok');

    const after = docs.get(alice, doc.id)!;
    expect(after.content).toBe('c1');
    expect(after.revision).toBe(4); // 되돌린 것도 하나의 변경
  });

  it('문서를 지우면 리비전도 함께 사라진다 (외래키 CASCADE)', () => {
    const doc = docs.create(alice, { title: 't', content: 'c1' });
    docs.update(alice, doc.id, { title: 't', content: 'c2', baseRevision: 1 });

    docs.delete(alice, doc.id);
    const left = db
      .prepare('SELECT COUNT(*) AS n FROM document_revision WHERE document_id = ?')
      .get(doc.id) as { n: number };
    expect(left.n).toBe(0);
  });
});

describe('ClientStore', () => {
  it('시크릿을 평문으로 저장하지 않는다', () => {
    const { clientId, clientSecret } = clients.create('테스트 호스트');
    const raw = db
      .prepare('SELECT secret_hash FROM client WHERE client_id = ?')
      .get(clientId) as { secret_hash: string };
    expect(raw.secret_hash).not.toContain(clientSecret);
  });

  it('올바른 시크릿만 통과한다', () => {
    const { clientId, clientSecret } = clients.create('테스트');
    expect(clients.verify(clientId, clientSecret)).toBeDefined();
    expect(clients.verify(clientId, 'wrong')).toBeUndefined();
  });

  it('폐기된 클라이언트는 통과하지 못한다', () => {
    const { clientId, clientSecret } = clients.create('테스트');
    clients.revoke(clientId);
    expect(clients.verify(clientId, clientSecret)).toBeUndefined();
    expect(clients.isActive(clientId)).toBe(false);
  });

  it('없는 client_id 는 undefined', () => {
    expect(clients.verify('cli_nope', 'x')).toBeUndefined();
  });

  it('해시는 매번 다르고(솔트) 검증은 통과한다', () => {
    const a = hashSecret('same-secret');
    const b = hashSecret('same-secret');
    expect(a).not.toBe(b);
    expect(verifySecret('same-secret', a)).toBe(true);
    expect(verifySecret('same-secret', b)).toBe(true);
    expect(verifySecret('other', a)).toBe(false);
  });
});
