/**
 * 문서 REST 라우트.
 *
 * 규칙: 여기에는 로직이 없다. service 호출 + 오류를 HTTP로 옮기는 것이 전부다.
 * 조건 분기나 검증을 여기 넣으면 MCP 경로에서 빠진다.
 */
import type { FastifyInstance } from 'fastify';
import type { DocumentService } from '../service/documentService.ts';
import { requirePrincipal } from '../auth/guard.ts';
import {
  createDocumentSchema,
  deleteDocumentSchema,
  getDocumentSchema,
  getRevisionSchema,
  listDocumentsSchema,
  listRevisionsSchema,
  restoreRevisionSchema,
  updateDocumentSchema,
} from './schemas.ts';

interface IdParams {
  id: string;
}
interface IdRevisionParams extends IdParams {
  revision: number;
}

export function registerDocumentRoutes(
  app: FastifyInstance,
  service: DocumentService,
): void {
  app.post('/api/v1/documents', { schema: createDocumentSchema }, async (req, reply) => {
    const doc = service.create(requirePrincipal(req), req.body as { title: string; content: string });
    return reply.code(201).send(doc);
  });

  app.get('/api/v1/documents', { schema: listDocumentsSchema }, async (req) => {
    const q = req.query as { limit?: number; offset?: number };
    return { items: service.list(requirePrincipal(req), q) };
  });

  app.get('/api/v1/documents/:id', { schema: getDocumentSchema }, async (req) => {
    const { id } = req.params as IdParams;
    return service.get(requirePrincipal(req), id);
  });

  app.put('/api/v1/documents/:id', { schema: updateDocumentSchema }, async (req) => {
    const { id } = req.params as IdParams;
    return service.update(
      requirePrincipal(req),
      id,
      req.body as { title: string; content: string; baseRevision: number },
    );
  });

  app.delete('/api/v1/documents/:id', { schema: deleteDocumentSchema }, async (req, reply) => {
    const { id } = req.params as IdParams;
    service.delete(requirePrincipal(req), id);
    return reply.code(204).send();
  });

  app.get('/api/v1/documents/:id/revisions', { schema: listRevisionsSchema }, async (req) => {
    const { id } = req.params as IdParams;
    return { items: service.listRevisions(requirePrincipal(req), id) };
  });

  app.get(
    '/api/v1/documents/:id/revisions/:revision',
    { schema: getRevisionSchema },
    async (req) => {
      const { id, revision } = req.params as IdRevisionParams;
      const row = service.getRevision(requirePrincipal(req), id, revision);
      // documentId 는 경로에 이미 있으므로 응답에 싣지 않는다.
      return {
        revision: row.revision,
        title: row.title,
        content: row.content,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
      };
    },
  );

  app.post(
    '/api/v1/documents/:id/revisions/:revision/restore',
    { schema: restoreRevisionSchema },
    async (req) => {
      const { id, revision } = req.params as IdRevisionParams;
      return service.restore(requirePrincipal(req), id, revision);
    },
  );
}
