/**
 * 저장 계층 공통 타입.
 */

/** 요청 주체 — 토큰에서만 얻는다. 클라이언트 입력으로 만들지 않는다. */
export interface Principal {
  clientId: string;
  subject: string;
  subjectName?: string;
}

export interface DocumentRow {
  id: string;
  clientId: string;
  subject: string;
  title: string;
  content: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

/** 목록 응답 — 본문을 싣지 않는다 (I §1.2) */
export type DocumentSummary = Omit<DocumentRow, 'content' | 'clientId' | 'subject'>;

export interface RevisionRow {
  documentId: string;
  revision: number;
  title: string;
  content: string;
  updatedAt: string;
  updatedBy: string | null;
}

export type RevisionSummary = Omit<RevisionRow, 'documentId' | 'title' | 'content'>;

/** 수정 결과 — 충돌을 예외가 아닌 값으로 표현해 호출측이 반드시 다루게 한다. */
export type UpdateResult =
  | { kind: 'ok'; document: DocumentRow }
  | { kind: 'not_found' }
  | { kind: 'conflict'; currentRevision: number };
