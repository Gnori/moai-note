/**
 * MCP 표면 — streamable HTTP (I §2).
 *
 * 인증은 REST와 **같은 관문**(auth/guard.ts)이 처리한다.
 * 여기서 별도 인증을 구현하지 않는다 — 한쪽만 고치면 다른 쪽이 열린 채로 남는다.
 *
 * 요청 주체(principal)는 관문이 req.principal 에 넣어준 값을 그대로 쓴다.
 * MCP 파라미터로 소유자를 받지 않는다.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { DocumentService } from '../service/documentService.ts';
import type { Principal } from '../storage/types.ts';
import { ServiceError } from '../service/errors.ts';
import { requirePrincipal } from '../auth/guard.ts';
import { TOOLS } from './tools.ts';

const SERVER_INFO = { name: 'moai-note', version: '0.1.0' } as const;

/**
 * 요청마다 서버·전송 인스턴스를 만든다.
 *
 * 주체가 요청마다 다르기 때문이다. 서버를 공유하면 한 사용자의 principal 이
 * 다른 사용자의 도구 호출에 쓰일 수 있다 — 세션 상태를 두지 않는 이유.
 */
function createMcpServer(service: DocumentService, principal: Principal): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOLS.find((t) => t.name === request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `알 수 없는 도구입니다: ${request.params.name}` }],
      };
    }

    try {
      const result = tool.run(service, principal, request.params.arguments ?? {});
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      if (err instanceof ServiceError) {
        // 오류 코드를 그대로 전달한다 — REST와 판정이 같아야 한다.
        // 특히 REVISION_CONFLICT 는 에이전트가 재시도 절차를 밟아야 하므로
        // currentRevision 까지 실어 보낸다.
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify(err.toResponse()) }],
        };
      }
      throw err;
    }
  });

  return server;
}

export async function registerMcpRoute(
  app: FastifyInstance,
  service: DocumentService,
): Promise<void> {
  // Fastify가 본문을 이미 파싱하므로 transport 에 그대로 넘긴다.
  app.post('/mcp', async (req: FastifyRequest, reply) => {
    const principal = requirePrincipal(req);

    const server = createMcpServer(service, principal);
    const transport = new StreamableHTTPServerTransport({
      // 상태를 두지 않는다(요청마다 독립) — 주체 혼선을 원천 차단한다.
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    reply.hijack();
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } finally {
      // 요청이 끝나면 정리한다 — 인스턴스가 쌓이면 누수가 된다.
      reply.raw.on('close', () => {
        void transport.close();
        void server.close();
      });
    }
  });
}
