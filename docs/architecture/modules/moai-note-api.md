# moai-note-api

> 문서 정본 저장소이자 유일한 인증 관문. REST·MCP 두 표면과 에디터 번들 정적 제공을 겸한다.
> 상위 문서: [../overview.md](../overview.md) · 마지막 확인: 2026-07-28 (커밋 `f975855`)

| 항목 | 값 |
|---|---|
| 런타임 | Node ≥ 20, ESM(`"type": "module"`), TypeScript를 **빌드 없이 실행** |
| 프레임워크 | Fastify 5 (`@fastify/cors`, `@fastify/rate-limit`) |
| 저장소 | SQLite (`better-sqlite3` 11, 동기 API) |
| 토큰 | `jose` 5 — HS256 JWT |
| MCP | `@modelcontextprotocol/sdk` — streamable HTTP |
| 기동 | `npm run dev`(tsx watch) / `npm start`(`node --experimental-strip-types`) |
| 타입 검사 | `npm run build` = `tsc --noEmit` (산출물을 만들지 않는다) |

## 1. 계층

```
src/
├ index.ts                  진입점 — 설정 로드 · 서버 조립 · SIGINT/SIGTERM 정리 종료
├ config.ts                 환경변수 파싱. 비밀값에 기본값을 주지 않는다
│
├ http/
│  ├ server.ts              조립 순서의 정본. 플러그인·오류 처리·관문·라우트 등록
│  └ staticRoutes.ts        GET /embed.js — mtime 기반 캐시 + ETag
│
├ auth/                     ★ 관문
│  ├ guard.ts               onRequest 훅 · PUBLIC_PATHS · requirePrincipal()
│  ├ token.ts               issueToken / verifyToken (HS256, iss·aud·exp 검증)
│  └ clientAdmin.ts         클라이언트 등록·조회·폐기 CLI (HTTP 노출 없음)
│
├ rest/                     얇은 어댑터 — 로직 없음
│  ├ authRoutes.ts          POST /api/v1/auth/token
│  ├ documentRoutes.ts      문서·리비전 8개 라우트
│  └ schemas.ts             JSON Schema — 형식 검증을 라우트 진입 전에 끝낸다
│
├ mcp/                      얇은 어댑터 — 로직 없음
│  ├ server.ts              POST /mcp — 요청마다 독립 인스턴스
│  └ tools.ts               도구 8개 정의 (설명문에 사용 규약 포함)
│
├ service/                  ★ 유일한 구현
│  ├ documentService.ts     검증 · 상한 보정 · 오류 판정
│  └ errors.ts              ServiceError + 오류 코드 ↔ HTTP 상태 표
│
└ storage/
   ├ db.ts                  연결 · PRAGMA · 스키마 적용(멱등)
   ├ schema.sql             테이블 3개 + 인덱스 1개
   ├ documentStore.ts       모든 쿼리에 소유자 조건. 트랜잭션 · 리비전 정리
   ├ clientStore.ts         scrypt 해시 · 상수시간 비교
   └ types.ts               Principal · Row · UpdateResult
```

**의존 방향**: `http` → (`rest`|`mcp`|`auth`) → `service` → `storage`.
`service`는 `storage` 인터페이스만 알고 HTTP를 모른다. `storage`는 위를 모른다.

## 2. 요청 파이프라인

`buildServer()`의 등록 순서가 곧 통과 순서다. **인증 관문이 라우트보다 먼저 등록되는 것이 핵심** —
나중에 라우트를 추가해도 자동으로 관문 아래 놓인다.

```
요청
 │
 ├─ CORS            화이트리스트 밖 오리진 거부. 목록이 비면 크로스 오리진 전면 거부
 │                  credentials:false · 허용 헤더는 Content-Type, Authorization 뿐
 ├─ Rate limit      기본 300req / 1분 → 초과 시 429 RATE_LIMITED
 ├─ 본문 한도       maxContentBytes + 64KB (service 검증 전에 과대 페이로드 차단)
 │
 ├─ ★ 인증 관문 (onRequest)                       auth/guard.ts
 │     PUBLIC_PATHS 면 통과
 │     Authorization: Bearer <jwt> 없으면            → 401 UNAUTHENTICATED
 │     verifyToken 실패(서명·iss·aud·exp·클레임)     → 401
 │     clients.isActive(cid) 가 false(폐기된 호스트) → 401  ※ 만료 전이라도 즉시 차단
 │     통과 시 req.principal = { clientId, subject, subjectName? }
 │
 ├─ 스키마 검증     rest/schemas.ts — 형식 오류는 여기서 400
 └─ 라우트 핸들러   requirePrincipal(req) → service 호출
```

