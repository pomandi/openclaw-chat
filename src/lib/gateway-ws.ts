import WebSocket from 'ws';
import { EventEmitter } from 'events';
import crypto from 'crypto';

const GATEWAY_WS_URL = process.env.OPENCLAW_GATEWAY_HTTP_URL?.replace('http', 'ws') || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

class GatewayWSClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectTimer: any = null;
  private pendingRequests = new Map<string, { resolve: Function; reject: Function; timeout: any }>();
  
  constructor() {
    super();
    this.setMaxListeners(100); // SSE connections
    this.connect();
  }
  
  private connect() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
    
    this.ws = new WebSocket(GATEWAY_WS_URL, {
      headers: { origin: 'https://app.pomandi.com' },
    });
    
    this.ws.on('open', () => this.handshake());
    this.ws.on('message', (data) => this.handleMessage(data.toString()));
    this.ws.on('close', () => this.handleDisconnect());
    this.ws.on('error', (err) => console.error('[GW-WS] error:', err.message));
  }
  
  private async handshake() {
    const id = this.genId();
    const connectReq = {
      type: 'req',
      id,
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'openclaw-control-ui',
          version: '1.0.0',
          platform: 'web',
          mode: 'webchat',
        },
        role: 'operator',
        scopes: ['operator.read', 'operator.write', 'operator.admin'],
        caps: [],
        auth: { token: GATEWAY_TOKEN },
      },
    };
    // Register in pendingRequests so hello-ok response is handled
    const timeout = setTimeout(() => {
      this.pendingRequests.delete(id);
      console.error('[GW-WS] Handshake timed out after 15s');
    }, 15000);
    this.pendingRequests.set(id, {
      resolve: () => {},
      reject: (err: Error) => console.error('[GW-WS] Handshake rejected:', err.message),
      timeout,
    });
    this.send(connectReq);
  }
  
  private handleMessage(raw: string) {
    try {
      const msg = JSON.parse(raw);
      
      if (msg.type === 'res') {
        // Response to a request
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          clearTimeout(pending.timeout);
          if (msg.ok) {
            // Check for hello-ok (connect response)
            if (msg.payload?.type === 'hello-ok') {
              this.connected = true;
              console.log('[GW-WS] Connected to gateway, protocol:', msg.payload.protocol);
              this.emit('connected');
            }
            pending.resolve(msg.payload);
          } else {
            pending.reject(new Error(msg.error?.message || 'Request failed'));
          }
        }
      } else if (msg.type === 'event') {
        // Event from gateway (chat deltas, finals, proactive messages)
        this.emit('gateway-event', msg);
        
        // Also emit specific event types
        if (msg.event === 'chat') {
          this.emit('chat', msg.payload);
        }
      }
    } catch (err) {
      console.error('[GW-WS] parse error:', err);
    }
  }
  
  private handleDisconnect() {
    this.connected = false;
    console.log('[GW-WS] Disconnected, reconnecting in 3s...');
    this.reconnectTimer = setTimeout(() => this.connect(), 3000);
  }
  
  // Send a request and wait for response
  async request(method: string, params: any, timeoutMs = 30000): Promise<any> {
    // Wait up to 10s for handshake to complete if WS is open but not yet connected
    if (this.ws?.readyState === WebSocket.OPEN && !this.connected) {
      await new Promise<void>((resolve) => {
        const check = () => {
          if (this.connected) { resolve(); return; }
          setTimeout(check, 100);
        };
        setTimeout(() => resolve(), 10000); // give up after 10s
        check();
      });
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.connected) {
      throw new Error('Gateway not connected');
    }
    
    const id = this.genId();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${method} timed out`));
      }, timeoutMs);
      
      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.send({ type: 'req', id, method, params });
    });
  }
  
  // Chat methods
  async chatSend(sessionKey: string, message: string, attachments?: any[]) {
    return this.request('chat.send', {
      sessionKey,
      message,
      attachments,
      idempotencyKey: this.genId(),
    }, 60000);
  }
  
  async chatHistory(sessionKey: string, limit = 100) {
    return this.request('chat.history', { sessionKey, limit });
  }
  
  async chatAbort(sessionKey: string) {
    return this.request('chat.abort', { sessionKey, idempotencyKey: this.genId() });
  }
  
  private send(data: any) {
    this.ws?.send(JSON.stringify(data));
  }
  
  private genId() {
    return crypto.randomUUID();
  }
  
  isConnected() { return this.connected; }
  
  close() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}

// Singleton — survives across requests in standalone Node.js
// Use globalThis to survive HMR in development
let instance: GatewayWSClient | null = null;
export function getGatewayWS(): GatewayWSClient {
  if (!instance) {
    instance = new GatewayWSClient();
    // Store on globalThis for HMR persistence
    (globalThis as any).__gatewayWS = instance;
  }
  return instance;
}