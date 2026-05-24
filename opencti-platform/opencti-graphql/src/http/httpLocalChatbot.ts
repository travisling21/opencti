import type Express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import conf, { logApp } from '../config/conf';
import { createAuthenticatedContext } from './httpAuthenticatedContext';
import { elList } from '../database/engine';
import { READ_DATA_INDICES } from '../database/utils';
import { extractRepresentative } from '../database/entity-representative';
import type { AuthContext, AuthUser } from '../types/user';

const AI_TOKEN = conf.get('ai:token');
const AI_MODEL = conf.get('ai:model') || 'claude-3-5-sonnet-20241022';
const AI_MAX_TOKENS = Number(conf.get('ai:max_tokens')) || 4096;

const SYSTEM_PROMPT = `You are Ariane, an AI assistant embedded in OpenCTI, an open-source cyber threat intelligence platform. You have access to the platform's data which is provided as context below.

When answering questions:
- Reference specific entities from the platform data when available
- Use entity names, types, and details from the context
- If the context doesn't contain relevant data, say so and offer general CTI guidance
- Be concise and professional
- Use markdown formatting when helpful
- When mentioning entities, include their type (e.g., "Threat Actor: APT28", "Indicator: 192.168.1.1")`;

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

const sessions = new Map<string, ConversationMessage[]>();

const getAnthropicClient = (): Anthropic | null => {
  if (!AI_TOKEN) return null;
  return new Anthropic({ apiKey: AI_TOKEN });
};

const queryPlatformData = async (context: AuthContext, user: AuthUser, searchTerm: string): Promise<string> => {
  const sections: string[] = [];

  try {
    const searchResults = await elList(context, user, READ_DATA_INDICES, {
      search: searchTerm,
      first: 10,
      orderBy: '_score',
      orderMode: 'desc',
      types: [
        'Report', 'Indicator', 'Threat-Actor-Group', 'Threat-Actor-Individual',
        'Malware', 'Campaign', 'Intrusion-Set', 'Vulnerability',
        'Attack-Pattern', 'Incident', 'Tool',
      ],
    });

    if (searchResults && searchResults.length > 0) {
      const formatted = searchResults.map((entity: any) => {
        const rep = extractRepresentative(entity);
        const name = rep?.main || entity.name || entity.value || entity.internal_id;
        const desc = rep?.secondary || entity.description || '';
        const parts = [`- **${entity.entity_type}**: ${name}`];
        if (desc) parts.push(`  ${desc.substring(0, 200)}`);
        if (entity.created_at) parts.push(`  Created: ${entity.created_at}`);
        return parts.join('\n');
      });
      sections.push(`## Search Results for "${searchTerm}"\n${formatted.join('\n')}`);
    }
  } catch (err) {
    logApp.debug('[CHATBOT] Search query failed', { cause: err });
  }

  try {
    const recentReports = await elList(context, user, READ_DATA_INDICES, {
      first: 5,
      orderBy: 'created_at',
      orderMode: 'desc',
      types: ['Report'],
    });

    if (recentReports && recentReports.length > 0) {
      const formatted = recentReports.map((r: any) => {
        const rep = extractRepresentative(r);
        const name = rep?.main || r.name || r.internal_id;
        return `- **${name}** (${r.created_at || 'unknown date'})`;
      });
      sections.push(`## Latest Reports\n${formatted.join('\n')}`);
    }
  } catch (err) {
    logApp.debug('[CHATBOT] Recent reports query failed', { cause: err });
  }

  try {
    const recentIndicators = await elList(context, user, READ_DATA_INDICES, {
      first: 5,
      orderBy: 'created_at',
      orderMode: 'desc',
      types: ['Indicator'],
    });

    if (recentIndicators && recentIndicators.length > 0) {
      const formatted = recentIndicators.map((i: any) => {
        const rep = extractRepresentative(i);
        const name = rep?.main || i.name || i.pattern || i.internal_id;
        const obsType = i.x_opencti_main_observable_type || '';
        return `- **${name}** (${obsType}, score: ${i.x_opencti_score ?? 'N/A'})`;
      });
      sections.push(`## Latest Indicators\n${formatted.join('\n')}`);
    }
  } catch (err) {
    logApp.debug('[CHATBOT] Recent indicators query failed', { cause: err });
  }

  try {
    const threats = await elList(context, user, READ_DATA_INDICES, {
      first: 5,
      orderBy: 'created_at',
      orderMode: 'desc',
      types: ['Threat-Actor-Group', 'Threat-Actor-Individual', 'Intrusion-Set', 'Campaign', 'Malware'],
    });

    if (threats && threats.length > 0) {
      const formatted = threats.map((t: any) => {
        const rep = extractRepresentative(t);
        const name = rep?.main || t.name || t.internal_id;
        return `- **${t.entity_type}**: ${name}`;
      });
      sections.push(`## Active Threats\n${formatted.join('\n')}`);
    }
  } catch (err) {
    logApp.debug('[CHATBOT] Threats query failed', { cause: err });
  }

  if (sections.length === 0) {
    return 'No data found in the platform yet. The platform appears to be empty or no entities match the query.';
  }

  return sections.join('\n\n');
};

