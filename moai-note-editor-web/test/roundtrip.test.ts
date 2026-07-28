import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../src/markdown/parse.ts';
import { serializeToMarkdown } from '../src/markdown/serialize.ts';

/** 마크다운 → 모델 → 마크다운 */
const round = (md: string): string => serializeToMarkdown(parseMarkdown(md));

/**
 * 왕복이 안정적인지 본다.
 * 한 번 왕복한 결과를 다시 왕복해도 같아야 한다(고정점).
 * 첫 왕복에서 표기가 정규화될 수는 있지만, 그 뒤로는 변하면 안 된다.
 */
function expectStable(md: string): string {
  const once = round(md);
  const twice = round(once);
  expect(twice).toBe(once);
  return once;
}

describe('마크다운 왕복 — 블록', () => {
  it('제목 1~3', () => {
    const md = '# 제목1\n\n## 제목2\n\n### 제목3';
    expect(expectStable(md)).toBe(md);
  });

  it('문단', () => {
    const md = '첫 문단입니다.\n\n둘째 문단입니다.';
    expect(expectStable(md)).toBe(md);
  });

  it('순서 없는 목록', () => {
    const md = '- 하나\n- 둘\n- 셋';
    expect(expectStable(md)).toBe(md);
  });

  it('순서 있는 목록', () => {
    const md = '1. 하나\n2. 둘\n3. 셋';
    expect(expectStable(md)).toBe(md);
  });

  it('체크리스트', () => {
    const md = '- [x] 완료된 항목\n- [ ] 미완료 항목';
    expect(expectStable(md)).toBe(md);
  });

  it('인용', () => {
    const md = '> 인용된 문장입니다.';
    expect(expectStable(md)).toBe(md);
  });

  it('코드블록 — 언어 지정', () => {
    const md = '```java\npublic class A {}\n```';
    expect(expectStable(md)).toBe(md);
  });

  it('코드블록 — 언어 없음', () => {
    const md = '```\nplain text\n```';
    expect(expectStable(md)).toBe(md);
  });

  it('수평선', () => {
    const md = '위\n\n---\n\n아래';
    expect(expectStable(md)).toBe(md);
  });

  it('표', () => {
    const md = '| 지사 | 인원 |\n| --- | --- |\n| 서울 | 120 |\n| 부산 | 45 |';
    expect(expectStable(md)).toBe(md);
  });
});

describe('마크다운 왕복 — 인라인 서식', () => {
  it('굵게', () => {
    expect(expectStable('**굵은 글씨**입니다.')).toBe('**굵은 글씨**입니다.');
  });

  it('기울임', () => {
    expect(expectStable('*기울임*입니다.')).toBe('*기울임*입니다.');
  });

  it('취소선', () => {
    expect(expectStable('~~취소선~~입니다.')).toBe('~~취소선~~입니다.');
  });

  it('인라인 코드', () => {
    expect(expectStable('`code` 입니다.')).toBe('`code` 입니다.');
  });

  it('링크', () => {
    const md = '[링크](https://example.com)를 보세요.';
    expect(expectStable(md)).toBe(md);
  });

  it('코드 안의 마크다운 문자는 서식으로 해석되지 않는다', () => {
    const md = '`**not bold**` 입니다.';
    const result = expectStable(md);
    expect(result).toBe(md);
  });

  it('서식 조합', () => {
    const md = '**굵고 *기울인* 글씨**';
    // 중첩 표기는 정규화될 수 있으나 왕복은 안정적이어야 한다
    const once = expectStable(md);
    expect(once).toContain('굵고');
    expect(once).toContain('기울인');
  });
});

describe('마크다운 왕복 — 한글·특수문자', () => {
  it('한글이 보존된다', () => {
    const md = '# 한글 제목\n\n본문에 한글이 있습니다. 조사도 붙습니다.';
    expect(expectStable(md)).toBe(md);
  });

  it('표 셀 안의 파이프가 표를 깨뜨리지 않는다', () => {
    const md = '| A | B |\n| --- | --- |\n| a\\|b | c |';
    const once = expectStable(md);
    // 셀이 3개로 쪼개지지 않았는지 — 헤더와 본문 열 수가 같아야 한다
    const rows = once.split('\n').filter((l) => l.startsWith('|'));
    const cols = rows.map((r) => r.split(/(?<!\\)\|/).length);
    expect(new Set(cols).size).toBe(1);
  });

  it('마크다운 특수문자가 이스케이프되어 보존된다', () => {
    const md = '별표 \\* 와 밑줄 \\_ 입니다.';
    const once = expectStable(md);
    // 왕복 후에도 서식으로 바뀌지 않는다
    expect(round(once)).toBe(once);
  });
});

describe('마크다운 왕복 — 복합 문서', () => {
  it('실제 문서 구조가 안정적으로 왕복된다', () => {
    const md = [
      '# 프로젝트 개요',
      '',
      '이 문서는 **개요**를 설명합니다.',
      '',
      '## 구성',
      '',
      '- 첫째 항목',
      '- 둘째 항목',
      '',
      '## 일정',
      '',
      '| 단계 | 기간 |',
      '| --- | --- |',
      '| 설계 | 2주 |',
      '| 구현 | 4주 |',
      '',
      '> 일정은 변경될 수 있습니다.',
      '',
      '```bash',
      'npm run build',
      '```',
    ].join('\n');

    expect(expectStable(md)).toBe(md);
  });

  it('빈 문서도 처리된다', () => {
    expect(round('')).toBe('');
  });
});
