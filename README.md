# moai-note

노션형 블록 에디터와 그 저장 백엔드. **호스트 페이지에 임베드해서 쓰는 독립 제품**이다.

문서의 정본은 moai-note가 소유한다. 사람은 임베드된 에디터로, 에이전트는 MCP로 **같은 문서**를
다룬다. 호스트는 내용을 실어 나르지 않고 `documentId` 참조만 갖는다.

첫 소비자는 SeedAI 챗봇 위젯(`seed-ai-agent-client-web-ui`)이지만, **SeedAI에 의존하지 않는다** —
인증·저장·설정을 자체 보유하며 다른 호스트에도 같은 방식으로 붙는다.

## 구성

| 디렉토리 | 내용 |
|---|---|
| `moai-note-editor-web/` | 에디터 본체. TypeScript + TipTap 3 + Vite 8 → `dist/embed.js` 단일 번들 |
| `moai-note-api/` | 문서 저장 + 토큰 발급 + REST + MCP. Node ≥20 + Fastify 5 + SQLite. 포트 **7100** |
| `docs/architecture/` | 구조·설계 원칙·임베드 계약·배포 — **[overview.md가 시작점](docs/architecture/overview.md)** |
| `docs/requirements/` | 요구사항 산출물 (R/I/P/W) |

두 모듈은 각자 `package.json`을 갖는다(워크스페이스 아님). 런타임 결합 지점은 하나 —
API가 에디터의 `dist/embed.js`를 읽어 `/embed.js`로 제공한다.

## 사용법 (호스트 입장)

```html
<script src="https://<moai-note>/embed.js"></script>
<div id="note-1"></div>
<script>
  MoaiNote.mount('#note-1', { documentId: 'xxx', token: '<단기 토큰>' });
</script>
```

- 스크립트 한 줄이 전부다. 프레임워크를 요구하지 않고, 에디터는 Shadow DOM 안에서만 그려진다
- `token`은 **호스트 백엔드가** `client_id`/`client_secret`으로 받아온 단기 토큰이다.
  `client_secret`은 브라우저에 두지 않는다

## 배포

**호스트에 번들을 복사하지 않는다.** API 서버가 정적 제공한다.

```
moai-note-editor-web/dist/embed.js  ──►  moai-note-api 가 GET /embed.js 로 제공  ──►  호스트는 <script> 한 줄
```

파일이 바뀌면 서버가 다시 읽으므로 **에디터 재빌드만으로 모든 호스트에 반영**된다(API 재기동 불필요).
번들을 호스트에 복사해 두면 API 계약이 바뀔 때 호스트를 전부 재배포해야 하고, 누락 시 구버전
에디터가 신버전 API를 호출해 조용히 깨진다.

## 개발 기동

```bash
# 1) 에디터 번들
cd moai-note-editor-web
npm install
npm run build            # → dist/embed.js
npm run dev              # 데모 페이지 (http://localhost:7110) — Shadow DOM 격리·IME 수동 검증

# 2) API
cd ../moai-note-api
cp .env.example .env     # MOAI_NOTE_TOKEN_SECRET(32자 이상), MOAI_NOTE_CORS_ORIGINS 채우기
npm install
npm run client:add -- --name "<호스트 이름>"   # client_id/secret 발급 — 시크릿은 이때 한 번만 출력된다
npm run dev              # http://localhost:7100
```

| 명령 | 대상 | 내용 |
|---|---|---|
| `npm test` | 양쪽 | vitest — API 37개 / 에디터 22개 |
| `npm run typecheck` | editor-web | `tsc --noEmit` |
| `npm run build` | api | `tsc --noEmit` (API는 빌드 산출물이 없다 — 소스를 직접 실행) |
| `npm run client:list` / `client:revoke` | api | 클라이언트 조회·폐기 |

환경변수 전체는 [docs/architecture/overview.md §9](docs/architecture/overview.md)와
`moai-note-api/.env.example`에 있다. **비밀값은 커밋하지 않는다.**

## 문서

| 문서 | 내용 |
|---|---|
| [docs/architecture/overview.md](docs/architecture/overview.md) | ★시작점 — 구조·원칙·임베드 계약·배포·포트·환경변수 |
| [docs/architecture/modules/moai-note-api.md](docs/architecture/modules/moai-note-api.md) | 계층·요청 파이프라인·인증·저장 스키마·REST·MCP·오류 계약 |
| [docs/architecture/modules/moai-note-editor-web.md](docs/architecture/modules/moai-note-editor-web.md) | 번들 전략·격리·생명주기·마크다운 왕복·IME |
| [DEV_PROCESS.md](DEV_PROCESS.md) | 개발 표준 프로세스 — 산출물 5종(R/I/P/W/D)과 게이트 |
| [docs/requirements/active_development.md](docs/requirements/active_development.md) | 진행 대시보드 |
| [CLAUDE.md](CLAUDE.md) | AI 어시스턴트 작업 지침 |

요구사항 정본은 **이 저장소**의 `docs/requirements/`다. 외부 저장소를 참조하지 않는다.
