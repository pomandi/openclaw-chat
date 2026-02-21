// OpenClaw Gateway HTTP Client (server-side)
// Uses the HTTP API endpoints

import fs from 'fs';

const GATEWAY_HTTP_URL = process.env.OPENCLAW_GATEWAY_HTTP_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';
const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || '/data/openclaw.json';

async function gatewayFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${GATEWAY_HTTP_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  return res;
}

// Cache for agent list (30 second TTL)
let agentsCache: { agents: { id: string; name: string }[]; ts: number } | null = null;
const CACHE_TTL = 30_000;

function readAgentsFromConfig(): { id: string; name: string }[] {
  const raw = fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8');
  const config = JSON.parse(raw);
  const list: { id: string; name?: string }[] = config?.agents?.list || [];
  return list.map((a) => ({
    id: a.id,
    name: a.name || a.id,
  }));
}

export async function listAgents() {
  const now = Date.now();
  if (!agentsCache || now - agentsCache.ts > CACHE_TTL) {
    try {
      const agents = readAgentsFromConfig();
      agentsCache = { agents, ts: now };
    } catch (err) {
      console.error('[gateway] Failed to read agents from config:', err);
      // Return cached if available, otherwise empty
      if (!agentsCache) {
        agentsCache = { agents: [{ id: 'main', name: 'CEO Agent' }], ts: now };
      }
    }
  }
  return {
    defaultId: 'main',
    mainKey: 'agent:main:main',
    scope: 'global',
    agents: agentsCache.agents,
  };
}

export interface MessageContent {
  type: 'text' | 'image_url' | 'input_audio';
  text?: string;
  image_url?: { url: string; detail?: string };
  input_audio?: { data: string; format: string };
}

export async function streamChatMessage(
  agentId: string,
  message: string | MessageContent[],
  sessionKey?: string
): Promise<Response> {
  // Build content - either simple string or multimodal array
  const content = typeof message === 'string' ? message : message;

  // Use X-OpenClaw-Session-Key header to route to the agent's app session
  // Separate from webchat/Telegram to avoid queue conflicts
  const mainSessionKey = sessionKey || `agent:${agentId}:app`;

  const res = await gatewayFetch('/v1/chat/completions', {
    method: 'POST',
    headers: {
      'X-OpenClaw-Session-Key': mainSessionKey,
    },
    body: JSON.stringify({
      model: `openclaw:${agentId}`,
      stream: true,
      messages: [{ role: 'user', content }],
    }),
  });

  return res;
}

export async function sendChatMessageSync(
  agentId: string,
  message: string | MessageContent[],
  sessionKey?: string
): Promise<string> {
  const content = typeof message === 'string' ? message : message;

  const key = sessionKey || `agent:${agentId}:app`;

  const res = await gatewayFetch('/v1/chat/completions', {
    method: 'POST',
    headers: {
      'X-OpenClaw-Session-Key': key,
    },
    body: JSON.stringify({
      model: `openclaw:${agentId}`,
      stream: false,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gateway error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

export async function checkGatewayHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${GATEWAY_HTTP_URL}/`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return res.ok || res.status === 200;
  } catch {
    return false;
  }
}
