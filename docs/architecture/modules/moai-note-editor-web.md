# moai-note-editor-web

> 호스트 페이지에 직접 마운트되는 노션형 블록 에디터. 단일 파일 `embed.js`로 빌드된다.
> 상위 문서: [../overview.md](../overview.md) · 마지막 확인: 2026-07-28 (커밋 `f975855`)

| 항목 | 값 |
|---|---|
| 에디터 엔진 | TipTap 3 (`@tiptap/core`, `starter-kit`, `extension-list`, `extension-table`) |
| 번들러 | Vite 8 라이브러리 모드 → **IIFE 단일 파일** |
| 산출물 | `dist/embed.js` — 약 430KB(minify 후, gzip 전). CSS·의존성 전부 포함 |
| 전역 | `MoaiNote` 하나 (`mount`, `version`). default export 없음 |
| 외부 의존 | **없음** — `rollupOptions.external: []`. 호스트에 아무것도 요구하지 않는다 |
| 개발 | `npm run dev` → Vite 7110 포트, `demo/index.html` 자동 열기 |
| 검사 | `npm run typecheck`(tsc --noEmit) · `npm test`(vitest) |

## 1. 구조

```
src/
├ index.ts            공개 표면 — mount 와 version 만 내보낸다
├ mount.ts            ★ 생명주기 전부: Shadow root 생성 · 로드/저장 · 인스턴스 API
├ styles.css          Shadow root 안에 주입되는 스타일(?raw 로 문자열 import)
│
├ core/editor.ts      TipTap 인스턴스 구성 — 확장 화이트리스트 · 붙여넣기 정규화
├ markdown/
│  ├ parse.ts         마크다운 → TipTap JSON  (직접 구현)
│  └ serialize.ts     TipTap JSON → 마크다운  (직접 구현)
├ ui/
│  ├ chrome.ts        상단 바 · 제목 입력 · 본문 영역 · 버블/슬래시 컨테이너
│  ├ bubbleToolbar.ts 선택 시 뜨는 서식 툴바
│  └ slashMenu.ts     빈 줄에서 `/` — 블록 삽입 메뉴 (IME 안전장치 포함)
└ client/api.ts       moai-note-api 호출 · 401 재시도 · ApiError
demo/index.html       호스트 전역 리셋을 재현한 수동 검증 페이지
```

**의존 방향**: `mount` → (`core`, `ui`, `client`), `core` → `markdown`.
`ui`는 API를 모르고, `client`는 DOM을 모른다. 모듈 전역 상태는 없다 — 인스턴스 상태는 전부
`mount()`의 클로저에 있다(여러 인스턴스가 서로 간섭하지 않는 이유).

## 2. 번들 전략

호스트는 번들러 없는 vanilla JS 환경일 수 있다(SeedAI 챗봇 위젯이 그렇다). 그래서:

| 결정 | 이유 |
|---|---|
| IIFE 한 형식만 빌드 | `<script>` 한 줄로 붙어야 한다. ESM은 모듈 컨텍스트를 요구한다 |
| 의존성 externals 없음 | 호스트에 React·TipTap 설치를 요구하지 않는다 |
| CSS를 별도 파일로 빼지 않음 | Shadow root에는 `<link>`로 붙일 수 없다. `?raw` 문자열을 `<style>`로 주입한다 |
| named export만, default 없음 | 섞으면 IIFE 소비자가 `MoaiNote.default.mount`로 접근해야 한다 |
| `target: es2020` | 구형 브라우저 지원 하한 |

