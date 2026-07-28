# CLAUDE — moai-note

이 문서는 AI 어시스턴트가 이 프로젝트에서 작업할 때 따라야 할 지침입니다.

---

## 프로젝트 개요

**moai-note**는 노션형 블록 에디터와 그 저장 백엔드입니다.
**호스트 페이지에 임베드해서 쓰는 독립 제품**입니다.

| 모듈 | 스택 | 역할 |
|------|------|------|
| `moai-note-editor-web` | TypeScript + TipTap(ProseMirror) + Vite | 에디터. 단일 번들(JS+CSS)로 빌드 |
| `moai-note-api` | TypeScript + Node (포트 **7100**) | 문서 저장 + 토큰 발급 + REST + MCP |

저장소는 **SQLite**(파일 기반)입니다.

**아키텍처 시작점**: [docs/architecture/overview.md](docs/architecture/overview.md)

---

## 절대 원칙 (MANDATORY)

아래 네 가지는 어떤 이유로도 타협하지 않습니다.

### 1. 이 프로젝트는 SeedAI에 의존하지 않는다

첫 소비자가 SeedAI 챗봇 위젯이지만, **SeedAI는 여러 호스트 중 하나일 뿐**입니다.

- ❌ Keycloak, SeedAI DB, SeedAI 설정·용어·엔드포인트 참조
- ❌ 호스트 종속 분기 (`if (host === 'seedai')`)
- ✅ 인증·저장·설정을 자체 보유

호스트 연동에 필요한 값은 **설정과 계약**으로만 받습니다.

### 2. 인증 관문은 하나다

REST와 MCP가 **같은 관문**을 지납니다.

- ❌ MCP만 인증을 우회하는 구성, 표면별 인증 구현
- ✅ 모든 요청이 `auth/` 한 곳을 통과

> **배경**: SeedAI에서 MCP `/http`를 무인증(`permitAll`)으로 열어둔 사례가 미해결 부채로 남아 있습니다.
> 같은 구조를 새로 만들지 마십시오.

### 3. 로직은 service 계층에만 둔다

REST 컨트롤러와 MCP 도구는 **입출력 변환만** 합니다.

- ❌ MCP 도구가 REST를 HTTP로 재호출
- ❌ 컨트롤러가 storage를 직접 호출
- ✅ 두 표면이 같은 service 함수를 호출

REST와 MCP의 동작이 갈라지면 안 됩니다.

### 4. 시크릿은 브라우저에 두지 않는다

`client_secret`은 **서버 간 호출 전용**입니다. 브라우저는 단기 토큰만 갖습니다.

```
[호스트 백엔드] ──client_id + client_secret + 사용자식별자──► moai-note-api
                ◄──────────── 단기 액세스 토큰 ─────────────
      │  단기 토큰만 전달
      ▼
  [브라우저]  ──Bearer 단기 토큰──►  REST
  [에이전트]  ──Bearer 단기 토큰──►  MCP
```

문서 소유권은 **토큰에서 얻은** 식별자로만 판정합니다. 클라이언트가 보낸 소유자 값은 신뢰하지 않습니다.

---

## 에디터 작성 규칙 (MANDATORY)

### 프레임워크 비의존

호스트는 번들러 없는 vanilla JS 환경일 수 있습니다(SeedAI 챗봇 위젯이 그렇습니다).

- ❌ 호스트에 React 등 런타임을 요구하는 번들
- ✅ 전역 진입점 하나로 즉시 사용 가능한 단일 번들

### 스타일 격리

- 클래스·CSS 변수에 **`moai-note-` 접두사**를 붙입니다
- **전역 선택자(`*`, `body`, 태그 선택자) 금지** — 호스트를 오염시킵니다
- 색상은 하드코딩하지 않고 CSS 변수로 노출해 호스트가 덮어쓸 수 있게 합니다

### 생명주기

- 해제(destroy) 시 DOM·이벤트·리스너가 남지 않아야 합니다
- 한 페이지에 여러 인스턴스가 공존해도 서로 간섭하지 않아야 합니다

### 한글 입력(IME)

**최우선 검증 항목입니다.** 기능을 추가할 때마다 조합 중 커서·되돌리기·서식 적용·슬래시 커맨드가
깨지지 않는지 확인하십시오.

---

## 임베드·배포 규칙 (MANDATORY)

### JS 임베드 — iframe 아님

