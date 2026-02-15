// OpenClaw Gateway WebSocket Client (server-side)
// Used by API routes to proxy requests to the gateway

import { WebSocket } from 'ws';

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';
const PROTOCOL_VERSION = 3;

let wsConnection: WebSocket | null = null;
let connectionPromise: Promise<WebSocket> | null = null;
let messageId = 0;
const pendingRequests = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();
const eventListeners = new Map<string, Set<(payload: any) => void>>();

function generateId(): string {
  return `req_${++messageId}_${Date.now()}`;
}

function generateDeviceId(): string {
  return 'openclaw-chat-' + Math.random().toString(36).slice(2, 10);
}

export function onGatewayEvent(event: string, handler: (payload: any) => void): () => void {
  if (!eventListeners.has(event)) {
    eventListeners.set(event, new Set());
  }
  eventListeners.get(event)!.add(handler);
  return () => {
    eventListeners.get(event)?.delete(handler);
  };
}

function handleGatewayMessage(data: string) {
  try {
    const frame = JSON.parse(data);
    
    if (frame.type === 'res') {
      const pending = pendingRequests.get(frame.id);
      if (pending) {
        pendingRequests.delete(frame.id);
        if (frame.ok) {
          pending.resolve(frame.payload);
        } else {
          pending.reject(new Error(frame.error?.message || 'Gateway request failed'));
        }
      }
    } else if (frame.type === 'event') {
      const listeners = eventListeners.get(frame.event);
      if (listeners) {
        for (const handler of listeners) {
          handler(frame.payload);
        }
      }
      // Also emit to wildcard listeners
      const allListeners = eventListeners.get('*');
      if (allListeners) {
        for (const handler of allListeners) {
          handler({ event: frame.event, payload: frame.payload });
        }
      }
    }
  } catch (e) {
    console.error('[Gateway] Failed to parse message:', e);
  }
}

async function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATEWAY_URL);
    let connected = false;

    ws.on('open', () => {
      // Wait for challenge, then send connect
    });

    ws.on('message', (raw) => {
      const data = raw.toString();
      
      if (!connected) {
        try {
          const frame = JSON.parse(data);
          
          // Handle challenge
          if (frame.type === 'event' && frame.event === 'connect.challenge') {
            const connectReq = {
              type: 'req',
              id: generateId(),
              method: 'connect',
              params: {
                minProtocol: PROTOCOL_VERSION,
                maxProtocol: PROTOCOL_VERSION,
                client: {
                  id: 'openclaw-chat',
                  version: '1.0.0',
                  platform: 'web',
                  mode: 'operator',
                },
                role: 'operator',
                scopes: ['operator.read', 'operator.write'],
                caps: [],
                commands: [],
                permissions: {},
                auth: { token: GATEWAY_TOKEN },
                locale: 'en-US',
                userAgent: 'openclaw-chat/1.0.0',
              },
            };
            ws.send(JSON.stringify(connectReq));
            return;
          }
          
          // Handle hello-ok
          if (frame.type === 'res' && frame.ok && frame.payload?.type === 'hello-ok') {
            connected = true;
            resolve(ws);
            return;
          }
          
          // Handle auth failure
          if (frame.type === 'res' && !frame.ok) {
            reject(new Error(frame.error?.message || 'Connection failed'));
            ws.close();
            return;
          }
        } catch (e) {
          // Skip non-JSON during handshake
        }
      } else {
        handleGatewayMessage(data);
      }
    });

    ws.on('error', (err) => {
      console.error('[Gateway] WS error:', err.message);
      if (!connected) {
        reject(err);
      }
    });

    ws.on('close', () => {
      if (ws === wsConnection) {
        wsConnection = null;
        connectionPromise = null;
      }
      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        pending.reject(new Error('Connection closed'));
        pendingRequests.delete(id);
      }
    });

    // Timeout
    setTimeout(() => {
      if (!connected) {
        ws.close();
        reject(new Error('Connection timeout'));
      }
    }, 10000);
  });
}

export async function getConnection(): Promise<WebSocket> {
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    return wsConnection;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = connect().then((ws) => {
    wsConnection = ws;
    return ws;
  }).catch((err) => {
    connectionPromise = null;
    throw err;
  });

  return connectionPromise;
}

export async function gatewayRequest<T = any>(method: string, params: Record<string, any> = {}): Promise<T> {
  const ws = await getConnection();
  const id = generateId();
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Request timeout: ${method}`));
    }, 30000);

    pendingRequests.set(id, {
      resolve: (v) => {
        clearTimeout(timeout);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timeout);
        reject(e);
      },
    });

    ws.send(JSON.stringify({
      type: 'req',
      id,
      method,
      params,
    }));
  });
}

// Convenience methods

export async function listAgents() {
  return gatewayRequest('agents.list');
}

export async function listSessions(params: {
  agentId?: string;
  limit?: number;
  includeDerivedTitles?: boolean;
  includeLastMessage?: boolean;
} = {}) {
  return gatewayRequest('sessions.list', {
    limit: 50,
    includeDerivedTitles: true,
    includeLastMessage: true,
    ...params,
  });
}

export async function getChatHistory(sessionKey: string, limit = 100) {
  return gatewayRequest('chat.history', { sessionKey, limit });
}

export async function sendChatMessage(sessionKey: string, message: string) {
  const idempotencyKey = `chat_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return gatewayRequest('chat.send', {
    sessionKey,
    message,
    deliver: true,
    idempotencyKey,
  });
}

export async function abortChat(sessionKey: string, runId?: string) {
  return gatewayRequest('chat.abort', { sessionKey, ...(runId ? { runId } : {}) });
}

export async function getAgentIdentity(agentId: string) {
  return gatewayRequest('agent.identity', { agentId });
}

export async function getSnapshot() {
  return gatewayRequest('snapshot');
}