번들은 API 서버가 `/embed.js`로 제공한다 — 호스트에 복사하지 않는다([overview §7](../overview.md#7-배포기동)).

## 3. 공개 API

```html
<script src="https://<moai-note>/embed.js"></script>
<div id="note-1"></div>
<script>
  const inst = MoaiNote.mount('#note-1', {
    documentId: 'xxx',
    token: '<단기 토큰>',
    mode: 'edit',
    onTokenExpired: async () => (await fetch('/my-backend/note-token')).json().then(r => r.token),
  });
</script>
```

### `MoaiNote.mount(target, options) → Instance`

`target`은 CSS 선택자 또는 `HTMLElement`. `documentId`·`token`이 없으면 즉시 `throw`한다.

| 옵션 | 필수 | 기본값 | 설명 |
|---|:--:|---|---|
| `documentId` | ✅ | — | 표시할 문서. **호스트가 내용을 넘기지 않는다** |
| `token` | ✅ | — | 단기 액세스 토큰 |
| `apiBase` | | `embed.js`를 받은 오리진 | API 베이스 URL |
| `mode` | | `'read'` | `'read'` \| `'edit'` |
| `theme` | | `'auto'` | `'light'` \| `'dark'` \| `'auto'`(부모 배경 밝기로 판정) |
| `onSave` | | — | `(doc) => void` — 저장 성공 시 |
| `onError` | | — | `(err) => void` — 로드·저장 실패 시 |
| `onTokenExpired` | | — | `() => Promise<string>` — 401 시 새 토큰을 받아오는 훅 |

`apiBase` 기본값은 `document.currentScript.src`의 오리진이며, 그것이 없으면(비동기 로드 등)
`script[src*="embed.js"]`를 찾고, 그래도 없으면 `location.origin`을 쓴다.

### `Instance`

| 메서드 | 동작 |
|---|---|
| `destroy()` | 리스너 해제 → 에디터 파괴 → chrome 제거 → Shadow host 제거. 재호출은 무시 |
| `setMode(mode)` | 읽기/편집 전환. 읽기로 갈 때 미저장 변경이 있으면 상태줄에 경고 |
| `setToken(token)` | 토큰 교체 |
| `getContent()` | 현재 내용을 마크다운으로 |
| `reload()` | 서버에서 다시 불러온다 (충돌 후 최신본 확인용) |

> `reload()`는 I §3.2 표에 없는 **추가 메서드**다. 계약 문서를 갱신할 때 함께 반영한다.

## 4. 격리

### Shadow DOM

```
container (호스트 DOM)
└ div.moai-note-host  [data-theme=light|dark]
  └ #shadow-root (open)
     ├ <style>  styles.css 전문
     └ div.wrap [data-mode=read|edit]
        ├ div.bar     편집/저장 · 상태 · 복사 · 내려받기
        ├ input.title 제목
        ├ div.body    ← TipTap 이 여기에 붙는다
        ├ div.bubble  선택 서식 툴바 (absolute)
        └ div.slash   슬래시 메뉴 (absolute)
```

- Shadow root 안이라 `styles.css`는 태그 선택자를 자유롭게 써도 호스트를 오염시키지 않는다.
  반대로 호스트의 `* { margin: 0 }` 류 전역 리셋도 안으로 들어오지 못한다
- 호스트가 덮어쓸 수 있게 색·폰트·반경을 `:host`의 `--moai-note-*` CSS 변수로 노출한다
- 다크 테마는 `:host([data-theme='dark'])`에서 같은 변수를 재정의한다
- 전역 리스너를 두지 않는다. 유일하게 Shadow root에 거는 `mousedown`(버블 닫기)도
  `destroy()`에서 해제한다 — 등록·해제를 짝으로 맞춘다

### 검증 방법

`demo/index.html`은 호스트 CSS에 `* { box-sizing; margin; padding }`를 **일부러 넣어 둔다.**
격리가 깨지면 이 페이지에서 여백이 무너져 바로 드러난다. 마운트/해제 반복, 다중 인스턴스,
테마 전환, 토큰 교체도 이 페이지에서 확인한다.

## 5. 생명주기

```
mount()
 ├ 인자 검증 → Shadow host 생성 → <style> 주입 → 테마 판정
 ├ ApiClient 생성 (apiBase, token, onTokenExpired)
 ├ chrome 조립 (버튼 핸들러 연결)
 └ load()  ── GET /api/v1/documents/:id
      ├ 첫 로드: TipTap 인스턴스 생성 + 버블/슬래시 부착(detacher 배열에 적재)
      ├ 재로드 : 기존 인스턴스에 setContent
      └ 실패   : 상태줄에 오류 표시 + onError

save()  ── PUT (title, content, baseRevision = 현재 문서 revision)
 ├ 성공 : current 갱신 · dirty=false · '저장됨' · onSave
 └ 실패 : **편집 내용은 화면에 그대로 둔다**
          409면 "다른 곳에서 먼저 수정되었습니다(현재 rN)" 안내

destroy()
 └ detacher 전부 실행 → editor.destroy() → chrome.destroy() → host.remove()
```

로드가 끝나기 전에 `destroy()`가 불리면 응답을 버린다(`destroyed` 플래그) — 사라진 DOM에
내용을 그리지 않는다.

**자동 저장은 없다.** 저장은 저장 버튼 또는 `⌘S`/`Ctrl+S`로만 일어난다. 미저장 변경이 있으면
상태줄이 '편집 중'을 표시한다.

## 6. 편집 UI

| 요소 | 내용 |
|---|---|
| 상단 바 | 편집/읽기 토글 · 저장(편집 모드에서만 보임) · 상태 · 복사 · 내려받기 |
| 제목 | 별도 `input`. 읽기 모드에서는 `readOnly` |
| 버블 툴바 | 선택 시 위쪽에 뜬다. **B / I / S / `<>` / 링크 / 블록 종류 select** |
| 슬래시 메뉴 | 빈 줄에서 `/` — 제목1~3, 글머리·번호 목록, 체크리스트, 인용, 코드블록, 구분선, 표(3×3) |
| 단축키 | `⌘S`·`Ctrl+S` 저장. 그 밖 서식 단축키는 TipTap 기본 |
| 내보내기 | 복사(클립보드) · 내려받기(`<제목>.md` Blob) — 둘 다 마크다운 |

- 툴바 버튼은 `click`이 아니라 **`mousedown` + `preventDefault`**로 동작한다.
  클릭으로 선택이 풀리면 명령이 빈 범위에 적용된다
- 링크는 `http`/`https`만 허용한다 — `javascript:` 주소를 차단한다
- 버블·슬래시는 컨테이너 밖으로 나가지 않게 좌표를 가둔다. 아래 공간이 부족하면 위로 띄운다

### 한글 입력(IME) — 최우선 검증 항목

조합 중에는 `keydown`이 실제 입력과 어긋나게 들어온다. 그대로 두면 메뉴가 튀거나 조합이 끊긴다.

슬래시 메뉴는 세 겹으로 막는다.

1. `compositionstart`/`compositionend`로 조합 상태를 추적하고, `composing || e.isComposing`이면
   **핸들러가 즉시 반환**한다
2. `/`는 **빈 문단**(`selection.empty && parent.textContent === ''`)에서만 메뉴를 연다 —
   문장 중간의 슬래시는 그냥 문자다
3. 좌표는 문자가 실제로 입력된 뒤 잡아야 맞으므로 `setTimeout(show, 0)`으로 한 틱 미룬다

기능을 추가할 때마다 **조합 중 커서·되돌리기·서식 적용·슬래시 커맨드**가 깨지지 않는지 확인한다.

## 7. 마크다운 왕복

교환 형식은 마크다운 문자열 하나다. 파서·직렬화기를 **외부 라이브러리 없이 직접 구현**했다 —
파서가 지원하는 문법이 직렬화기보다 넓으면 왕복에서 내용이 손실되기 때문이다. 화이트리스트를
양쪽에 똑같이 두는 편이 통제하기 쉽다.

```
서버 마크다운 ──parseMarkdown──► TipTap JSON ──편집──► serializeToMarkdown ──► 서버
```

### 지원 문법 (양방향)

| 블록 | 표기 | 인라인 | 표기 |
|---|---|---|---|
| 제목 | `#` ~ `######` (메뉴는 1~3) | 굵게 | `**…**` |
| 문단 | 빈 줄로 구분 | 기울임 | `*…*` |
| 글머리 목록 | `- ` / `* ` | 취소선 | `~~…~~` |
| 번호 목록 | `1. ` | 코드 | `` `…` `` |
| 체크리스트 | `- [ ]` / `- [x]` | 링크 | `[텍스트](주소)` |
| 인용 | `> ` (중첩은 재귀 처리) | | |
| 코드블록 | ` ```lang ` | | |
| 구분선 | `---` / `***` / `___` | | |
| 표 | `\| … \|` + 구분선 행 | | |

TipTap 확장은 이 목록에 맞춰 켠다(`core/editor.ts`). 목록 밖 확장을 켜면 직렬화기가 처리하지
못해 왕복에서 내용이 사라진다.

### 이스케이프 규칙

과하게 이스케이프하면 본문이 지저분해지고(`습니다\.`), 모자라면 평범한 문장이 블록으로 되살아난다.
그래서 **파서가 실제로 해석하는 것만** 막는다.

- 인라인: `\` `` ` `` `*` `[` `]` 만 이스케이프. `_`는 강조로 쓰지 않으므로 건드리지 않는다(snake_case 보존)
- 줄 첫머리: `- `, `#`, `> `, `1. ` 로 시작하는 문단만 첫 글자를 이스케이프
- 코드 마크 안은 이스케이프하지 않는다
- 표 셀 안의 `|`는 `\|`로 — 구조가 깨지지 않게. 파서는 이스케이프되지 않은 `|`만 구분자로 본다

### 알려진 비대칭

| 항목 | 현재 동작 |
|---|---|
| **중첩 목록** | 직렬화는 들여쓰기로 표현하지만, **파서는 평평하게** 되돌린다. 왕복하면 한 단계로 펴진다 |
| 중첩 체크리스트 | `TaskItem`이 `nested: false`로 꺼져 있다 |
| 표 정렬(`:---:`) | 구분선으로 인식은 하지만 정렬 정보는 버린다. 항상 `---`로 다시 쓴다 |
| 이미지 | 지원하지 않는다 |
| 모르는 노드/마크 | 서식을 버리고 **텍스트만 살린다** — 내용이 사라지는 것보다 낫다 |

### 붙여넣기

`transformPastedHTML`이 `script`/`style`을 제거하고, 나머지는 **등록된 확장이 표현할 수 있는
노드만** 남는다 — 화이트리스트가 곧 정규화 규칙이다. 외부 문서의 인라인 스타일이 그대로 들어오지 않는다.

## 8. API 클라이언트

`client/api.ts`는 `getDocument` · `updateDocument` · `createDocument` 세 가지를 감싼다
(`createDocument`는 현재 UI에서 쓰지 않는다 — 호스트/에이전트가 문서를 만든다).

- 모든 요청에 `Authorization: Bearer <token>`, `Content-Type: application/json`
- 204는 본문 없이 통과, 그 밖 실패는 `{error:{code,message,…}}`를 `ApiError`로 변환.
  JSON이 아니면 `statusText`로 대체한다
- `ApiError.isConflict`(= `REVISION_CONFLICT`)와 `currentRevision`으로 충돌을 구분한다

### 토큰 만료 처리

```
요청 → 401 → onTokenExpired() → 새 토큰으로 **같은 요청 1회 재시도** (allowRetry=false 로 재귀 차단)
        훅이 없거나 실패 → ApiError → 상태줄 + onError, 편집 내용은 화면에 유지
```

편집 중 토큰이 만료됐다고 사용자의 입력이 사라져서는 안 된다 — 이 경로의 유일한 목적이다.

## 9. 테스트

```bash
npm test        # vitest run — 1 파일 / 22 테스트 (2026-07-28 전부 통과)
```

`test/roundtrip.test.ts`가 마크다운 왕복만 덮는다: 블록 10종, 인라인 6종, 서식 조합,
한글 보존, 표 셀 파이프, 특수문자 이스케이프, 복합 문서, 빈 문서.
왕복 검사는 `parse → serialize → parse → serialize`가 **두 번째부터 안정(fixed point)** 인지를 본다.

DOM이 필요한 영역(마운트·Shadow 격리·IME·버블/슬래시·`destroy()` 잔존물)은 자동 테스트가 없다.
`demo/index.html`로 수동 확인하며, 브라우저 환경 테스트(jsdom/Playwright)는 아직 도입하지 않았다.

## 10. 확장할 때 지켜야 할 것

- **문법을 늘릴 때는 파서·직렬화기·TipTap 확장 셋을 같은 커밋에서** 고치고 왕복 테스트를 추가한다.
  하나만 늘리면 왕복에서 내용이 사라진다
- 전역 선택자(`*`, `body`, 태그 단독 규칙 중 Shadow 밖으로 새는 것)와 전역 변수·전역 리스너를
  만들지 않는다. 새 리스너는 반드시 detacher를 `mount()`의 배열에 넣는다
- 색을 하드코딩하지 않는다 — `--moai-note-*` 변수로 노출해 호스트가 덮을 수 있게 한다
- 키 입력을 다루는 코드에는 **IME 조합 가드**를 먼저 넣는다
- API 계약이 바뀌면 `client/api.ts`와 [modules/moai-note-api.md](moai-note-api.md)를 함께 갱신한다