호스트 DOM에 직접 마운트합니다.

```html
<script src="https://<moai-note>/embed.js"></script>
<div id="note-1"></div>
<script>
  MoaiNote.mount('#note-1', { documentId: 'xxx', token: '<단기토큰>' });
</script>
```

- 호스트는 **내용을 넘기지 않습니다** — `documentId`로 API에서 불러옵니다
- 문서 정본은 moai-note에 있습니다. 호스트는 참조만 갖습니다

### Shadow DOM 필수

호스트 CSS 전역 리셋(`* { box-sizing; margin; padding }`)이 에디터 내부를 덮는 것을 막습니다.
반대 방향 오염도 막습니다. **에디터 UI는 Shadow root 안에서만 생성하십시오.**

### 배포 — 호스트에 복사하지 않는다

`embed.js`는 **API 서버가 정적 제공**합니다.

```
moai-note-editor-web/dist/  ──►  moai-note-api 가 /embed.js 로 제공
```

- ❌ 호스트 `public/`에 번들을 복사해 두는 방식 — API 계약이 바뀌면 호스트를 전부 재배포해야 하고,
  누락 시 구버전 에디터가 신버전 API를 호출해 조용히 깨집니다
- ✅ 서버 갱신만으로 모든 호스트에 반영

---

## 개발 표준 프로세스 (MUST READ)

- 모든 요구사항 처리는 [DEV_PROCESS.md](DEV_PROCESS.md)의 표준을 따릅니다.
- 원칙: **프로세스와 도구는 자유, 산출물은 계약** — 산출물 5종(R 요구사항 / I 인터페이스 계약 /
  P 모듈별 플랜 / W 검증 보고 / D 대시보드)의 스키마·위치·상호 링크·상태 규약을 준수하십시오.
- 코드 작업 착수 전 해당 요구사항의 R 문서와 상태(게이트)를 확인하고,
  완료 처리는 반드시 W(검증 보고) 작성을 거쳐야 합니다.

### 작업 시작 전 확인할 문서

- [docs/requirements/README.md](docs/requirements/README.md) — 요구사항 관리 가이드
- [docs/requirements/active_development.md](docs/requirements/active_development.md) — 진행 대시보드(D)
- `docs/requirements/[YYYYMMDD-HHMMSS-코드]_제목_req.md` — 개별 요구사항 명세서(R).
  산출물(I/P/W)은 같은 디렉토리에 **동일 프리픽스**로 응집됩니다
  (`_interface-design` / `-<모듈>_dev-plan` / `-<모듈>_walkthrough`)
- `docs/requirements/templates/` — R 작성 템플릿 (simple/standard/complex)
- 완료된 요구사항은 `docs/requirements/archive/<YYYY>/<MM>/W<N>/`에 보관됩니다

### 요구사항 규모 (Scale)

| 규모 | 적합한 작업 | 템플릿 |
|------|-------------|--------|
| **simple** (간단) | 버그 수정, 오타 수정, 소규모 변경 | ~50줄 |
| **standard** (표준) | 일반 기능 개발, API 추가 [기본값] | ~150줄 |
| **complex** (복잡) | 대규모 기능, 아키텍처 변경, 마이그레이션 | ~400줄 |

### 명령어

```bash
/dev req <name> --scale=complex        # 요구사항 생성
/dev req <name> --type=bug             # 유형 지정 (feature|enhance|perf|bug)
/dev artifact <i|p|w> [--module=<모듈>]  # 산출물(I/P/W)을 동일 프리픽스로 생성
/dev status                            # 진행 상황 리포트
/dev validate                          # 산출물 규약 검사
/dev archive --req=<ID>                # 완료 세트를 archive/로 이동
```

### AI 어시스턴트 필수 지침 (MANDATORY)

- 게이트 통과 조건·금지 사항의 정본은 [DEV_PROCESS.md](DEV_PROCESS.md)입니다 —
  **게이트 체크리스트(G1~G5)**, **금지 사항(R 없이 코드 작업 착수 금지 등)** 을 반드시 따르십시오.
- 각 게이트(G1 기능 확정, G2 인터페이스 승인)는 **사용자 승인 지점**입니다 —
  승인 없이 다음 산출물로 넘어가지 마십시오.

---

## 아키텍처 문서

**시작점은 [docs/architecture/overview.md](docs/architecture/overview.md)** 입니다.

