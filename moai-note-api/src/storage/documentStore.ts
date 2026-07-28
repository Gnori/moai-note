/**
 * 문서·리비전 저장소.
 *
 * 규칙 — 이 파일의 모든 조회·수정 쿼리에는 client_id 와 subject 조건이 들어간다.
 * 소유자 조건이 없는 `WHERE id = ?` 를 만드는 순간 인가 우회 경로가 생긴다.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from './db.ts';
import type {
  DocumentRow,
  DocumentSummary,
  Principal,
  RevisionRow,
  RevisionSummary,
  UpdateResult,
} from './types.ts';

interface RawDocument {
  id: string;
  client_id: string;
  subject: string;
  title: string;
  content: string;
  revision: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

interface RawRevision {
  document_id: string;
  revision: number;
  title: string;
  content: string;
  updated_at: string;
  updated_by: string | null;
}

function toDocument(row: RawDocument): DocumentRow {
  return {
    id: row.id,
    clientId: row.client_id,
    subject: row.subject,
    title: row.title,
    content: row.content,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function toRevision(row: RawRevision): RevisionRow {
  return {
    documentId: row.document_id,
    revision: row.revision,
    title: row.title,
    content: row.content,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export interface DocumentStoreOptions {
  maxRevisionsPerDocument: number;
  /** 시각 주입 — 테스트에서 고정할 수 있게 한다 */
  now?: () => string;
}

export class DocumentStore {
  private readonly db: Db;
  private readonly maxRevisions: number;
  private readonly now: () => string;

  constructor(db: Db, options: DocumentStoreOptions) {
    this.db = db;
    this.maxRevisions = options.maxRevisionsPerDocument;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  create(principal: Principal, input: { title: string; content: string }): DocumentRow {
    const ts = this.now();
    const row: RawDocument = {
      id: randomUUID(),
      client_id: principal.clientId,
      subject: principal.subject,
      title: input.title,
      content: input.content,
      revision: 1,
      created_at: ts,
      updated_at: ts,
      updated_by: principal.subjectName ?? null,
    };

    this.db
      .prepare(
        `INSERT INTO document
           (id, client_id, subject, title, content, revision, created_at, updated_at, updated_by)
         VALUES (@id, @client_id, @subject, @title, @content, @revision, @created_at, @updated_at, @updated_by)`,
      )
      .run(row);

    return toDocument(row);
  }

  /** 소유자 기준 단건 조회. 남의 문서는 undefined — 존재 여부를 노출하지 않는다. */
  get(principal: Principal, id: string): DocumentRow | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM document
          WHERE id = ? AND client_id = ? AND subject = ?`,
      )
      .get(id, principal.clientId, principal.subject) as RawDocument | undefined;
    return row ? toDocument(row) : undefined;
  }

  list(principal: Principal, opts: { limit: number; offset: number }): DocumentSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, revision, created_at, updated_at, updated_by
           FROM document
          WHERE client_id = ? AND subject = ?
          ORDER BY updated_at DESC
          LIMIT ? OFFSET ?`,
      )
      .all(principal.clientId, principal.subject, opts.limit, opts.offset) as Array<
      Omit<RawDocument, 'client_id' | 'subject' | 'content'>
    >;

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      revision: r.revision,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      updatedBy: r.updated_by,
    }));
  }

  /**
   * 수정 — 직전 내용 보존과 본문 갱신을 한 트랜잭션으로 묶는다.
   * 둘이 갈라지면 이력이 유실되거나 중복된다.
   */
  update(
    principal: Principal,
    id: string,
    input: { title: string; content: string; baseRevision: number },
  ): UpdateResult {
    const tx = this.db.transaction((): UpdateResult => {
      const current = this.get(principal, id);
      if (!current) return { kind: 'not_found' };
      if (current.revision !== input.baseRevision) {
        return { kind: 'conflict', currentRevision: current.revision };
      }

      // 직전 내용을 리비전으로 보존
      this.db
        .prepare(
          `INSERT INTO document_revision
             (document_id, revision, title, content, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, current.revision, current.title, current.content, current.updatedAt, current.updatedBy);

      const nextRevision = current.revision + 1;
      const ts = this.now();
      this.db
        .prepare(
          `UPDATE document
              SET title = ?, content = ?, revision = ?, updated_at = ?, updated_by = ?
            WHERE id = ? AND client_id = ? AND subject = ?`,
        )
        .run(
          input.title,
          input.content,
          nextRevision,
          ts,
          principal.subjectName ?? null,
          id,
          principal.clientId,
          principal.subject,
        );

      this.pruneRevisions(id);

      return {
        kind: 'ok',
        document: {
          ...current,
          title: input.title,
          content: input.content,
          revision: nextRevision,
          updatedAt: ts,
          updatedBy: principal.subjectName ?? null,
        },
      };
    });

    return tx();
  }

  delete(principal: Principal, id: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM document WHERE id = ? AND client_id = ? AND subject = ?`)
      .run(id, principal.clientId, principal.subject);
    return result.changes > 0;
  }

  listRevisions(principal: Principal, id: string): RevisionSummary[] | undefined {
    // 소유권을 먼저 확인한다 — 리비전 테이블에는 소유자 정보가 없다.
    if (!this.get(principal, id)) return undefined;

    const rows = this.db
      .prepare(
        `SELECT revision, updated_at, updated_by
           FROM document_revision
          WHERE document_id = ?
          ORDER BY revision DESC`,
      )
      .all(id) as Array<Pick<RawRevision, 'revision' | 'updated_at' | 'updated_by'>>;

    return rows.map((r) => ({
      revision: r.revision,
      updatedAt: r.updated_at,
      updatedBy: r.updated_by,
    }));
  }

  getRevision(principal: Principal, id: string, revision: number): RevisionRow | undefined {
    if (!this.get(principal, id)) return undefined;

    const row = this.db
      .prepare(`SELECT * FROM document_revision WHERE document_id = ? AND revision = ?`)
      .get(id, revision) as RawRevision | undefined;
    return row ? toRevision(row) : undefined;
  }

  /**
   * 되돌리기 — 해당 리비전 내용으로 새 리비전을 만든다.
   * 이력을 지우지 않는다: 되돌린 것도 하나의 변경이다.
   */
  restore(principal: Principal, id: string, revision: number): UpdateResult {
    const tx = this.db.transaction((): UpdateResult => {
      const current = this.get(principal, id);
      if (!current) return { kind: 'not_found' };

      const target = this.db
        .prepare(`SELECT * FROM document_revision WHERE document_id = ? AND revision = ?`)
        .get(id, revision) as RawRevision | undefined;
      if (!target) return { kind: 'not_found' };

      return this.update(principal, id, {
        title: target.title,
        content: target.content,
        baseRevision: current.revision,
      });
    });

    return tx();
  }

  /** 보관 상한 초과분을 오래된 것부터 지운다 — 무한 증가 방지 */
  private pruneRevisions(documentId: string): void {
    this.db
      .prepare(
        `DELETE FROM document_revision
          WHERE document_id = ?
            AND revision NOT IN (
              SELECT revision FROM document_revision
               WHERE document_id = ?
               ORDER BY revision DESC
               LIMIT ?
            )`,
      )
      .run(documentId, documentId, this.maxRevisions);
  }
}
