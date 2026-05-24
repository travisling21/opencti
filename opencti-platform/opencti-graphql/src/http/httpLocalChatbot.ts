import type Express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import conf, { logApp } from '../config/conf';
import { createAuthenticatedContext } from './httpAuthenticatedContext';

const AI_TOKEN = conf.get('ai:token');
const AI_MODEL = conf.get('ai:model') || 'claude-3-5-sonnet-20241022';
const AI_MAX_TOKENS = Number(conf.get('ai:max_tokens')) || 4096;

const SYSTEM_PROMPT = `You are Ariane, an AI assistant embedded in OpenCTI, an open-source cyber threat intelligence platform. You help analysts with:
- Understanding cyber threats, threat actors, campaigns, malware, and vulnerabilities
- Analyzing indicators of compromise (IOCs) and STIX 2.1 data
- Writing threat intelligence reports
- Explaining attack patterns and MITRE ATT&CK techniques
- General cybersecurity questions

Be concise and professional. Use markdown formatting when helpful. When referencing OpenCTI entities, mention their type (e.g., "Indicator", "Threat Actor", "Report").`;

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

const sessions = new Map<string, ConversationMessage[]>();

const getAnthropicClient = (): Anthropic | null => {
  if (!AI_TOKEN) return null;
  return new Anthropic({ apiKey: AI_TOKEN });
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
        description: 'AI-powered cyber threat intelligence assistant using Claude',
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

    let history = sessions.get(conversationId) || [];
    history.push({ role: 'user', content });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.status(200);

    const messageId = uuidv4();
    res.write(`data: ${JSON.stringify({ type: 'session', conversation_id: conversationId || messageId })}\n\n`);

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
        res.write(`data: ${JSON.stringify({ type: 'content', content: fullResponse })}\n\n`);
      }
    }

    history.push({ role: 'assistant', content: fullResponse });
    if (conversationId) {
      sessions.set(conversationId, history);
    }

    res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
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
