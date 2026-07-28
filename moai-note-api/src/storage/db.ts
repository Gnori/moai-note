/**
 * SQLite 연결과 스키마 적용.
 */
import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export type Db = Database.Database;

export function openDatabase(dbPath: string): Db {
  // ':memory:' 는 디렉토리를 만들지 않는다 (테스트용)
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  }

  const db = new Database(dbPath);

  // SQLite는 외래키를 기본으로 끈다. 켜지 않으면 ON DELETE CASCADE 가 동작하지 않아
  // 문서를 지워도 리비전이 남는다.
  db.pragma('foreign_keys = ON');
  // 읽기·쓰기 동시성을 위해 WAL 사용 (메모리 DB는 지원하지 않는다)
  if (dbPath !== ':memory:') db.pragma('journal_mode = WAL');

  const schema = readFileSync(resolve(HERE, 'schema.sql'), 'utf8');
  db.exec(schema);

  return db;
}
