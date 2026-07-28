# moai-note 아키텍처 개요

> 시작점 문서. 구조를 파악할 때 여기서 시작해 각 절로 이동한다.
> 여기 적힌 사실값(포트·경로·엔드포인트·환경변수)은 **코드에서 확인한 것**이다.
> 마지막 확인: 2026-07-28 (커밋 `f975855`)

| 모듈 상세 | 문서 |
|---|---|
| 저장·인증·REST·MCP | [modules/moai-note-api.md](modules/moai-note-api.md) |
| 임베드 에디터 번들 | [modules/moai-note-editor-web.md](modules/moai-note-editor-web.md) |

---

## 1. 무엇인가

**노션형 블록 에디터와 그 저장 백엔드.** 호스트 페이지에 임베드해서 쓰는 독립 제품이다.

첫 소비자는 SeedAI 챗봇 위젯이지만, **SeedAI에 의존하지 않는다.** 인증·저장·설정을 자체 보유하며
다른 호스트에도 같은 방식으로 붙는다. 코드에는 호스트 이름이 등장하지 않는다 — 호스트는
`client` 테이블의 한 행일 뿐이다.

핵심은 **정본의 소유**다. 문서는 moai-note에 있고, 사람은 임베드된 에디터로, 에이전트는 MCP로
**같은 문서**를 다룬다. 두 경로가 같은 service 계층을 지나므로 동작이 갈라지지 않는다.

```
        [에이전트]                          [사람]
            │ MCP  /mcp                       │ 임베드 에디터 → REST /api/v1/documents
            ▼                                 ▼
        ┌───────────────────────────────────────┐
        │   moai-note-api   (문서 정본 · SQLite)  │
        └───────────────────────────────────────┘
```

## 2. 모듈 구성

| 모듈 | 스택 | 역할 | 산출물 |
|---|---|---|---|
| `moai-note-editor-web` | TypeScript + TipTap 3(ProseMirror) + Vite 8 | 에디터 UI·마크다운 왕복 | `dist/embed.js` (IIFE 단일 파일, CSS 포함) |
| `moai-note-api` | TypeScript + Node ≥20 + Fastify 5 + better-sqlite3 | 문서 저장 + 토큰 발급 + REST + MCP + 번들 정적 제공 | 소스 직접 실행(빌드 산출물 없음) |

두 모듈은 **npm 워크스페이스로 묶여 있지 않다.** 각자 `package.json`을 갖고 각자 설치·실행한다.
런타임 결합 지점은 하나뿐이다 — API가 에디터의 `dist/embed.js` 파일을 읽어 `/embed.js`로 제공한다.

## 3. 전체 구조

```
[호스트 페이지]  예: SeedAI 챗봇 위젯
   │  <script src="https://<moai-note>/embed.js">   ← 필요할 때만 로드
   │  MoaiNote.mount(el, { documentId, token })
   │
   │  Shadow DOM 안에 에디터 생성 (호스트 CSS와 상호 무간섭)
   │
   │  https + Bearer 단기 토큰
   ▼
[moai-note-api] :7100
   │
   ├─ 요청 파이프라인 (등록 순서 = 통과 순서)
   │     CORS 화이트리스트 → 빈도 제한 → **인증 관문** → 라우트
   │
   ├ http/       server.ts 조립 · staticRoutes.ts (/embed.js)
   ├ auth/       guard.ts(관문) · token.ts(HS256 발급·검증) · clientAdmin.ts(CLI)
   ├ rest/       documentRoutes.ts · authRoutes.ts · schemas.ts   ─┐
   ├ mcp/        server.ts(streamable HTTP) · tools.ts (8개 도구)  ─┤ 얇은 어댑터
   ├ service/    documentService.ts · errors.ts                  ◄─┘ 유일한 구현
   └ storage/    db.ts · documentStore.ts · clientStore.ts · schema.sql
```

**의존 방향은 한쪽이다**: `rest`/`mcp` → `service` → `storage`.
역방향 참조도, 어댑터끼리의 참조도 없다.