`requirePrincipal()`은 `req.principal`이 없으면 **예외를 던진다**. 관문 등록이 빠진 채로
요청이 조용히 통과하는 사고를 막는 안전장치다(500이 나서 즉시 드러난다).

### 무인증 경로 — 이 셋이 전부

| 경로 | 왜 예외인가 |
|---|---|
| `POST /api/v1/auth/token` | 토큰을 받으러 오는 곳. 대신 `client_secret`으로 검증한다 |
| `GET /embed.js` | 공개 정적 자산. 파일 자체에 데이터가 없다 |
| `GET /health` | 기동 확인용. `{"status":"ok"}`만 반환 |

예외는 `auth/guard.ts`의 `PUBLIC_PATHS`에서만 늘린다. 라우트 파일에서 개별적으로 우회하지 않는다.

## 3. 인증

### 3.1 클라이언트(호스트) 등록 — CLI 전용

```bash
npm run client:add -- --name "SeedAI 챗봇"    # client_id + client_secret 출력 (이때 한 번만)
npm run client:list                            # 목록·폐기 여부
npm run client:revoke -- --id cli_xxx          # 폐기 → 발급된 토큰도 즉시 무효
```

- `client_id` = `cli_` + 무작위 9바이트(base64url), `client_secret` = 무작위 32바이트(base64url)
- 저장은 **scrypt 해시만** — `salt:hash` 형식(salt 16바이트 hex, 키 64바이트)
- 검증은 `timingSafeEqual`. 없는 `client_id`에도 더미 해시를 계산해 **응답 시간을 맞춘다**
  (존재 여부가 타이밍으로 새지 않게)
- 등록을 HTTP로 노출하지 않는다 — 등록 API 자체가 공격면이 된다

### 3.2 토큰

`POST /api/v1/auth/token` — **호스트 백엔드가 서버 간으로만** 호출한다.

```jsonc
// 요청
{ "client_id": "cli_…", "client_secret": "…", "subject": "user-42", "subject_name": "임재현" }
// 응답
{ "access_token": "eyJ…", "token_type": "Bearer", "expires_in": 3600 }
```

| 항목 | 값 |
|---|---|
| 알고리즘 | HS256 (`MOAI_NOTE_TOKEN_SECRET`, 32자 이상 강제) |
| `iss` / `aud` | `moai-note` / `moai-note-api` — 둘 다 검증한다 |
| 클레임 | `cid`(client_id) · `sub`(호스트가 준 사용자 식별자) · `nm`(표시명, 선택) |
| 만료 | `MOAI_NOTE_TOKEN_TTL` 기본 3600초 |
| 실패 응답 | 원인(없는 id / 틀린 시크릿 / 폐기됨)을 구분하지 않고 `401 INVALID_CLIENT` |

검증 실패 원인도 호출측에 흘리지 않는다(`InvalidTokenError` 하나로 뭉친다).
`alg=none` 위조·다른 키 서명·만료·필수 클레임 누락은 모두 테스트로 고정돼 있다(`test/token.test.ts`).

### 3.3 소유권

소유자는 `(client_id, subject)` **쌍**이다. 같은 `subject` 문자열이라도 호스트가 다르면 다른 사람이다.

세 겹으로 막는다.

1. `Principal`은 토큰에서만 만들어진다 — 요청 본문·쿼리에 소유자 필드가 아예 없다
2. service의 모든 함수 시그니처가 `Principal`을 첫 인자로 요구한다
3. storage의 모든 조회·수정·삭제 쿼리에 `client_id = ? AND subject = ?`가 들어간다

리비전 테이블에는 소유자 정보가 없으므로, 리비전 조회는 **먼저 문서 소유권을 확인**한 뒤 진행한다.

## 4. 저장 스키마

```sql
client (client_id PK, secret_hash, name, revoked, created_at)

document (id PK=UUIDv4, client_id FK, subject, title, content, revision,
          created_at, updated_at, updated_by)
  INDEX idx_document_owner (client_id, subject, updated_at DESC)   -- 목록 조회가 가장 잦다

document_revision (document_id FK, revision, title, content, updated_at, updated_by,
                   PRIMARY KEY (document_id, revision), ON DELETE CASCADE)
```

| 결정 | 이유 |
|---|---|
| `foreign_keys = ON` | SQLite는 기본이 OFF다. 켜지 않으면 문서를 지워도 리비전이 남는다 |
| `journal_mode = WAL` | 읽기·쓰기 동시성. `:memory:`(테스트)에서는 적용하지 않는다 |
| 본문은 `TEXT` 마크다운 | 표현 형식이 하나여야 사람·에이전트 경로가 갈라지지 않는다 |
| 시각은 ISO8601 문자열 | 주입 가능한 `now()`로 테스트에서 고정한다 |
| 스키마 적용은 기동 시 멱등 실행 | 마이그레이션 도구가 아직 없다 — 파괴적 변경이 생기면 그때 도입한다 |

