/**
 * 에디터 껍데기 — 상단 바 + 본문 영역 + 버블/슬래시 컨테이너.
 *
 * 모든 요소는 Shadow root 안에 만든다.
 */

export interface ChromeHandlers {
  onToggleMode: () => void;
  onSave: () => void;
  onCopy: () => void;
  onDownload: () => void;
}

export interface Chrome {
  wrap: HTMLElement;
  body: HTMLElement;
  bubble: HTMLElement;
  slash: HTMLElement;
  setMode(mode: 'read' | 'edit'): void;
  setStatus(text: string, isError?: boolean): void;
  setTitle(title: string): void;
  getTitle(): string;
  refreshBubble(): void;
  onBubbleRefresh(fn: () => void): void;
  destroy(): void;
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

export function buildChrome(root: ShadowRoot, handlers: ChromeHandlers): Chrome {
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.setAttribute('data-mode', 'read');

  // ── 상단 바 ──
  const bar = document.createElement('div');
  bar.className = 'bar';

  const editBtn = button('편집', '읽기/편집 전환', handlers.onToggleMode);
  const saveBtn = button('저장', '저장 (⌘S)', handlers.onSave);
  const spacer = document.createElement('div');
  spacer.className = 'spacer';
  const status = document.createElement('span');
  status.className = 'status';
  const copyBtn = button('복사', '마크다운 복사', handlers.onCopy);
  const downloadBtn = button('내려받기', '마크다운 파일로 저장', handlers.onDownload);

  bar.append(editBtn, saveBtn, spacer, status, copyBtn, downloadBtn);

  // 제목은 상단 바 아래 별도 줄에 둔다
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'title';
  titleInput.placeholder = '제목';
  titleInput.style.cssText =
    'width:100%;padding:12px 20px 0;font:inherit;font-size:1.5em;font-weight:700;' +
    'color:inherit;background:transparent;border:0;outline:none;';

  const body = document.createElement('div');
  body.className = 'body';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  const slash = document.createElement('div');
  slash.className = 'slash';

  wrap.append(bar, titleInput, body, bubble, slash);
  root.appendChild(wrap);

  let bubbleRefresh: () => void = () => {};

  // ⌘S / Ctrl+S 로 저장
  const onKeyDown = (e: KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      handlers.onSave();
    }
  };
  wrap.addEventListener('keydown', onKeyDown);

  return {
    wrap,
    body,
    bubble,
    slash,

    setMode(mode) {
      wrap.setAttribute('data-mode', mode);
      editBtn.textContent = mode === 'edit' ? '읽기' : '편집';
      editBtn.setAttribute('aria-pressed', String(mode === 'edit'));
      saveBtn.style.display = mode === 'edit' ? '' : 'none';
      titleInput.readOnly = mode !== 'edit';
      if (mode === 'read') bubble.classList.remove('open');
    },

    setStatus(text, isError = false) {
      status.textContent = text;
      status.classList.toggle('error', isError);
    },

    setTitle(title) {
      titleInput.value = title;
    },

    getTitle() {
      return titleInput.value.trim();
    },

    refreshBubble() {
      bubbleRefresh();
    },

    onBubbleRefresh(fn) {
      bubbleRefresh = fn;
    },

    destroy() {
      wrap.removeEventListener('keydown', onKeyDown);
      wrap.remove();
    },
  };
}
