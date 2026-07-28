/**
 * 문서 모델 → 마크다운.
 *
 * 지원 문법은 명시적 화이트리스트다(R F-005). 여기 없는 노드를 만나면
 * 텍스트만 뽑아 흘려보낸다 — 내용이 사라지는 것보다 낫다.
 */
import type { JSONContent } from '@tiptap/core';

/**
 * 인라인에서 실제로 의미를 갖는 문자만 이스케이프한다.
 *
 * `.` `-` `#` 같은 문자를 전부 이스케이프하면 "습니다\." 처럼 본문이 지저분해진다.
 * 파서가 해석하는 것만 막으면 충분하다: 코드(`), 강조(*), 링크([ ]), 백슬래시.
 * `_` 는 이 파서가 강조로 쓰지 않으므로 건드리지 않는다(snake_case 보존).
 */
const INLINE_SPECIAL = /([\\`*[\]])/g;

function escapeText(text: string): string {
  return text.replace(INLINE_SPECIAL, '\\$1');
}

/**
 * 줄 첫머리에서만 의미를 갖는 마커를 막는다.
 * "- 항목" 이라는 평범한 문단이 목록으로 되살아나는 것을 방지한다.
 */
function escapeLineStart(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      /^(\s*)([-*+>]\s|#{1,6}\s|\d+\.\s)/.test(line)
        ? line.replace(/^(\s*)(.)/, '$1\\$2')
        : line,
    )
    .join('\n');
}

function serializeInline(nodes: JSONContent[] | undefined): string {
  if (!nodes) return '';

  return nodes
    .map((node) => {
      if (node.type === 'hardBreak') return '  \n';
      if (node.type !== 'text') return serializeInline(node.content);

      let text = node.text ?? '';
      const marks = node.marks ?? [];

      // 코드 마크가 있으면 다른 마크보다 안쪽에 두고, 내부는 이스케이프하지 않는다.
      const hasCode = marks.some((m) => m.type === 'code');
      text = hasCode ? `\`${text}\`` : escapeText(text);

      for (const mark of marks) {
        switch (mark.type) {
          case 'bold':
            text = `**${text}**`;
            break;
          case 'italic':
            text = `*${text}*`;
            break;
          case 'strike':
            text = `~~${text}~~`;
            break;
          case 'link': {
            const href = String((mark.attrs as { href?: string } | undefined)?.href ?? '');
            text = `[${text}](${href})`;
            break;
          }
          default:
            break; // 모르는 마크는 서식 없이 흘려보낸다
        }
      }
      return text;
    })
    .join('');
}

function serializeList(node: JSONContent, ordered: boolean, depth: number): string {
  const indent = '  '.repeat(depth);
  const items = node.content ?? [];

  return items
    .map((item, index) => {
      const marker = ordered ? `${index + 1}. ` : '- ';
      const blocks = item.content ?? [];

      // 첫 블록은 마커 뒤에, 나머지는 들여쓰기해서 잇는다
      const parts = blocks.map((block, i) => {
        const text = serializeBlock(block, depth + 1);
        if (i === 0) return indent + marker + text.trimStart();
        return text
          .split('\n')
          .map((line) => (line ? `${indent}  ${line}` : line))
          .join('\n');
      });
      return parts.join('\n');
    })
    .join('\n');
}

function serializeTaskList(node: JSONContent, depth: number): string {
  const indent = '  '.repeat(depth);
  return (node.content ?? [])
    .map((item) => {
      const checked = Boolean((item.attrs as { checked?: boolean } | undefined)?.checked);
      const box = checked ? '[x]' : '[ ]';
      const text = (item.content ?? [])
        .map((block) => serializeBlock(block, depth + 1))
        .join(' ')
        .trim();
      return `${indent}- ${box} ${text}`;
    })
    .join('\n');
}

function serializeTable(node: JSONContent): string {
  const rows = node.content ?? [];
  if (rows.length === 0) return '';

  const cellsOf = (row: JSONContent): string[] =>
    (row.content ?? []).map((cell) =>
      (cell.content ?? [])
        .map((block) => serializeBlock(block, 0))
        .join(' ')
        .replace(/\n/g, ' ')
        // 셀 안의 파이프는 표 구조를 깨뜨린다
        .replace(/\|/g, '\\|')
        .trim(),
    );

  const header = cellsOf(rows[0]!);
  const divider = header.map(() => '---');
  const body = rows.slice(1).map(cellsOf);

  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`;
  return [line(header), line(divider), ...body.map(line)].join('\n');
}

function serializeBlock(node: JSONContent, depth = 0): string {
  switch (node.type) {
    case 'paragraph':
      return escapeLineStart(serializeInline(node.content));

    case 'heading': {
      const level = Number((node.attrs as { level?: number } | undefined)?.level ?? 1);
      return `${'#'.repeat(Math.min(Math.max(level, 1), 6))} ${serializeInline(node.content)}`;
    }

    case 'bulletList':
      return serializeList(node, false, depth);

    case 'orderedList':
      return serializeList(node, true, depth);

    case 'taskList':
      return serializeTaskList(node, depth);

    case 'blockquote':
      return (node.content ?? [])
        .map((child) => serializeBlock(child, depth))
        .join('\n\n')
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');

    case 'codeBlock': {
      const lang = String((node.attrs as { language?: string } | undefined)?.language ?? '');
      const text = (node.content ?? []).map((c) => c.text ?? '').join('');
      return `\`\`\`${lang}\n${text}\n\`\`\``;
    }

    case 'horizontalRule':
      return '---';

    case 'table':
      return serializeTable(node);

    default:
      // 모르는 블록은 텍스트만 살린다
      return serializeInline(node.content);
  }
}

export function serializeToMarkdown(doc: JSONContent): string {
  const blocks = doc.content ?? [];
  return blocks
    .map((block) => serializeBlock(block, 0))
    .filter((s) => s !== '')
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
