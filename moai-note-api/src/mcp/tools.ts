/**
 * MCP 도구 정의 (I §2.2).
 *
 * 각 도구는 REST와 **같은 service 함수**를 호출한다.
 * REST를 HTTP로 재호출하거나 storage를 직접 만지지 않는다 — 동작이 갈라진다.
 */
import type { DocumentService } from '../service/documentService.ts';
import type { Principal } from '../storage/types.ts';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (service: DocumentService, principal: Principal, args: Record<string, unknown>) => unknown;
}

const idProp = { type: 'string', description: '문서 ID' } as const;

/**
 * 도구 설명에 사용 규약을 담는다.
 * LLM은 스키마보다 설명문을 따르므로, 지켜야 할 절차를 여기 적어야 한다.
 */
const UPDATE_GUIDE =
  '문서를 수정한다. 반드시 먼저 note_get 으로 현재 revision 을 확인하고 그 값을 baseRevision 으로 보낼 것. ' +
  '409(REVISION_CONFLICT)가 오면 다시 note_get 으로 최신 본문을 읽고 변경을 병합한 뒤 재시도한다. ' +
  '덮어쓰려고 임의의 baseRevision 을 넣지 말 것 — 다른 사람의 편집이 사라진다. ' +
  '본문은 마크다운이며 전체를 다시 보낸다(부분 패치 없음).';

export const TOOLS: ToolDefinition[] = [
  {
    name: 'note_create',
    description:
      '새 문서를 만든다. 제목과 마크다운 본문을 받는다. 생성된 문서의 id 를 돌려주며, ' +
      '그 id 로 사용자에게 문서를 보여줄 수 있다.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '문서 제목' },
        content: { type: 'string', description: '마크다운 본문' },
      },
      required: ['title', 'content'],
    },
    run: (service, principal, args) =>
      service.create(principal, {
        title: String(args.title ?? ''),
        content: String(args.content ?? ''),
      }),
  },

  {
    name: 'note_list',
    description: '내 문서 목록을 최근 수정순으로 조회한다. 본문은 포함되지 않는다.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        offset: { type: 'integer', minimum: 0 },
      },
    },
    run: (service, principal, args) => ({
      items: service.list(principal, {
        ...(args.limit !== undefined ? { limit: Number(args.limit) } : {}),
        ...(args.offset !== undefined ? { offset: Number(args.offset) } : {}),
      }),
    }),
  },

  {
    name: 'note_get',
    description:
      '문서 본문을 마크다운으로 가져온다. 응답의 revision 은 수정 시 baseRevision 으로 쓴다.',
    inputSchema: {
      type: 'object',
      properties: { id: idProp },
      required: ['id'],
    },
    run: (service, principal, args) => service.get(principal, String(args.id ?? '')),
  },

  {
    name: 'note_update',
    description: UPDATE_GUIDE,
    inputSchema: {
      type: 'object',
      properties: {
        id: idProp,
        title: { type: 'string', description: '문서 제목' },
        content: { type: 'string', description: '마크다운 본문 전체' },
        baseRevision: {
          type: 'integer',
          minimum: 1,
          description: 'note_get 으로 확인한 현재 revision',
        },
      },
      required: ['id', 'title', 'content', 'baseRevision'],
    },
    run: (service, principal, args) =>
      service.update(principal, String(args.id ?? ''), {
        title: String(args.title ?? ''),
        content: String(args.content ?? ''),
        baseRevision: Number(args.baseRevision),
      }),
  },

  {
    name: 'note_delete',
    description: '문서를 삭제한다. 되돌릴 수 없다. 사용자가 명시적으로 요청했을 때만 쓴다.',
    inputSchema: {
      type: 'object',
      properties: { id: idProp },
      required: ['id'],
    },
    run: (service, principal, args) => {
      service.delete(principal, String(args.id ?? ''));
      return { deleted: true };
    },
  },

  {
    name: 'note_revisions',
    description: '문서의 변경 이력을 최신순으로 조회한다.',
    inputSchema: {
      type: 'object',
      properties: { id: idProp },
      required: ['id'],
    },
    run: (service, principal, args) => ({
      items: service.listRevisions(principal, String(args.id ?? '')),
    }),
  },

  {
    name: 'note_revision_get',
    description: '특정 리비전의 내용을 가져온다.',
    inputSchema: {
      type: 'object',
      properties: {
        id: idProp,
        revision: { type: 'integer', minimum: 1, description: '리비전 번호' },
      },
      required: ['id', 'revision'],
    },
    run: (service, principal, args) =>
      service.getRevision(principal, String(args.id ?? ''), Number(args.revision)),
  },

  {
    name: 'note_restore',
    description:
      '문서를 특정 리비전 내용으로 되돌린다. 이력은 지워지지 않고 새 리비전이 만들어진다.',
    inputSchema: {
      type: 'object',
      properties: {
        id: idProp,
        revision: { type: 'integer', minimum: 1, description: '되돌릴 리비전 번호' },
      },
      required: ['id', 'revision'],
    },
    run: (service, principal, args) =>
      service.restore(principal, String(args.id ?? ''), Number(args.revision)),
  },
];