### 리비전 모델

**리비전은 "직전 내용"의 보관이다.** 수정 시 현재 내용을 `document_revision`에 넣고 본문을
갱신하며 `revision`을 +1 한다 — 둘은 한 트랜잭션이다(갈라지면 이력이 유실되거나 중복된다).

- `restore(id, r)`: 이력을 **지우지 않는다**. r의 내용으로 새 리비전을 만든다 — 되돌린 것도 하나의 변경
- 보관 상한(`MOAI_NOTE_MAX_REVISIONS`, 기본 50) 초과분은 오래된 것부터 삭제
- 최신 본문은 `document`에만 있다 — `document_revision`의 최대 revision은 현재보다 하나 작다

### 충돌 감지

```
클라A: get → r3          클라B: get → r3
클라A: put baseRevision=3 → 200, r4
클라B: put baseRevision=3 → 409 { code: REVISION_CONFLICT, currentRevision: 4 }
```

`update`는 트랜잭션 안에서 현재 revision과 `baseRevision`을 비교한다.
충돌은 **예외가 아니라 값**(`UpdateResult`)으로 storage를 빠져나온다 — 호출측이 반드시 다루게 하려는 것.
service가 그 값을 `ServiceError`로 바꾼다.

## 5. REST 계약

베이스: `/api/v1`. 요청·응답 모두 JSON(UTF-8). 인증은 `Authorization: Bearer <access_token>`.

| 메서드 | 경로 | 본문 | 성공 |
|---|---|---|---|
| POST | `/auth/token` | `client_id`, `client_secret`, `subject`, `subject_name?` | 200 |
| POST | `/documents` | `title`, `content` | **201** + Document |
| GET | `/documents?limit&offset` | — | 200 `{ items: [Summary] }` |
| GET | `/documents/:id` | — | 200 Document |
| PUT | `/documents/:id` | `title`, `content`, **`baseRevision`** | 200 Document |
| DELETE | `/documents/:id` | — | **204** (본문 없음) |
| GET | `/documents/:id/revisions` | — | 200 `{ items: [{revision, updatedAt, updatedBy}] }` |
| GET | `/documents/:id/revisions/:revision` | — | 200 `{ revision, title, content, … }` |
| POST | `/documents/:id/revisions/:revision/restore` | — | 200 Document |

- **Document**: `id, title, content, revision, createdAt, updatedAt, updatedBy`
- **Summary**(목록): Document에서 `content` 제외 — 목록에 본문을 싣지 않는다
- `limit` 기본 20 / 최대 100(초과 값은 잘라서 보정), `offset` 기본 0
- 정렬은 `updated_at DESC` 고정

### 오류 계약

모든 오류는 같은 모양이다. `error` 아래에 부가 필드가 붙을 수 있다(`currentRevision`, `limitBytes`).

```json
{ "error": { "code": "REVISION_CONFLICT", "message": "문서가 이미 변경되었습니다.", "currentRevision": 4 } }
```

| 코드 | HTTP | 발생 |
|---|:--:|---|
| `INVALID_REQUEST` | 400 | 스키마 위반, 빈 제목, 잘못된 `baseRevision`/`revision` |
| `CONTENT_TOO_LARGE` | 400 | 본문 바이트 수 초과 (`limitBytes` 동봉) |
| `UNAUTHENTICATED` | 401 | 토큰 없음·검증 실패·폐기된 클라이언트 |
| `INVALID_CLIENT` | 401 | 토큰 발급 시 자격증명 불일치 |
| `FORBIDDEN` | 403 | 정의만 있고 현재 사용처 없음 — 남의 문서는 404로 답한다 |
| `NOT_FOUND` | 404 | 없는 문서·리비전, **그리고 남의 문서** |
| `REVISION_CONFLICT` | 409 | `baseRevision` 불일치 (`currentRevision` 동봉) |
| `RATE_LIMITED` | 429 | 빈도 제한 |
| `INTERNAL_ERROR` | 500 | 그 밖 — 원인을 응답에 노출하지 않는다 |

본문 크기는 **문자 수가 아니라 바이트**로 잰다(한글은 문자당 3바이트).

### 로그

`authorization`, `client_secret`, `client_id`는 `***`로 가려서 기록한다.
인증 실패는 경로와 사유만 남기고 토큰 원문은 남기지 않는다.