export const getLocalChatbotConfig = async (req: Express.Request, res: Express.Response) => {
  try {
    const context = await createAuthenticatedContext(req, res, 'chatbot');
    if (!context.user) {
      res.sendStatus(403);
      return;
    }
    res.json({
      xtm_one_url: null,
      xtm_one_configured: true,
    });
  } catch (e: any) {
    logApp.error('Error in local chatbot config', { cause: e });
    res.status(503).send({ status: 'error', error: e.message });
  }
};

export const getLocalChatbotAgents = async (req: Express.Request, res: Express.Response) => {
  try {
    const context = await createAuthenticatedContext(req, res, 'chatbot');
    if (!context.user) {
      res.sendStatus(403);
      return;
    }
    res.json([
      {
        id: 'claude-cti-assistant',
        name: 'Claude CTI Assistant',
        slug: 'claude-cti',
        description: 'AI-powered cyber threat intelligence assistant with platform data access',
      },
    ]);
  } catch (e: any) {
    logApp.error('Error in local chatbot agents', { cause: e });
    res.status(503).send({ status: 'error', error: e.message });
  }
};

export const postLocalChatbotSession = async (req: Express.Request, res: Express.Response) => {
  try {
    const context = await createAuthenticatedContext(req, res, 'chatbot');
    if (!context.user) {
      res.sendStatus(403);
      return;
    }
    const conversationId = uuidv4();
    sessions.set(conversationId, []);
    res.json({ conversation_id: conversationId });
  } catch (e: any) {
    logApp.error('Error in local chatbot session', { cause: e });
    res.status(503).send({ status: 'error', error: e.message });
  }
};

export const postLocalChatbotMessage = async (req: Express.Request, res: Express.Response) => {
  try {
    const context = await createAuthenticatedContext(req, res, 'chatbot');
    if (!context.user) {
      res.sendStatus(403);
      return;
    }

    const client = getAnthropicClient();
    if (!client) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.status(200);
      res.write(`data: ${JSON.stringify({ type: 'error', content: 'AI is not configured. Set AI__TOKEN in your environment.' })}\n\n`);
      res.end();
      return;
    }

    const { content, conversation_id: conversationId } = req.body || {};
    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const sessionId = conversationId || uuidv4();
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, []);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.status(200);

    res.write(`data: ${JSON.stringify({ type: 'status', status: 'thinking' })}\n\n`);

    const platformData = await queryPlatformData(context, context.user, content);

    let history = sessions.get(sessionId)!;
    const enrichedContent = `${content}\n\n---\n**Platform Context:**\n${platformData}`;
    history.push({ role: 'user', content: enrichedContent });

    const stream = client.messages.stream({
      model: AI_MODEL,
      max_tokens: AI_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: history.slice(-20),
    });

    let fullResponse = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullResponse += event.delta.text;
        res.write(`data: ${JSON.stringify({ type: 'stream', content: event.delta.text })}\n\n`);
      }
    }

    history.push({ role: 'assistant', content: fullResponse });
    sessions.set(sessionId, history);

    res.write(`data: ${JSON.stringify({ type: 'done', content: fullResponse, conversation_id: sessionId })}\n\n`);
    res.end();
  } catch (e: any) {
    logApp.error('Error in local chatbot message', { cause: e });
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.status(200);
    }
    res.write(`data: ${JSON.stringify({ type: 'error', content: `Error: ${e.message}` })}\n\n`);
    res.end();
  }
};

export const postLocalChatbotUpload = async (_req: Express.Request, res: Express.Response) => {
  res.status(400).json({ error: 'File upload is not supported in local chatbot mode' });
};

export const postLocalAgentMessage = async (req: Express.Request, res: Express.Response) => {
  return postLocalChatbotMessage(req, res);
};

export const postLocalAgentMessageStream = async (req: Express.Request, res: Express.Response) => {
  return postLocalChatbotMessage(req, res);
};