## 4. 설계 원칙

이 네 가지는 타협하지 않는다. 각 항목 옆의 파일이 그 원칙이 지켜지는 자리다.

### 4-1. 인증 관문은 하나 — `auth/guard.ts`

REST와 MCP가 **같은 `onRequest` 훅**을 지난다. 라우트보다 먼저 등록되므로 새 라우트를 추가해도
자동으로 덮인다. 무인증 경로는 코드에 상수로 못 박혀 있다.

```ts
PUBLIC_PATHS = { '/api/v1/auth/token', '/embed.js', '/health' }   // 이 셋이 전부다
```

`/mcp`는 이 목록에 없다 — MCP도 Bearer 토큰이 없으면 401이다.

> SeedAI에서 MCP `/http`를 무인증(`permitAll`)으로 열어둔 사례가 미해결 부채로 남아 있다.
> 같은 구조를 새로 만들지 않는다.

### 4-2. 로직은 service에만 — `service/documentService.ts`

검증(제목 길이·본문 바이트 수·`baseRevision` 정합성), 목록 상한 보정, 오류 판정이 전부 여기 있다.
REST 컨트롤러는 `service` 호출 + HTTP 코드 변환만, MCP 도구는 `service` 호출 + JSON 직렬화만 한다.

- MCP 도구가 REST를 HTTP로 재호출하는 구조 없음 (같은 프로세스에서 같은 함수를 부른다)
- 컨트롤러가 storage를 직접 만지는 구조 없음

### 4-3. 시크릿은 브라우저에 두지 않는다 — `rest/authRoutes.ts`

`client_secret`은 **서버 간 호출 전용**이다. 브라우저는 단기 토큰만 갖는다.

```
[호스트 백엔드] ──client_id + client_secret + subject──►  POST /api/v1/auth/token
                ◄──── access_token (HS256, 기본 1시간) ────
      │  단기 토큰만 전달
      ▼
  [브라우저]  ──Bearer──►  /api/v1/documents/*
  [에이전트]  ──Bearer──►  /mcp
```

시크릿은 평문으로 저장하지 않는다(scrypt 해시). 등록은 HTTP가 아니라 **CLI**로만 한다 —
등록 API 자체가 공격면이 되기 때문이다.

이 구조 덕분에 moai-note는 **호스트가 누구인지 알 필요가 없다.** 호스트가 자기 사용자 체계로
인증한 뒤 그 결과를 `subject`로 넘기기만 하면 된다.

### 4-4. 소유권은 서버가 판단한다 — `storage/documentStore.ts`

소유자는 `(client_id, subject)` 쌍이며 **토큰에서만** 나온다. service의 모든 함수는 첫 인자가
`Principal`이라 호출자가 소유자를 지정할 수 없고, storage의 모든 쿼리에 소유자 조건이 들어간다.

남의 문서는 403이 아니라 **404**다 — 존재 여부 자체를 노출하지 않는다.

## 5. 두 표면 — 같은 8개 기능

| service | REST | MCP 도구 |
|---|---|---|
| `create` | `POST /api/v1/documents` | `note_create` |
| `list` | `GET /api/v1/documents` | `note_list` |
| `get` | `GET /api/v1/documents/:id` | `note_get` |
| `update` | `PUT /api/v1/documents/:id` | `note_update` |
| `delete` | `DELETE /api/v1/documents/:id` | `note_delete` |
| `listRevisions` | `GET /api/v1/documents/:id/revisions` | `note_revisions` |
| `getRevision` | `GET …/revisions/:revision` | `note_revision_get` |
| `restore` | `POST …/revisions/:revision/restore` | `note_restore` |

문서 본문의 교환 형식은 **마크다운 문자열**이다. 부분 패치는 없고 항상 전체를 보낸다.
수정은 `baseRevision`을 함께 보내야 하며, 어긋나면 `409 REVISION_CONFLICT`와 `currentRevision`이
돌아온다 — 사람과 에이전트가 서로의 편집을 덮어쓰지 못하게 하는 유일한 장치다.

