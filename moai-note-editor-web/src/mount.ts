/**
 * 마운트 — Shadow DOM 안에 에디터를 만든다.
 *
 * 왜 Shadow DOM인가:
 *   호스트 CSS에 전역 리셋(`* { box-sizing; margin; padding }`)이 있으면 에디터 내부까지
 *   덮인다. 실제로 SeedAI 챗봇 위젯 CSS가 그렇다. Shadow 경계가 양방향을 모두 막는다.
 *
 * 인스턴스 상태는 전부 클로저에 둔다 — 모듈 전역을 쓰면 여러 인스턴스가 서로 간섭한다.
 */
import type { Editor } from '@tiptap/core';
import { createEditor, getMarkdown, setMarkdown } from './core/editor.ts';
import { ApiClient, ApiError, type DocumentDto } from './client/api.ts';
import { attachBubbleToolbar } from './ui/bubbleToolbar.ts';
import { attachSlashMenu } from './ui/slashMenu.ts';
import { buildChrome, type Chrome } from './ui/chrome.ts';
import EDITOR_CSS from './styles.css?raw';

export type Mode = 'read' | 'edit';
export type Theme = 'light' | 'dark' | 'auto';

export interface MountOptions {
  documentId: string;
  token: string;
  apiBase?: string;
  mode?: Mode;
  theme?: Theme;
  onSave?: (doc: DocumentDto) => void;
  onError?: (err: unknown) => void;
  onTokenExpired?: () => Promise<string>;
}

export interface Instance {
  destroy(): void;
  setMode(mode: Mode): void;
  setToken(token: string): void;
  getContent(): string;
  reload(): Promise<void>;
}

/** 스크립트를 받아온 오리진을 API 기본값으로 쓴다 */
function defaultApiBase(): string {
  const current = document.currentScript as HTMLScriptElement | null;
  const src = current?.src ?? findOwnScriptSrc();
  if (src) {
    try {
      return new URL(src).origin;
    } catch {
      /* 무시 */
    }
  }
  return window.location.origin;
}

function findOwnScriptSrc(): string | undefined {
  const scripts = Array.from(document.querySelectorAll('script[src]'));
  return scripts.map((s) => (s as HTMLScriptElement).src).find((s) => s.includes('embed.js'));
}

function resolveTheme(theme: Theme, host: HTMLElement): 'light' | 'dark' {
  if (theme !== 'auto') return theme;
  // 호스트 배경 밝기로 판정한다 — 호스트가 다크면 에디터도 다크.
  const bg = getComputedStyle(host.parentElement ?? document.body).backgroundColor;
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
  if (!m) return 'light';
  const luminance =
    (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) / 255;
  return luminance < 0.5 ? 'dark' : 'light';
}

export function mount(
  target: string | HTMLElement,
  options: MountOptions,
): Instance {
  const container =
    typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
  if (!container) throw new Error(`마운트 대상을 찾을 수 없습니다: ${String(target)}`);
  if (!options.documentId) throw new Error('documentId 는 필수입니다.');
  if (!options.token) throw new Error('token 은 필수입니다.');

  const host = document.createElement('div');
  host.className = 'moai-note-host';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = EDITOR_CSS;
  shadow.appendChild(style);

  host.setAttribute('data-theme', resolveTheme(options.theme ?? 'auto', container));
  container.appendChild(host);

  const api = new ApiClient({
    baseUrl: options.apiBase ?? defaultApiBase(),
    token: options.token,
    ...(options.onTokenExpired ? { onTokenExpired: options.onTokenExpired } : {}),
  });

  let mode: Mode = options.mode ?? 'read';
  let editor: Editor | undefined;
  let current: DocumentDto | undefined;
  let dirty = false;
  let destroyed = false;

  const chrome: Chrome = buildChrome(shadow, {
    onToggleMode: () => instance.setMode(mode === 'read' ? 'edit' : 'read'),
    onSave: () => void save(),
    onCopy: () => void copyMarkdown(),
    onDownload: () => downloadMarkdown(),
  });

  const detachers: Array<() => void> = [];

  function setStatus(text: string, isError = false): void {
    chrome.setStatus(text, isError);
  }

  function reportError(err: unknown): void {
    const message =
      err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
    setStatus(message, true);
    options.onError?.(err);
  }

  async function load(): Promise<void> {
    setStatus('불러오는 중…');
    try {
      const doc = await api.getDocument(options.documentId);
      if (destroyed) return;
      current = doc;
      chrome.setTitle(doc.title);
      if (editor) {
        setMarkdown(editor, doc.content);
      } else {
        editor = createEditor({
          element: chrome.body,
          markdown: doc.content,
          editable: mode === 'edit',
          onUpdate: () => {
            dirty = true;
            setStatus('편집 중');
          },
          onSelectionUpdate: () => chrome.refreshBubble(),
        });
        detachers.push(attachBubbleToolbar(shadow, chrome, () => editor));
        detachers.push(attachSlashMenu(shadow, chrome, () => editor));
      }
      dirty = false;
      setStatus('');
    } catch (err) {
      reportError(err);
    }
  }

  async function save(): Promise<void> {
    if (!editor || !current) return;
    setStatus('저장 중…');
    try {
      const doc = await api.updateDocument(current.id, {
        title: chrome.getTitle() || current.title,
        content: getMarkdown(editor),
        baseRevision: current.revision,
      });
      current = doc;
      dirty = false;
      setStatus('저장됨');
      options.onSave?.(doc);
    } catch (err) {
      // 충돌이든 통신 실패든 **편집 내용은 화면에 그대로 둔다**.
      if (err instanceof ApiError && err.isConflict) {
        setStatus(
          `다른 곳에서 먼저 수정되었습니다(현재 r${err.currentRevision ?? '?'}). 새로고침 후 다시 반영하세요.`,
          true,
        );
      }
      reportError(err);
    }
  }

  async function copyMarkdown(): Promise<void> {
    if (!editor) return;
    try {
      await navigator.clipboard.writeText(getMarkdown(editor));
      setStatus('복사됨');
    } catch (err) {
      reportError(err);
    }
  }

  function downloadMarkdown(): void {
    if (!editor) return;
    const blob = new Blob([getMarkdown(editor)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${chrome.getTitle() || 'document'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const instance: Instance = {
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      for (const detach of detachers) detach();
      detachers.length = 0;
      editor?.destroy();
      editor = undefined;
      chrome.destroy();
      host.remove();
    },

    setMode(next: Mode): void {
      mode = next;
      chrome.setMode(next);
      editor?.setEditable(next === 'edit');
      if (next === 'read' && dirty) setStatus('저장하지 않은 변경이 있습니다.', true);
    },

    setToken(token: string): void {
      api.setToken(token);
    },

    getContent(): string {
      return editor ? getMarkdown(editor) : '';
    },

    reload(): Promise<void> {
      return load();
    },
  };

  chrome.setMode(mode);
  void load();

  return instance;
}
