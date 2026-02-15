// OpenClaw Gateway HTTP Client (server-side)
// Uses the HTTP API endpoints instead of WebSocket for simplicity

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

// Agent info from config (since we know the agents from openclaw.json)
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
  // Return the agents list from config
  // The gateway doesn't expose a simple HTTP endpoint for this
  return {
    defaultId: 'main',
    mainKey: 'agent:main:main',
    scope: 'global',
    agents: AGENTS_CONFIG,
  };
}

export async function sendChatMessage(agentId: string, message: string, sessionKey?: string): Promise<ReadableStream<Uint8Array> | null> {
  const res = await gatewayFetch('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: `openclaw:${agentId}`,
      stream: true,
      messages: [{ role: 'user', content: message }],
      ...(sessionKey ? { user: sessionKey } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gateway error ${res.status}: ${text}`);
  }

  return res.body;
}

export async function sendChatMessageSync(agentId: string, message: string, sessionKey?: string): Promise<string> {
  const res = await gatewayFetch('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: `openclaw:${agentId}`,
      stream: false,
      messages: [{ role: 'user', content: message }],
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