## 6. 에디터 임베드 계약

**iframe이 아니라 JS로 호스트 DOM에 직접 마운트한다.**

```html
<script src="https://<moai-note>/embed.js"></script>
<div id="note-1"></div>
<script>
  const inst = MoaiNote.mount('#note-1', { documentId: 'xxx', token: '<단기토큰>' });
</script>
```

| 항목 | 구현 |
|---|---|
| 로드 | API 서버가 `/embed.js`로 정적 제공(ETag + `max-age=300, must-revalidate`) |
| 전역 | `MoaiNote` 하나 (`mount`, `version`). default export 없음 |
| 프레임워크 | 비의존 — TipTap까지 번들에 포함, 호스트에 아무것도 요구하지 않는다 |
| 스타일 격리 | Shadow DOM(open) + CSS를 번들 문자열로 주입 |
| `apiBase` 기본값 | `embed.js`를 받아온 오리진 |
| 내용 | 호스트가 넘기지 않는다 — `documentId`로 API에서 불러온다 |
| 해제 | `instance.destroy()` — 리스너·에디터·Shadow host를 모두 제거 |

옵션·인스턴스 메서드 전체는 [modules/moai-note-editor-web.md](modules/moai-note-editor-web.md) 참조.

### 왜 Shadow DOM인가

호스트 CSS에 전역 리셋이 있으면 에디터 내부까지 덮인다.
실제로 SeedAI 챗봇 위젯 CSS에는 `* { box-sizing; margin; padding }` 이 있다
(`moai-note-editor-web/demo/index.html`이 이 조건을 일부러 재현해 격리를 확인한다).

Shadow DOM은 **iframe 수준의 CSS 격리**를 주면서도 같은 문서 안에 있어
높이·테마가 자연스럽게 동작한다. 양방향 오염을 모두 막는다.

## 7. 배포·기동

**호스트에 번들을 복사하지 않는다.** API 서버가 `embed.js`를 정적 제공한다.

```
moai-note-editor-web/dist/embed.js
        │  MOAI_NOTE_EMBED_BUNDLE 이 가리키는 파일
        ▼
moai-note-api  ──  GET /embed.js  ──►  호스트는 <script> 한 줄
```

파일 mtime이 바뀌면 서버가 다시 읽는다 — **에디터를 다시 빌드하면 API 재기동 없이 반영된다.**
번들이 없어도 API는 뜨고 `/embed.js`만 404를 준다(경고 로그 1줄).

번들 복사 방식을 쓰지 않는 이유:

- API 계약이 바뀌면 **호스트를 전부 재배포**해야 한다
- 누락되면 구버전 에디터가 신버전 API를 호출해 조용히 깨진다
- 호스트가 늘어날수록 배포 비용이 선형으로 증가한다

버전 고정 경로(`/v1/embed.js` 등)는 아직 없다. 필요해지면 I에서 확정한다.

```bash
# 1) 에디터 번들
cd moai-note-editor-web && npm install && npm run build      # → dist/embed.js

# 2) API (.env 준비 후)
cd moai-note-api && npm install
npm run client:add -- --name "<호스트 이름>"                  # client_id/secret 발급 (1회)
npm run dev                                                  # tsx watch
```

## 8. 포트

| 포트 | 용도 | 정하는 곳 |
|---|---|---|
| **7100** | `moai-note-api` (REST + MCP + `/embed.js`) | `MOAI_NOTE_PORT` (기본값 `config.ts`) |
| 7110 | 에디터 Vite 개발 서버 (데모 전용, 배포와 무관) | `vite.config.ts` |

**71xx가 moai-note 대역이다.** 다른 제품의 번호 체계를 따르지 않는다 — 독립 제품이므로
자기 대역을 갖는다. 모듈이 늘어나면 7101, 7102 …로 확장한다.

