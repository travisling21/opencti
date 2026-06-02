import type Express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import conf, { logApp } from '../config/conf';
import { createAuthenticatedContext } from './httpAuthenticatedContext';
import { elList } from '../database/engine';
import { READ_DATA_INDICES } from '../database/utils';
import { extractRepresentative } from '../database/entity-representative';
import { basePath } from '../config/conf';
import { getClientBase } from '../database/redis';
import { isBypassUser, isUserHasCapability, KNOWLEDGE } from '../utils/access';
import type { AuthContext, AuthUser } from '../types/user';

// The digest is cached so it is generated at most once per day per access scope.
// Caching by access scope (not globally) prevents a high-privilege user's briefing
// — which may reference markings/entities a low-privilege user cannot see — from
// being served to users who lack that access.
const accessScopeKey = (user: AuthUser): string => {
  if (isBypassUser(user)) return 'bypass';
  const markings = (user.allowed_marking ?? []).map((m) => m.internal_id).sort().join(',');
  return createHash('sha256').update(markings).digest('hex').slice(0, 16);
};

const AI_TOKEN = conf.get('ai:token');
const AI_MODEL = conf.get('ai:model') || 'claude-3-5-sonnet-20241022';
const AI_MAX_TOKENS = Number(conf.get('ai:max_tokens')) || 4096;

const DIGEST_CACHE_KEY = 'opencti:ai:daily_digest';
const DIGEST_TTL = 86400;

const DIGEST_SYSTEM_PROMPT = `You are a cyber threat intelligence analyst writing a daily briefing for your security team. Generate a concise, actionable daily digest based on the platform data provided.

Structure your briefing with these sections:
1. **Executive Summary** — 2-3 sentence overview of the threat landscape
2. **Key Threats** — Notable threat actors, campaigns, or intrusion sets with brief context
3. **New Indicators** — Summary of new IOCs by type (IPs, domains, hashes, URLs) with counts
4. **Vulnerability Highlights** — Critical or actively exploited CVEs
5. **Reports & Intelligence** — Recent reports worth reading
6. **Recommended Actions** — 2-3 concrete steps the team should take today

Keep the total briefing under 800 words. Use markdown formatting. Be specific — reference entity names from the data. If a section has no data, skip it rather than saying "no data available".`;

const gatherPlatformIntelligence = async (context: AuthContext, user: AuthUser): Promise<string> => {
  const sections: string[] = [];
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    const reports = await elList(context, user, READ_DATA_INDICES, {
      first: 15,
      orderBy: 'created_at',
      orderMode: 'desc',
      types: ['Report'],
    });
    if (reports.length > 0) {
      const items = reports.map((r: any) => {
        const rep = extractRepresentative(r);
        const name = rep?.main || r.name || r.internal_id;
        const desc = r.description ? r.description.substring(0, 150) : '';
        return `- ${name} (${r.created_at || 'unknown'})${desc ? `: ${desc}` : ''}`;
      });
      sections.push(`## Recent Reports (${reports.length})\n${items.join('\n')}`);
    }
  } catch (err) {
    logApp.debug('[AI_DIGEST] Reports query failed', { cause: err });
  }

  try {
    const indicators = await elList(context, user, READ_DATA_INDICES, {
      first: 30,
      orderBy: 'created_at',
      orderMode: 'desc',
      types: ['Indicator'],
    });
    if (indicators.length > 0) {
      const byType: Record<string, number> = {};
      const highScore: string[] = [];
      for (const ind of indicators as any[]) {
        const obsType = ind.x_opencti_main_observable_type || 'Unknown';
        byType[obsType] = (byType[obsType] || 0) + 1;
        if ((ind.x_opencti_score ?? 0) >= 70) {
          const rep = extractRepresentative(ind);
          highScore.push(`- [Score: ${ind.x_opencti_score}] ${rep?.main || ind.name || ind.pattern} (${obsType})`);
        }
      }
      const typeSummary = Object.entries(byType).map(([t, c]) => `${t}: ${c}`).join(', ');
      let text = `## Recent Indicators (${indicators.length})\nBy type: ${typeSummary}`;
      if (highScore.length > 0) {
        text += `\n\nHigh-confidence indicators:\n${highScore.slice(0, 10).join('\n')}`;
      }
      sections.push(text);
    }
  } catch (err) {
    logApp.debug('[AI_DIGEST] Indicators query failed', { cause: err });
  }

  try {
    const threats = await elList(context, user, READ_DATA_INDICES, {
      first: 15,
      orderBy: 'created_at',
      orderMode: 'desc',
      types: ['Threat-Actor-Group', 'Threat-Actor-Individual', 'Intrusion-Set', 'Campaign'],
    });
    if (threats.length > 0) {
      const items = threats.map((t: any) => {
        const rep = extractRepresentative(t);
        const name = rep?.main || t.name || t.internal_id;
        const desc = t.description ? t.description.substring(0, 100) : '';
        return `- **${t.entity_type}**: ${name}${desc ? ` — ${desc}` : ''}`;
      });
      sections.push(`## Threat Actors & Campaigns (${threats.length})\n${items.join('\n')}`);
    }
  } catch (err) {
    logApp.debug('[AI_DIGEST] Threats query failed', { cause: err });
  }

  try {
    const vulns = await elList(context, user, READ_DATA_INDICES, {
      first: 10,
      orderBy: 'created_at',
      orderMode: 'desc',
      types: ['Vulnerability'],
    });
    if (vulns.length > 0) {
      const items = vulns.map((v: any) => {
        const rep = extractRepresentative(v);
        const name = rep?.main || v.name || v.internal_id;
        const desc = v.description ? v.description.substring(0, 100) : '';
        return `- **${name}**${desc ? `: ${desc}` : ''}`;
      });
      sections.push(`## Recent Vulnerabilities (${vulns.length})\n${items.join('\n')}`);
    }
  } catch (err) {
    logApp.debug('[AI_DIGEST] Vulnerabilities query failed', { cause: err });
  }

  try {
    const malware = await elList(context, user, READ_DATA_INDICES, {
      first: 10,
      orderBy: 'created_at',
      orderMode: 'desc',
      types: ['Malware', 'Tool'],
    });
    if (malware.length > 0) {
      const items = malware.map((m: any) => {
        const rep = extractRepresentative(m);
        return `- **${m.entity_type}**: ${rep?.main || m.name || m.internal_id}`;
      });
      sections.push(`## Malware & Tools (${malware.length})\n${items.join('\n')}`);
    }
  } catch (err) {
    logApp.debug('[AI_DIGEST] Malware query failed', { cause: err });
  }

  if (sections.length === 0) {
    return 'The platform has no threat intelligence data yet. Connectors may still be importing data.';
  }

  return sections.join('\n\n');
};

