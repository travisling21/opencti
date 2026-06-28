import type Express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import conf, { basePath, logApp } from '../config/conf';
import { createAuthenticatedContext } from './httpAuthenticatedContext';
import { internalLoadById, fullRelationsList } from '../database/middleware-loader';
import { extractRepresentative } from '../database/entity-representative';
import { getClientBase } from '../database/redis';
import { isBypassUser, isUserHasCapability, KNOWLEDGE } from '../utils/access';
import type { AuthUser } from '../types/user';
import type { BasicStoreRelation } from '../types/store';

const AI_TOKEN = conf.get('ai:token');
const AI_MODEL = conf.get('ai:model') || 'claude-3-5-sonnet-20241022';
const AI_MAX_TOKENS = Number(conf.get('ai:max_tokens')) || 4096;

const INSIGHT_CACHE_PREFIX = 'opencti:ai:insight';
const INSIGHT_TTL = 3600; // 1 hour
const MAX_TEXT_CHARS = 24000;

const getClient = (): Anthropic | null => (AI_TOKEN ? new Anthropic({ apiKey: AI_TOKEN }) : null);

// Cache key scoped by the user's access profile so an insight generated with one
// user's RBAC is never served to a user who cannot see the same data.
const accessScopeKey = (user: AuthUser): string => {
  if (isBypassUser(user)) return 'bypass';
  const markings = (user.allowed_marking ?? []).map((m) => m.internal_id).sort().join(',');
  return createHash('sha256').update(markings).digest('hex').slice(0, 16);
};

// ── Text transform actions ───────────────────────────────────────────────
const TEXT_ACTIONS: Record<string, (tone?: string) => string> = {
  summarize: () => 'Summarize the following text concisely for a cyber threat intelligence analyst. Return only the summary, with no preamble.',
  fix_spelling: () => 'Fix all spelling and grammar mistakes in the following text. Preserve the meaning and any markdown formatting. Return only the corrected text, with no preamble or commentary.',
  shorter: () => 'Make the following text more concise while preserving its meaning and key facts. Return only the rewritten text.',
  longer: () => 'Expand the following text with more relevant detail and context, staying strictly factual. Return only the expanded text.',
  change_tone: (tone?: string) => `Rewrite the following text in a ${tone || 'professional'} tone while preserving its meaning. Return only the rewritten text.`,
  explain: () => 'Explain the following in clear, plain language suitable for a security analyst. Return only the explanation.',
};

const callClaude = async (system: string, userContent: string): Promise<string> => {
  const client = getClient();
  if (!client) throw new Error('AI is not configured. Set AI__TOKEN in your environment.');
  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: AI_MAX_TOKENS,
    system,
    messages: [{ role: 'user', content: userContent }],
  });
  return response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim();
};

// ── Entity insight gathering ──────────────────────────────────────────────
const gatherEntityContext = async (context: any, user: AuthUser, id: string): Promise<string | null> => {
  const entity: any = await internalLoadById(context, user, id);
  if (!entity) return null;

  const rep = extractRepresentative(entity);
  const lines: string[] = [];
  lines.push(`Entity type: ${entity.entity_type}`);
  lines.push(`Name: ${rep?.main ?? entity.name ?? id}`);
  if (entity.description) lines.push(`Description: ${entity.description}`);
  if (entity.x_opencti_score !== undefined) lines.push(`Score: ${entity.x_opencti_score}`);
  if (entity.confidence !== undefined) lines.push(`Confidence: ${entity.confidence}`);
  if (entity.x_opencti_main_observable_type) lines.push(`Observable type: ${entity.x_opencti_main_observable_type}`);
  if (entity.created_at) lines.push(`Created: ${entity.created_at}`);
  if (Array.isArray(entity.objectLabel) && entity.objectLabel.length) {
    lines.push(`Labels: ${entity.objectLabel.map((l: any) => l.value ?? l).join(', ')}`);
  }

  try {
    const rels = await fullRelationsList<BasicStoreRelation>(context, user, 'stix-core-relationship', {
      fromOrToId: id,
      first: 40,
      orderBy: 'created_at',
      orderMode: 'desc',
    } as any);
    if (rels.length) {
      const relLines = rels.slice(0, 30).map((rel) => {
        const outgoing = rel.fromId === id;
        const otherName = outgoing ? rel.toName : rel.fromName;
        const arrow = outgoing ? '->' : '<-';
        return `- ${rep?.main ?? 'this'} ${arrow}[${rel.entity_type}]${arrow} ${otherName ?? 'unknown'}`;
      });
      lines.push(`\nRelationships (${rels.length} total, showing ${relLines.length}):\n${relLines.join('\n')}`);
    }
  } catch (err) {
    logApp.debug('[AI_TOOLS] relationship gather failed', { cause: err });
  }

  return lines.join('\n');
};