## 6. MCP 표면

`POST /mcp` — streamable HTTP. **인증은 REST와 같은 관문**이 처리하므로 여기에 인증 코드가 없다.

```
요청 → 인증 관문 → req.principal
      → 이 요청 전용 Server + StreamableHTTPServerTransport 생성
      → 도구 실행(principal 고정) → JSON 텍스트 응답 → 정리
```

**요청마다 인스턴스를 새로 만든다.** 서버를 공유하면 한 사용자의 principal이 다른 사용자의 도구
호출에 쓰일 수 있다 — `sessionIdGenerator: undefined`로 세션 상태를 아예 두지 않는 이유다.

| 도구 | service | 비고 |
|---|---|---|
| `note_create` | `create` | 생성된 `id`를 돌려준다 — 이 id로 사용자에게 문서를 띄운다 |
| `note_list` | `list` | 본문 없음, 최근 수정순 |
| `note_get` | `get` | 응답의 `revision`이 수정 시 `baseRevision` |
| `note_update` | `update` | `id`, `title`, `content`, `baseRevision` 필수 |
| `note_delete` | `delete` | 되돌릴 수 없음 |
| `note_revisions` | `listRevisions` | |
| `note_revision_get` | `getRevision` | |
| `note_restore` | `restore` | 새 리비전으로 되돌린다 |

도구 설명문에 **사용 절차를 적어 둔다** — LLM은 스키마보다 설명을 따른다.
`note_update` 설명은 "먼저 `note_get`으로 revision 확인 → 409면 다시 읽고 병합 후 재시도 →
임의의 `baseRevision`을 넣지 말 것"을 명시한다.

오류는 `isError: true` + `{"error":{...}}` JSON 텍스트로 나간다 — **REST와 같은 코드**다.
특히 `REVISION_CONFLICT`는 `currentRevision`까지 실어 보내 에이전트가 재시도 절차를 밟게 한다.

## 7. 정적 제공 (`/embed.js`)

| 항목 | 동작 |
|---|---|
| 대상 파일 | `MOAI_NOTE_EMBED_BUNDLE` (기본 `../moai-note-editor-web/dist/embed.js`) |
| 캐시 | 메모리 캐시 + **mtime 비교** — 파일이 바뀌면 재기동 없이 다시 읽는다 |
| 검증 | SHA-256 앞 32자 ETag. `If-None-Match` 일치 시 304 |
| 헤더 | `Cache-Control: public, max-age=300, must-revalidate` |
| 번들 없음 | 404 + 경고 로그. **API 기동은 실패하지 않는다** (에디터 빌드 전에도 백엔드는 떠야 한다) |

## 8. 테스트

```bash
npm test        # vitest run — 3 파일 / 37 테스트 (2026-07-28 전부 통과)
```

| 파일 | 덮는 범위 |
|---|---|
| `test/token.test.ts` | 발급·검증, 다른 키·만료·형식 오류·`alg=none` 위조·iss/aud 불일치·클레임 누락 |
| `test/storage.test.ts` | CRUD, **소유권 격리**, 목록에 본문 미포함, 리비전 생성·상한·CASCADE |
| `test/service.test.ts` | 검증(제목·바이트 상한·`baseRevision`), 남의 문서 404, 충돌 409 + `currentRevision`, limit 보정 |

DB는 `:memory:`로 띄우고 `now()`를 주입해 시각을 고정한다.

**아직 자동 테스트가 없는 영역**: HTTP 통합(관문·CORS·빈도 제한·스키마 400·상태 코드),
MCP 라우트 실호출, `/embed.js` ETag/304. 이 부분은 W(검증 보고) 작성 시 수동 증거로 남기거나
통합 테스트를 추가한다.

## 9. 확장할 때 지켜야 할 것

새 기능을 붙일 때의 순서는 항상 같다.

```
storage(쿼리에 소유자 조건) → service(검증·오류 판정) → rest 어댑터 + mcp 도구를 같은 커밋에서
```

- **REST에만 있고 MCP에 없는 기능을 만들지 않는다.** 두 표면의 동작이 갈라지는 시작점이다
- 검증·분기를 컨트롤러나 도구에 넣지 않는다 — 반대쪽 경로에서 빠진다
- `WHERE id = ?`만 있는 쿼리를 만들지 않는다 — 인가 우회 경로가 된다
- 무인증 경로를 늘릴 때는 `PUBLIC_PATHS`에만 추가하고, 그 이유를 주석으로 남긴다
- 오류를 새로 만들면 `ErrorCode`와 HTTP 매핑에 함께 넣는다 — 문자열을 즉석에서 만들지 않는다