export const generateDigest = async (context: AuthContext, user: AuthUser): Promise<{ date: string; content: string; generated_at: string }> => {
  const today = new Date().toISOString().split('T')[0];
  const cacheKey = `${DIGEST_CACHE_KEY}:${accessScopeKey(user)}:${today}`;

  const cachedRaw = await getClientBase().get(cacheKey);
  if (cachedRaw) {
    return JSON.parse(cachedRaw) as { date: string; content: string; generated_at: string };
  }

  if (!AI_TOKEN) {
    return {
      date: today,
      content: 'AI is not configured. Set AI__TOKEN in your environment to enable daily digest generation.',
      generated_at: new Date().toISOString(),
    };
  }

  logApp.info('[AI_DIGEST] Generating daily digest');

  const platformData = await gatherPlatformIntelligence(context, user);

  const client = new Anthropic({ apiKey: AI_TOKEN });
  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: AI_MAX_TOKENS,
    system: DIGEST_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Generate today's daily threat intelligence briefing (${today}) based on the following platform data:\n\n${platformData}`,
      },
    ],
  });

  const content = response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as any).text)
    .join('\n');

  const digest = {
    date: today,
    content,
    generated_at: new Date().toISOString(),
  };

  await getClientBase().set(cacheKey, JSON.stringify(digest), 'EX', DIGEST_TTL);
  logApp.info('[AI_DIGEST] Daily digest generated and cached', { date: today });

  return digest;
};

const initHttpAiDigest = (app: Express.Application) => {
  app.get(`${basePath}/ai/daily-digest`, async (req: Express.Request, res: Express.Response) => {
    try {
      const context = await createAuthenticatedContext(req, res, 'ai_digest');
      if (!context.user) {
        res.sendStatus(403);
        return;
      }
      if (!isUserHasCapability(context.user, KNOWLEDGE)) {
        res.status(403).json({ error: 'Knowledge access capability required' });
        return;
      }

      const forceRefresh = req.query.refresh === 'true';
      if (forceRefresh) {
        const today = new Date().toISOString().split('T')[0];
        const cacheKey = `${DIGEST_CACHE_KEY}:${accessScopeKey(context.user)}:${today}`;
        await getClientBase().del(cacheKey);
      }

      const digest = await generateDigest(context, context.user);
      res.json(digest);
    } catch (e: any) {
      logApp.error('[AI_DIGEST] Error generating digest', { cause: e });
      res.status(500).json({ error: 'Failed to generate daily digest', message: e.message });
    }
  });

  app.get(`${basePath}/ai/daily-digest/history`, async (req: Express.Request, res: Express.Response) => {
    try {
      const context = await createAuthenticatedContext(req, res, 'ai_digest');
      if (!context.user) {
        res.sendStatus(403);
        return;
      }
      if (!isUserHasCapability(context.user, KNOWLEDGE)) {
        res.status(403).json({ error: 'Knowledge access capability required' });
        return;
      }

      const scope = accessScopeKey(context.user);
      const digests: any[] = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const cacheKey = `${DIGEST_CACHE_KEY}:${scope}:${date}`;
        const raw = await getClientBase().get(cacheKey);
        if (raw) {
          digests.push(JSON.parse(raw));
        }
      }
      res.json({ digests });
    } catch (e: any) {
      logApp.error('[AI_DIGEST] Error fetching digest history', { cause: e });
      res.status(500).json({ error: 'Failed to fetch digest history' });
    }
  });
};

export default initHttpAiDigest;
