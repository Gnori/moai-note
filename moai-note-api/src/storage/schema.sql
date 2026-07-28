-- moai-note 저장 스키마 (I §4)
-- 멱등: 여러 번 적용해도 안전하다.

-- 클라이언트(호스트) 등록
CREATE TABLE IF NOT EXISTS client (
  client_id     TEXT PRIMARY KEY,
  secret_hash   TEXT NOT NULL,          -- 평문 저장 금지 (salt:hash)
  name          TEXT NOT NULL,
  revoked       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

-- 문서
CREATE TABLE IF NOT EXISTS document (
  id            TEXT PRIMARY KEY,        -- UUID v4
  client_id     TEXT NOT NULL,
  subject       TEXT NOT NULL,           -- 호스트가 준 사용자 식별자
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,           -- 마크다운
  revision      INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  FOREIGN KEY (client_id) REFERENCES client(client_id)
);

-- 소유자 기준 목록 조회가 가장 잦다
CREATE INDEX IF NOT EXISTS idx_document_owner
  ON document(client_id, subject, updated_at DESC);

-- 리비전 — 수정 직전 내용을 보존한다
CREATE TABLE IF NOT EXISTS document_revision (
  document_id   TEXT NOT NULL,
  revision      INTEGER NOT NULL,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  PRIMARY KEY (document_id, revision),
  FOREIGN KEY (document_id) REFERENCES document(id) ON DELETE CASCADE
);
