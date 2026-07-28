/**
 * 문서·리비전 서비스 — 8개 기능의 **유일한 구현**.
 *
 * REST 컨트롤러와 MCP 도구는 이 계층을 호출하는 얇은 어댑터일 뿐이다.
 * 어느 한쪽에만 검증이나 분기를 넣지 말 것 — 두 표면의 동작이 갈라진다.
 *
 * 모든 함수의 첫 인자는 Principal 이다. 호출자가 소유자를 지정할 수 없도록
 * 시그니처로 막는다.
 */
import type { DocumentStore } from '../storage/documentStore.ts';
import type {
  DocumentRow,
  DocumentSummary,
  Principal,
  RevisionRow,
  RevisionSummary,
} from '../storage/types.ts';
import { conflict, contentTooLarge, invalidRequest, notFound } from './errors.ts';

export interface DocumentServiceOptions {
  maxContentBytes: number;
  maxTitleLength: number;
  defaultListLimit: number;
  maxListLimit: number;
}

export interface CreateInput {
  title: string;
  content: string;
}

export interface UpdateInput extends CreateInput {
  baseRevision: number;
}

export interface ListInput {
  limit?: number;
  offset?: number;
}

export class DocumentService {
  private readonly store: DocumentStore;
  private readonly opts: DocumentServiceOptions;

  constructor(store: DocumentStore, opts: DocumentServiceOptions) {
    this.store = store;
    this.opts = opts;
  }

  /**
   * 본문·제목 검증 — service 에서 한다.
   * 컨트롤러에 두면 MCP 경로에서 빠진다.
   */
  private validate(input: CreateInput): void {
    if (typeof input.title !== 'string' || input.title.trim() === '') {
      throw invalidRequest('제목은 비어 있을 수 없습니다.');
    }
    if (input.title.length > this.opts.maxTitleLength) {
      throw invalidRequest(`제목은 ${this.opts.maxTitleLength}자를 넘을 수 없습니다.`);
    }
    if (typeof input.content !== 'string') {
      throw invalidRequest('본문은 문자열이어야 합니다.');
    }
    // 문자 수가 아니라 바이트로 잰다 — 한글은 문자당 3바이트다.
    const bytes = Buffer.byteLength(input.content, 'utf8');
    if (bytes > this.opts.maxContentBytes) {
      throw contentTooLarge(this.opts.maxContentBytes);
    }
  }

  create(principal: Principal, input: CreateInput): DocumentRow {
    this.validate(input);
    return this.store.create(principal, { title: input.title, content: input.content });
  }

  list(principal: Principal, input: ListInput = {}): DocumentSummary[] {
    const limit = Math.min(
      Math.max(1, input.limit ?? this.opts.defaultListLimit),
      this.opts.maxListLimit,
    );
    const offset = Math.max(0, input.offset ?? 0);
    return this.store.list(principal, { limit, offset });
  }

  get(principal: Principal, id: string): DocumentRow {
    const doc = this.store.get(principal, id);
    if (!doc) throw notFound();
    return doc;
  }

  update(principal: Principal, id: string, input: UpdateInput): DocumentRow {
    this.validate(input);
    if (!Number.isInteger(input.baseRevision) || input.baseRevision < 1) {
      throw invalidRequest('baseRevision 은 1 이상의 정수여야 합니다.');
    }

    const result = this.store.update(principal, id, {
      title: input.title,
      content: input.content,
      baseRevision: input.baseRevision,
    });

    if (result.kind === 'not_found') throw notFound();
    if (result.kind === 'conflict') throw conflict(result.currentRevision);
    return result.document;
  }

  delete(principal: Principal, id: string): void {
    if (!this.store.delete(principal, id)) throw notFound();
  }

  listRevisions(principal: Principal, id: string): RevisionSummary[] {
    const revisions = this.store.listRevisions(principal, id);
    if (!revisions) throw notFound();
    return revisions;
  }

  getRevision(principal: Principal, id: string, revision: number): RevisionRow {
    if (!Number.isInteger(revision) || revision < 1) {
      throw invalidRequest('revision 은 1 이상의 정수여야 합니다.');
    }
    const row = this.store.getRevision(principal, id, revision);
    if (!row) throw notFound();
    return row;
  }

  restore(principal: Principal, id: string, revision: number): DocumentRow {
    if (!Number.isInteger(revision) || revision < 1) {
      throw invalidRequest('revision 은 1 이상의 정수여야 합니다.');
    }
    const result = this.store.restore(principal, id, revision);
    if (result.kind === 'not_found') throw notFound();
    if (result.kind === 'conflict') throw conflict(result.currentRevision);
    return result.document;
  }
}
