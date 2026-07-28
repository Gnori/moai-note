/**
 * 마크다운 → 문서 모델.
 *
 * 외부 파서를 쓰지 않는다. 지원 문법이 화이트리스트로 고정돼 있어(R F-005)
 * 직접 다루는 편이 왕복 무손실을 보장하기 쉽다 — 파서가 지원하는 문법이
 * 직렬화기보다 넓으면 왕복에서 손실이 생긴다.
 */
import type { JSONContent } from '@tiptap/core';

const UNESCAPE = /\\([\\`*_{}[\]()#+\-.!])/g;

interface InlineToken {
  text: string;
  marks: JSONContent['marks'];
}

/** 인라인 서식 파싱 — 코드 → 링크 → 굵게 → 기울임 → 취소선 순으로 벗긴다 */
function parseInline(input: string): JSONContent[] {
  const out: JSONContent[] = [];

  const push = (text: string, marks: JSONContent['marks']): void => {
    if (text === '') return;
    out.push(marks && marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text });
  };

  // 토큰 경계를 찾는 정규식. 코드가 가장 먼저다 — 코드 안에서는 다른 서식이 없다.
  const pattern =
    /(`[^`]+`)|(\[[^\]]*\]\([^)]*\))|(\*\*[^*]+\*\*)|(~~[^~]+~~)|(\*[^*]+\*)/;

  let rest = input;
  while (rest.length > 0) {
    const match = pattern.exec(rest);
    if (!match || match.index === undefined) {
      push(rest.replace(UNESCAPE, '$1'), undefined);
      break;
    }

    push(rest.slice(0, match.index).replace(UNESCAPE, '$1'), undefined);
    const token = match[0];

    if (token.startsWith('`')) {
      // 코드 내부는 이스케이프를 풀지 않는다
      push(token.slice(1, -1), [{ type: 'code' }]);
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(token);
      if (linkMatch) {
        const inner = parseInline(linkMatch[1] ?? '');
        const href = linkMatch[2] ?? '';
        for (const node of inner) {
          node.marks = [...(node.marks ?? []), { type: 'link', attrs: { href } }];
          out.push(node);
        }
      } else {
        push(token, undefined);
      }
    } else if (token.startsWith('**')) {
      for (const node of parseInline(token.slice(2, -2))) {
        node.marks = [...(node.marks ?? []), { type: 'bold' }];
        out.push(node);
      }
    } else if (token.startsWith('~~')) {
      for (const node of parseInline(token.slice(2, -2))) {
        node.marks = [...(node.marks ?? []), { type: 'strike' }];
        out.push(node);
      }
    } else {
      for (const node of parseInline(token.slice(1, -1))) {
        node.marks = [...(node.marks ?? []), { type: 'italic' }];
        out.push(node);
      }
    }

    rest = rest.slice(match.index + token.length);
  }

  return out;
}

function paragraph(text: string): JSONContent {
  const content = parseInline(text);
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
}

function isTableDivider(line: string): boolean {
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line.trim());
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  // 이스케이프된 파이프는 셀 구분자가 아니다
  return trimmed.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

export function parseMarkdown(markdown: string): JSONContent {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: JSONContent[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // 빈 줄
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // 코드 블록
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] ?? '';
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      i += 1; // 닫는 펜스
      blocks.push({
        type: 'codeBlock',
        ...(lang ? { attrs: { language: lang } } : {}),
        ...(body.length > 0 ? { content: [{ type: 'text', text: body.join('\n') }] } : {}),
      });
      continue;
    }

    // 수평선
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'horizontalRule' });
      i += 1;
      continue;
    }

    // 제목
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        attrs: { level: heading[1]!.length },
        content: parseInline(heading[2] ?? ''),
      });
      i += 1;
      continue;
    }

    // 표 — 다음 줄이 구분선이어야 표로 본다
    if (line.includes('|') && isTableDivider(lines[i + 1] ?? '')) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim() !== '') {
        rows.push(splitRow(lines[i] ?? ''));
        i += 1;
      }
      const makeRow = (cells: string[], head: boolean): JSONContent => ({
        type: 'tableRow',
        content: cells.map((cell) => ({
          type: head ? 'tableHeader' : 'tableCell',
          content: [paragraph(cell)],
        })),
      });
      blocks.push({
        type: 'table',
        content: [makeRow(header, true), ...rows.map((r) => makeRow(r, false))],
      });
      continue;
    }

    // 인용
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? '')) {
        body.push((lines[i] ?? '').replace(/^>\s?/, ''));
        i += 1;
      }
      const inner = parseMarkdown(body.join('\n'));
      blocks.push({ type: 'blockquote', content: inner.content ?? [paragraph('')] });
      continue;
    }

    // 체크리스트 — 일반 목록보다 먼저 판정한다
    if (/^\s*[-*]\s+\[[ xX]\]\s/.test(line)) {
      const items: JSONContent[] = [];
      while (i < lines.length && /^\s*[-*]\s+\[[ xX]\]\s/.test(lines[i] ?? '')) {
        const m = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(lines[i] ?? '');
        items.push({
          type: 'taskItem',
          attrs: { checked: (m?.[1] ?? ' ').toLowerCase() === 'x' },
          content: [paragraph(m?.[2] ?? '')],
        });
        i += 1;
      }
      blocks.push({ type: 'taskList', content: items });
      continue;
    }

    // 목록
    const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
    const ordered = /^(\s*)\d+\.\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      const items: JSONContent[] = [];
      const itemPattern = isOrdered ? /^(\s*)\d+\.\s+(.*)$/ : /^(\s*)[-*]\s+(.*)$/;

      while (i < lines.length) {
        const m = itemPattern.exec(lines[i] ?? '');
        if (!m) break;
        // 체크리스트를 일반 목록으로 삼키지 않는다
        if (/^\[[ xX]\]\s/.test(m[2] ?? '')) break;
        items.push({ type: 'listItem', content: [paragraph(m[2] ?? '')] });
        i += 1;
      }
      blocks.push({ type: isOrdered ? 'orderedList' : 'bulletList', content: items });
      continue;
    }

    // 문단 — 빈 줄이 나올 때까지 이어 붙인다
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() !== '') {
      const next = lines[i] ?? '';
      // 다른 블록이 시작되면 멈춘다
      if (
        /^#{1,6}\s/.test(next) ||
        /^```/.test(next) ||
        /^>\s?/.test(next) ||
        /^\s*[-*]\s+/.test(next) ||
        /^\s*\d+\.\s+/.test(next) ||
        /^(-{3,}|\*{3,}|_{3,})\s*$/.test(next)
      ) {
        if (para.length > 0) break;
      }
      para.push(next);
      i += 1;
    }
    if (para.length > 0) blocks.push(paragraph(para.join('\n')));
  }

  return { type: 'doc', content: blocks.length > 0 ? blocks : [{ type: 'paragraph' }] };
}
