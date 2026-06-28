import type Express from 'express';
import { basePath, logApp } from '../config/conf';
import { createAuthenticatedContext } from './httpAuthenticatedContext';
import { elRawSearch } from '../database/engine';
import { internalLoadById } from '../database/middleware-loader';
import { isBypassUser, isUserHasCapability, KNOWLEDGE } from '../utils/access';
import { INDEX_ARGUS_FILES } from '../manager/argusFileIndexManager';
import type { AuthContext, AuthUser } from '../types/user';

// Search the document-content index produced by argusFileIndexManager.
// Results are RBAC-filtered: a hit is only returned if the requesting user
// can access the file's parent entity (or the file's markings) — the search
// itself runs as the user but the dedicated index has no built-in security
// filtering, so we post-filter every hit.

const MAX_RESULTS = 25;

const canAccessHit = async (context: AuthContext, user: AuthUser, source: any): Promise<boolean> => {
  if (source.entity_id) {
    const entity = await internalLoadById(context, user, source.entity_id);
    return Boolean(entity);
  }
  const markings: string[] = source.file_markings ?? [];
  if (markings.length === 0) return true;
  if (isBypassUser(user)) return true;
  const allowed = new Set((user.allowed_marking ?? []).map((m) => m.internal_id));
  return markings.every((m) => allowed.has(m));
};

const initHttpFileSearch = (app: Express.Application) => {
  app.get(`${basePath}/search/documents`, async (req: Express.Request, res: Express.Response) => {
    try {
      const context = await createAuthenticatedContext(req, res, 'document_search');
      if (!context.user) { res.sendStatus(403); return; }
      if (!isUserHasCapability(context.user, KNOWLEDGE)) {
        res.status(403).json({ error: 'Knowledge access capability required' });
        return;
      }

      const q = (req.query.q as string || '').trim();
      if (q.length < 2) {
        res.json({ query: q, results: [] });
        return;
      }

      const query = {
        index: INDEX_ARGUS_FILES,
        ignore_unavailable: true,
        body: {
          size: MAX_RESULTS * 2, // over-fetch so post-filtering still fills the page
          _source: ['file_id', 'name', 'entity_id', 'file_markings', 'indexed_at'],
          query: {
            simple_query_string: {
              query: q,
              fields: ['attachment.content', 'attachment.title^2', 'name^2'],
              default_operator: 'and',
            },
          },
          highlight: {
            // Custom markers (not HTML) so the frontend can render highlights
            // safely without dangerouslySetInnerHTML over untrusted file content.
            pre_tags: ['{{HL}}'],
            post_tags: ['{{/HL}}'],
            fields: { 'attachment.content': { fragment_size: 220, number_of_fragments: 2 } },
          },
        },
      };

      let hits: any[] = [];
      try {
        const result: any = await elRawSearch(context, context.user, null, query);
        hits = result?.hits?.hits ?? [];
      } catch (e: any) {
        // Index may not exist yet (nothing indexed) — return empty rather than erroring
        logApp.debug('[DOC-SEARCH] search failed (index may be empty)', { cause: e });
        res.json({ query: q, results: [] });
        return;
      }

      const results: any[] = [];
      for (const hit of hits) {
        if (results.length >= MAX_RESULTS) break;
        // eslint-disable-next-line no-await-in-loop
        const accessible = await canAccessHit(context, context.user, hit._source);
        if (!accessible) continue;
        const snippet = hit.highlight?.['attachment.content']?.join(' … ') ?? '';
        results.push({
          file_id: hit._source.file_id,
          name: hit._source.name,
          entity_id: hit._source.entity_id ?? null,
          indexed_at: hit._source.indexed_at,
          score: hit._score,
          snippet,
        });
      }

      res.json({ query: q, count: results.length, results });
    } catch (e: any) {
      logApp.error('[DOC-SEARCH] Error searching documents', { cause: e });
      res.status(500).json({ error: e.message });
    }
  });
};

export default initHttpFileSearch;