```
docs/architecture/
├── overview.md        # ★시작점 — 구조·설계 원칙·임베드 계약·배포·포트·환경변수
└── modules/
    ├── moai-note-api.md          # 계층·요청 파이프라인·인증·저장 스키마·REST·MCP·오류 계약
    └── moai-note-editor-web.md   # 번들 전략·격리·생명주기·마크다운 왕복·IME·API 클라이언트
```

모듈별 상세 문서는 모듈이 실제로 구현된 뒤 `docs/architecture/modules/`에 추가합니다.
**빈 문서를 미리 만들지 마십시오.**

**정본 갱신 의무**: 코드 변경이 구조에 영향을 주면 W(검증 보고) 작성 시점에
`docs/architecture/`를 함께 갱신해야 합니다.

사실값(포트·경로·구성)은 **코드 확인 후** 기재합니다 — 추측으로 쓰지 마십시오.

---

## 환경 변수

비밀값은 **환경변수 전용**입니다. 저장소에 커밋하지 마십시오.

아래는 `moai-note-api/src/config.ts` 기준 **구현 확정값**입니다 (2026-07-28 확인).
전체 설명은 [docs/architecture/overview.md §9](docs/architecture/overview.md)를 보십시오.

| 변수 | 필수 | 기본값 | 용도 |
|------|:----:|--------|------|
| `MOAI_NOTE_TOKEN_SECRET` | ✅ | — | 토큰 서명 비밀키(HS256). 32자 미만이면 기동 실패 |
| `MOAI_NOTE_CORS_ORIGINS` | ✅ | 빈 값 | 허용 오리진 화이트리스트 (쉼표 구분). `*` 금지 |
| `MOAI_NOTE_PORT` | | `7100` | API 포트 |
| `MOAI_NOTE_HOST` | | `0.0.0.0` | 수신 주소 |
| `MOAI_NOTE_DB_PATH` | | `./data/moai-note.db` | SQLite 파일 경로 |
| `MOAI_NOTE_TOKEN_TTL` | | `3600` | 액세스 토큰 만료(초) |
| `MOAI_NOTE_TLS_CERT` / `MOAI_NOTE_TLS_KEY` | | 없음 | HTTPS 인증서 경로. 하나만 설정하면 기동 실패 |
| `MOAI_NOTE_MAX_CONTENT_BYTES` | | `1000000` | 본문 상한(바이트) |
| `MOAI_NOTE_MAX_TITLE_LENGTH` | | `300` | 제목 상한(문자) |
| `MOAI_NOTE_MAX_REVISIONS` | | `50` | 문서당 리비전 보관 개수 |
| `MOAI_NOTE_EMBED_BUNDLE` | | `../moai-note-editor-web/dist/embed.js` | `/embed.js`로 제공할 번들 |
| `MOAI_NOTE_RATE_LIMIT_MAX` / `_WINDOW` | | `300` / `1 minute` | 요청 빈도 제한 |
| `MOAI_NOTE_LOG_LEVEL` | | `info` | 로그 레벨 |

> 템플릿은 `moai-note-api/.env.example` 입니다. 변수를 추가·변경하면 이 표와
> `.env.example`, `docs/architecture/overview.md`를 함께 갱신하십시오.

---

## Git 커밋 규칙

```
<type>(<scope>): <subject>

<body>
```

**타입**: `feat` 새 기능 / `fix` 버그 수정 / `docs` 문서 / `style` 포맷팅 /
`refactor` 리팩토링 / `test` 테스트 / `chore` 빌드·설정

**스코프**: `editor`, `api`, `auth`, `mcp`, `storage`, `build`

```
feat(auth): 클라이언트 토큰 발급 엔드포인트 추가

- client_secret 교환으로 단기 액세스 토큰 발급
- REST·MCP 공통 검증 관문에 연결
```

---

## 관련 외부 저장소

| 저장소 | 관계 |
|--------|------|
| SeedAI (`~/Documents/Dev/SeedAI`) | 첫 소비자. 챗봇 위젯 `seed-ai-agent-client-web-ui`가 에디터를 임베드 |

**이 프로젝트는 SeedAI를 참조하지 않습니다.** 위 저장소는 호스트 연동 시 참고용일 뿐이며,
코드에 SeedAI 종속을 만들지 마십시오(절대 원칙 1).
