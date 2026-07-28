/**
 * 슬래시 커맨드 — 빈 줄에서 `/` 를 누르면 블록 삽입 메뉴가 뜬다 (R F-004).
 *
 * ⚠️ 한글 입력(IME) 조합 중에는 열지 않는다.
 *    조합 중에는 keydown 이 실제 입력과 어긋나게 들어와, 메뉴가 튀거나
 *    조합이 끊긴다. compositionstart/end 로 상태를 추적해 그 구간을 피한다.
 */
import type { Editor } from '@tiptap/core';
import type { Chrome } from './chrome.ts';

type GetEditor = () => Editor | undefined;

interface SlashItem {
  label: string;
  run: (editor: Editor) => void;
}

const ITEMS: SlashItem[] = [
  { label: '제목 1', run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { label: '제목 2', run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { label: '제목 3', run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { label: '글머리 목록', run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: '번호 목록', run: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: '체크리스트', run: (e) => e.chain().focus().toggleTaskList().run() },
  { label: '인용', run: (e) => e.chain().focus().toggleBlockquote().run() },
  { label: '코드블록', run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { label: '구분선', run: (e) => e.chain().focus().setHorizontalRule().run() },
  {
    label: '표 (3×3)',
    run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
];

export function attachSlashMenu(
  root: ShadowRoot,
  chrome: Chrome,
  getEditor: GetEditor,
): () => void {
  const { slash } = chrome;

  let open = false;
  let selected = 0;
  let composing = false;
  let filter = '';

  const rows: HTMLElement[] = ITEMS.map((item, index) => {
    const el = document.createElement('div');
    el.className = 'slash-item';
    el.textContent = item.label;
    el.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      choose(index);
    });
    return el;
  });
  slash.append(...rows);

  function visibleIndexes(): number[] {
    const q = filter.trim().toLowerCase();
    return ITEMS.map((item, i) => (q === '' || item.label.toLowerCase().includes(q) ? i : -1))
      .filter((i) => i >= 0);
  }

  function render(): void {
    const visible = visibleIndexes();
    rows.forEach((el, i) => {
      const isVisible = visible.includes(i);
      el.style.display = isVisible ? '' : 'none';
      el.setAttribute('aria-selected', String(i === selected));
    });
    if (!visible.includes(selected)) selected = visible[0] ?? 0;
  }

  function show(): void {
    const editor = getEditor();
    if (!editor || !editor.isEditable) return;

    const coords = editor.view.coordsAtPos(editor.state.selection.from);
    const wrapRect = chrome.wrap.getBoundingClientRect();

    open = true;
    selected = 0;
    filter = '';
    slash.classList.add('open');
    render();

    const rect = slash.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(coords.left - wrapRect.left, Math.max(8, wrapRect.width - rect.width - 8)),
    );
    // 아래 공간이 부족하면 위로 띄운다
    const belowTop = coords.bottom - wrapRect.top + 6;
    const top =
      belowTop + rect.height > wrapRect.height
        ? Math.max(4, coords.top - wrapRect.top - rect.height - 6)
        : belowTop;

    slash.style.left = `${left}px`;
    slash.style.top = `${top}px`;
  }

  function hide(): void {
    open = false;
    filter = '';
    slash.classList.remove('open');
  }

  function choose(index: number): void {
    const editor = getEditor();
    const item = ITEMS[index];
    if (!editor || !item) return;

    // 입력했던 "/필터" 를 지운다
    const to = editor.state.selection.from;
    const from = Math.max(0, to - (filter.length + 1));
    editor.chain().focus().deleteRange({ from, to }).run();

    item.run(editor);
    hide();
  }

  const onCompositionStart = (): void => {
    composing = true;
  };
  const onCompositionEnd = (): void => {
    composing = false;
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    // 조합 중에는 절대 관여하지 않는다
    if (composing || e.isComposing) return;

    const editor = getEditor();
    if (!editor || !editor.isEditable) return;

    if (!open) {
      if (e.key === '/') {
        // 빈 줄에서만 연다 — 문장 중간의 슬래시는 그냥 문자다
        const { $from, empty } = editor.state.selection;
        if (empty && $from.parent.textContent === '') {
          // 문자가 입력된 뒤 위치를 잡아야 좌표가 맞는다
          setTimeout(show, 0);
        }
      }
      return;
    }

    const visible = visibleIndexes();
    const pos = visible.indexOf(selected);

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selected = visible[(pos + 1) % visible.length] ?? selected;
        render();
        break;
      case 'ArrowUp':
        e.preventDefault();
        selected = visible[(pos - 1 + visible.length) % visible.length] ?? selected;
        render();
        break;
      case 'Enter':
        e.preventDefault();
        choose(selected);
        break;
      case 'Escape':
        e.preventDefault();
        hide();
        break;
      case 'Backspace':
        if (filter === '') hide();
        else {
          filter = filter.slice(0, -1);
          render();
        }
        break;
      default:
        if (e.key.length === 1) {
          filter += e.key;
          render();
        }
        break;
    }
  };

  const onBlur = (): void => hide();

  const target = chrome.body;
  target.addEventListener('keydown', onKeyDown, true);
  target.addEventListener('compositionstart', onCompositionStart);
  target.addEventListener('compositionend', onCompositionEnd);
  target.addEventListener('focusout', onBlur);

  return () => {
    target.removeEventListener('keydown', onKeyDown, true);
    target.removeEventListener('compositionstart', onCompositionStart);
    target.removeEventListener('compositionend', onCompositionEnd);
    target.removeEventListener('focusout', onBlur);
    slash.replaceChildren();
  };
}
