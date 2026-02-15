// OpenClaw Gateway HTTP Client (server-side)
// Uses the HTTP API endpoints

const GATEWAY_HTTP_URL = process.env.OPENCLAW_GATEWAY_HTTP_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

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

// Agent info from config
const AGENTS_CONFIG = [
  { id: 'main', name: 'CEO Agent' },
  { id: 'coding-agent', name: 'Poma Coding Agent' },
  { id: 'ops-monitor', name: 'Ops Monitor' },
  { id: 'pomamarketing', name: 'Poma Marketing' },
  { id: 'fatura-collector', name: 'Fatura Collector' },
  { id: 'mtm-tedarik', name: 'MTM Tedarik Yonetimi' },
  { id: 'customer-relations', name: 'Poma CRM' },
  { id: 'hr', name: 'Poma HR' },
  { id: 'vision', name: 'Poma Vision' },
  { id: 'security', name: 'Poma Security' },
  { id: 'qa-tester', name: 'Poma QA Tester' },
  { id: 'product-upload', name: 'Product Upload' },
  { id: 'seo-agent', name: 'Poma SEO Agent' },
  { id: 'personal-assistant', name: 'Personal Assistant' },
  { id: 'ads-merchant', name: 'Ads & Merchant Center' },
  { id: 'investor', name: 'Investment Tracker' },
];

export async function listAgents() {
  return {
    defaultId: 'main',
    mainKey: 'agent:main:main',
    scope: 'global',
    agents: AGENTS_CONFIG,
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

  const res = await gatewayFetch('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: `openclaw:${agentId}`,
      stream: true,
      messages: [{ role: 'user', content }],
      ...(sessionKey ? { user: sessionKey } : {}),
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

  const res = await gatewayFetch('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: `openclaw:${agentId}`,
      stream: false,
      messages: [{ role: 'user', content }],
      ...(sessionKey ? { user: sessionKey } : {}),
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