같은 개발 머신에서 다른 제품과 함께 뜨므로, 포트를 정할 때는 문서가 아니라
**실제 점유 상태를 확인**한다(`lsof -nP -iTCP -sTCP:LISTEN`).

## 9. 환경 변수

`moai-note-api`만 환경변수를 읽는다(`src/config.ts`). 에디터는 빌드 시점 환경변수가 없다.

| 변수 | 필수 | 기본값 | 용도 |
|---|:--:|---|---|
| `MOAI_NOTE_TOKEN_SECRET` | ✅ | — | 토큰 서명키(HS256). **32자 미만이면 기동 실패** |
| `MOAI_NOTE_CORS_ORIGINS` | ✅* | 빈 값 | 허용 오리진(쉼표 구분). `*` 금지. 비면 크로스 오리진 전면 거부 + 경고 |
| `MOAI_NOTE_PORT` | | `7100` | 수신 포트 |
| `MOAI_NOTE_HOST` | | `0.0.0.0` | 수신 주소 |
| `MOAI_NOTE_DB_PATH` | | `./data/moai-note.db` | SQLite 파일 |
| `MOAI_NOTE_TOKEN_TTL` | | `3600` | 액세스 토큰 만료(초) |
| `MOAI_NOTE_TLS_CERT` / `_KEY` | | 없음 | 둘 다 주면 HTTPS. 하나만 주면 기동 실패 |
| `MOAI_NOTE_MAX_CONTENT_BYTES` | | `1000000` | 본문 상한(바이트). 요청 본문 한도는 +64KB |
| `MOAI_NOTE_MAX_TITLE_LENGTH` | | `300` | 제목 상한(문자) |
| `MOAI_NOTE_MAX_REVISIONS` | | `50` | 문서당 리비전 보관 개수 |
| `MOAI_NOTE_EMBED_BUNDLE` | | `../moai-note-editor-web/dist/embed.js` | `/embed.js`로 제공할 파일 |
| `MOAI_NOTE_RATE_LIMIT_MAX` | | `300` | 창당 최대 요청 수 |
| `MOAI_NOTE_RATE_LIMIT_WINDOW` | | `1 minute` | 빈도 제한 창 |
| `MOAI_NOTE_LOG_LEVEL` | | `info` | Fastify 로그 레벨 |

*`MOAI_NOTE_CORS_ORIGINS`가 없어도 기동은 되지만 브라우저 임베드가 동작하지 않는다.

비밀값은 커밋하지 않는다. 템플릿은 `moai-note-api/.env.example`.

## 10. 검증 상태

| 모듈 | 명령 | 결과 (2026-07-28) |
|---|---|---|
| `moai-note-api` | `npm test` (vitest) | 3 파일 / **37 테스트 통과** — token, storage(소유권 격리 포함), service |
| `moai-note-editor-web` | `npm test` (vitest) | 1 파일 / **22 테스트 통과** — 마크다운 왕복 |

자동 테스트가 덮지 않는 영역: HTTP 통합(라우트·관문·CORS), MCP 도구 호출,
브라우저 실제 동작(Shadow DOM 격리·IME·버블/슬래시 UI). 후자는
`moai-note-editor-web/demo/index.html`로 수동 확인한다.

## 11. 문서

| 문서 | 내용 |
|---|---|
| 이 문서 | 시작점 — 구조·원칙·계약·배포·포트·환경변수 |
| [modules/moai-note-api.md](modules/moai-note-api.md) | 계층·파이프라인·인증·저장 스키마·엔드포인트·MCP·오류 계약 |
| [modules/moai-note-editor-web.md](modules/moai-note-editor-web.md) | 번들 전략·마운트 생명주기·마크다운 왕복·IME·API 클라이언트 |
| `docs/requirements/` | 요구사항 산출물 (R/I/P/W) — 무엇을 왜 만들기로 했는지 |
| `../../README.md` | 저장소 소개 |

**정본 갱신 의무**: 코드 변경이 구조에 영향을 주면 W(검증 보고) 작성 시점에 이 디렉토리를 함께 갱신한다.