const INSIGHT_SYSTEM_PROMPT = `You are a cyber threat intelligence analyst. Given the structured data about a single entity in an OpenCTI platform, write a brief, insightful analysis (4-6 sentences) covering:
- What this entity is and its significance
- What its relationships reveal (notable connections, targeting, attribution, tooling)
- Any risk or priority assessment an analyst should be aware of

Be specific and reference the data. Do not invent facts not present in the data. Use markdown. No preamble.`;

const initHttpAiTools = (app: Express.Application) => {
  // ── POST /ai/text — transform a piece of text ──────────────────────────
  app.post(`${basePath}/ai/text`, async (req: Express.Request, res: Express.Response) => {
    try {
      const context = await createAuthenticatedContext(req, res, 'ai_tools');
      if (!context.user) { res.sendStatus(403); return; }
      if (!isUserHasCapability(context.user, KNOWLEDGE)) {
        res.status(403).json({ error: 'Knowledge access capability required' });
        return;
      }

      const { content, action, tone } = req.body || {};
      if (!content || typeof content !== 'string') {
        res.status(400).json({ error: 'content is required' });
        return;
      }
      const promptFn = TEXT_ACTIONS[action as string];
      if (!promptFn) {
        res.status(400).json({ error: 'invalid action', valid_actions: Object.keys(TEXT_ACTIONS) });
        return;
      }
      if (!getClient()) {
        res.status(503).json({ error: 'AI is not configured. Set AI__TOKEN in your environment.' });
        return;
      }

      const truncated = content.slice(0, MAX_TEXT_CHARS);
      const result = await callClaude(promptFn(tone), truncated);
      res.json({ result, truncated: content.length > MAX_TEXT_CHARS });
    } catch (e: any) {
      logApp.error('[AI_TOOLS] text transform error', { cause: e });
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /ai/entity-insight/:id — AI summary of one entity ──────────────
  app.get(`${basePath}/ai/entity-insight/:id`, async (req: Express.Request, res: Express.Response) => {
    try {
      const context = await createAuthenticatedContext(req, res, 'ai_tools');
      if (!context.user) { res.sendStatus(403); return; }
      if (!isUserHasCapability(context.user, KNOWLEDGE)) {
        res.status(403).json({ error: 'Knowledge access capability required' });
        return;
      }

      const id = req.params.id as string;
      const scope = accessScopeKey(context.user);
      const cacheKey = `${INSIGHT_CACHE_PREFIX}:${scope}:${id}`;

      if (req.query.refresh === 'true') {
        await getClientBase().del(cacheKey);
      } else {
        const cached = await getClientBase().get(cacheKey);
        if (cached) {
          res.json({ ...JSON.parse(cached), cached: true });
          return;
        }
      }

      if (!getClient()) {
        res.status(503).json({ error: 'AI is not configured. Set AI__TOKEN in your environment.' });
        return;
      }

      const entityContext = await gatherEntityContext(context, context.user, id);
      if (entityContext === null) {
        res.status(404).json({ error: 'Entity not found or not accessible' });
        return;
      }

      const insight = await callClaude(INSIGHT_SYSTEM_PROMPT, entityContext);
      const payload = { id, insight, generated_at: new Date().toISOString() };
      await getClientBase().set(cacheKey, JSON.stringify(payload), 'EX', INSIGHT_TTL);
      res.json({ ...payload, cached: false });
    } catch (e: any) {
      logApp.error('[AI_TOOLS] entity insight error', { cause: e });
      res.status(500).json({ error: e.message });
    }
  });
};

export default initHttpAiTools;
