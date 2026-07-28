/**
 * TipTap 에디터 인스턴스 구성.
 *
 * 지원 블록은 R F-002 의 화이트리스트를 따른다. 여기 없는 확장을 켜면
 * 마크다운 직렬화기가 처리하지 못해 왕복에서 내용이 손실된다.
 */
import { Editor, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { parseMarkdown } from '../markdown/parse.ts';
import { serializeToMarkdown } from '../markdown/serialize.ts';

export interface CreateEditorOptions {
  element: HTMLElement;
  markdown: string;
  editable: boolean;
  onUpdate?: () => void;
  onSelectionUpdate?: () => void;
}

export function createEditor(options: CreateEditorOptions): Editor {
  return new Editor({
    element: options.element,
    editable: options.editable,
    extensions: [
      StarterKit.configure({
        // 마크다운 직렬화기가 다루는 것만 켠다.
        // (StarterKit v3 는 Link·목록을 포함한다)
        link: { openOnClick: false, autolink: false },
      }),
      TaskList,
      TaskItem.configure({ nested: false }),
      TableKit.configure({ table: { resizable: false } }),
    ],
    content: parseMarkdown(options.markdown) as JSONContent,
    editorProps: {
      attributes: { class: 'moai-note-editor' },
      // 붙여넣기 정규화 — 외부 HTML의 서식·스타일이 그대로 들어오지 않게 한다.
      // TipTap 은 등록된 확장이 표현할 수 있는 노드만 남기므로, 화이트리스트가
      // 곧 정규화 규칙이 된다.
      transformPastedHTML(html: string): string {
        // script/style 은 파서가 무시하지만 명시적으로 제거해 둔다.
        return html.replace(/<\/?(script|style)[^>]*>/gi, '');
      },
    },
    onUpdate: () => options.onUpdate?.(),
    onSelectionUpdate: () => options.onSelectionUpdate?.(),
  });
}

export function getMarkdown(editor: Editor): string {
  return serializeToMarkdown(editor.getJSON());
}

export function setMarkdown(editor: Editor, markdown: string): void {
  editor.commands.setContent(parseMarkdown(markdown) as JSONContent);
}
