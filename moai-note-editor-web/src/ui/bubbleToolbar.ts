/**
 * 버블 툴바 — 텍스트를 선택하면 근처에 뜬다 (R F-003).
 */
import type { Editor } from '@tiptap/core';
import type { Chrome } from './chrome.ts';

type GetEditor = () => Editor | undefined;

interface BlockOption {
  label: string;
  apply: (editor: Editor) => void;
  active: (editor: Editor) => boolean;
}

const BLOCK_OPTIONS: BlockOption[] = [
  {
    label: '본문',
    apply: (e) => e.chain().focus().setParagraph().run(),
    active: (e) => e.isActive('paragraph'),
  },
  {
    label: '제목 1',
    apply: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    active: (e) => e.isActive('heading', { level: 1 }),
  },
  {
    label: '제목 2',
    apply: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    active: (e) => e.isActive('heading', { level: 2 }),
  },
  {
    label: '제목 3',
    apply: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    active: (e) => e.isActive('heading', { level: 3 }),
  },
  {
    label: '글머리 목록',
    apply: (e) => e.chain().focus().toggleBulletList().run(),
    active: (e) => e.isActive('bulletList'),
  },
  {
    label: '번호 목록',
    apply: (e) => e.chain().focus().toggleOrderedList().run(),
    active: (e) => e.isActive('orderedList'),
  },
  {
    label: '체크리스트',
    apply: (e) => e.chain().focus().toggleTaskList().run(),
    active: (e) => e.isActive('taskList'),
  },
];

export function attachBubbleToolbar(
  root: ShadowRoot,
  chrome: Chrome,
  getEditor: GetEditor,
): () => void {
  const { bubble } = chrome;

  const mkMark = (
    label: string,
    title: string,
    run: (e: Editor) => void,
    isActive: (e: Editor) => boolean,
  ): { el: HTMLButtonElement; sync: (e: Editor) => void } => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'btn';
    el.textContent = label;
    el.title = title;
    el.addEventListener('mousedown', (ev) => {
      // 클릭으로 선택이 풀리면 명령이 빈 범위에 적용된다
      ev.preventDefault();
      const editor = getEditor();
      if (editor) run(editor);
    });
    return {
      el,
      sync: (e) => el.setAttribute('aria-pressed', String(isActive(e))),
    };
  };

  const bold = mkMark('B', '굵게 (⌘B)', (e) => e.chain().focus().toggleBold().run(), (e) =>
    e.isActive('bold'),
  );
  const italic = mkMark('I', '기울임 (⌘I)', (e) => e.chain().focus().toggleItalic().run(), (e) =>
    e.isActive('italic'),
  );
  const strike = mkMark('S', '취소선', (e) => e.chain().focus().toggleStrike().run(), (e) =>
    e.isActive('strike'),
  );
  const code = mkMark('<>', '인라인 코드', (e) => e.chain().focus().toggleCode().run(), (e) =>
    e.isActive('code'),
  );

  const linkBtn = document.createElement('button');
  linkBtn.type = 'button';
  linkBtn.className = 'btn';
  linkBtn.textContent = '링크';
  linkBtn.title = '링크';
  linkBtn.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    const editor = getEditor();
    if (!editor) return;
    const previous = String(editor.getAttributes('link').href ?? '');
    const href = window.prompt('링크 주소', previous);
    if (href === null) return;
    if (href === '') {
      editor.chain().focus().unsetLink().run();
      return;
    }
    // http/https 만 허용 — javascript: 주소를 막는다
    if (!/^https?:\/\//i.test(href)) {
      window.alert('http 또는 https 주소만 사용할 수 있습니다.');
      return;
    }
    editor.chain().focus().setLink({ href }).run();
  });

  const blockSelect = document.createElement('select');
  blockSelect.title = '블록 종류';
  for (const [index, option] of BLOCK_OPTIONS.entries()) {
    const opt = document.createElement('option');
    opt.value = String(index);
    opt.textContent = option.label;
    blockSelect.appendChild(opt);
  }
  blockSelect.addEventListener('change', () => {
    const editor = getEditor();
    const option = BLOCK_OPTIONS[Number(blockSelect.value)];
    if (editor && option) option.apply(editor);
  });

  bubble.append(bold.el, italic.el, strike.el, code.el, linkBtn, blockSelect);

  function place(): void {
    const editor = getEditor();
    if (!editor || !editor.isEditable) {
      bubble.classList.remove('open');
      return;
    }

    const { from, to } = editor.state.selection;
    if (from === to) {
      bubble.classList.remove('open');
      return;
    }

    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);
    const wrapRect = chrome.wrap.getBoundingClientRect();

    bubble.classList.add('open');
    const bubbleRect = bubble.getBoundingClientRect();

    const centerX = (start.left + end.right) / 2 - wrapRect.left;
    // 좁은 폭에서 컨테이너 밖으로 나가지 않도록 가둔다
    const maxLeft = wrapRect.width - bubbleRect.width - 8;
    const left = Math.max(8, Math.min(centerX - bubbleRect.width / 2, Math.max(8, maxLeft)));
    const top = Math.max(4, start.top - wrapRect.top - bubbleRect.height - 8);

    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;

    for (const item of [bold, italic, strike, code]) item.sync(editor);
    const activeIndex = BLOCK_OPTIONS.findIndex((o) => o.active(editor));
    blockSelect.value = String(activeIndex >= 0 ? activeIndex : 0);
  }

  chrome.onBubbleRefresh(place);

  const onDocMouseDown = (e: Event): void => {
    if (!bubble.contains(e.target as Node)) bubble.classList.remove('open');
  };
  root.addEventListener('mousedown', onDocMouseDown);

  return () => {
    root.removeEventListener('mousedown', onDocMouseDown);
    chrome.onBubbleRefresh(() => {});
    bubble.replaceChildren();
  };
}
