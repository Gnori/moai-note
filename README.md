# moai-note

노션형 블록 에디터. **호스트 페이지에 임베드해서 쓰는 산출물**이다.

첫 소비자는 SeedAI 챗봇 위젯(`seed-ai-agent-client-web-ui`)이며, 대화 안에서 문서를
보고 바로 편집하는 용도로 쓴다.

## 구성

| 디렉토리 | 내용 |
|---|---|
| `moai-note-editor-web/` | 에디터 본체 (npm 프로젝트). 빌드 산출물 `dist/`를 호스트가 가져다 쓴다 |
| `docs/architecture/` | 구조·확장 포인트·임베드 계약 |
| `docs/requirements/` | 요구사항 산출물 (R/I/P/W) |
| `scripts/` | 빌드 산출물을 호스트로 배포하는 스크립트 |

모듈은 필요해질 때 형제 디렉토리로 추가한다(`moai-note-api`, `moai-note-convert` 등).
지금은 임베드 가능한 에디터 하나만 필요하다.

## 배포 방식

npm 레지스트리에 올리지 않는다. **`dist/`를 호스트의 정적 자산 경로로 복사**한다 —
챗봇 위젯이 이미 같은 방식으로 배포된다(`sync-copies.sh`).

```
moai-note-editor-web/dist/  ──복사──►  <호스트>/public/moai/note/
```

원본만 고치면 호스트 화면에 반영되지 않는다. 반드시 배포 스크립트를 실행할 것.

## 관련 문서

- 요구사항 정본: SeedAI 저장소 `docs/requirements/` — 이 프로젝트는 **외부 저장소**로 취급되며
  변경분은 별도 커밋/PR로 관리한다.
