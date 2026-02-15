export interface Agent {
  id: string;
  name?: string;
  identity?: {
    name?: string;
    theme?: string;
    emoji?: string;
    avatar?: string;
    avatarUrl?: string;
  };
}

export interface AgentsListResult {
  defaultId: string;
  mainKey: string;
  scope: 'per-sender' | 'global';
  agents: Agent[];
}

export interface Session {
  key: string;
  agentId: string;
  label?: string;
  model?: string;
  createdAt?: number;
  updatedAt?: number;
  lastActivityMs?: number;
  tokens?: { used: number; max: number };
  derivedTitle?: string;
  lastMessage?: {
    role: string;
    content: string;
    ts: number;
  };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  status?: 'sending' | 'sent' | 'error';
  runId?: string;
}

export interface ChatEvent {
  runId: string;
  sessionKey: string;
  seq: number;
  state: 'delta' | 'final' | 'aborted' | 'error';
  message?: any;
  errorMessage?: string;
  usage?: any;
  stopReason?: string;
}

// Agent emoji map for visual identity
export const AGENT_EMOJIS: Record<string, string> = {
  main: '🧠',
  'coding-agent': '💻',
  'ops-monitor': '📊',
  pomamarketing: '📣',
  'fatura-collector': '🧾',
  'mtm-tedarik': '📦',
  'customer-relations': '🤝',
  hr: '👥',
  vision: '👁️',
  security: '🔒',
  'qa-tester': '🧪',
  'product-upload': '📤',
  'seo-agent': '🔍',
  'personal-assistant': '📅',
  'ads-merchant': '📢',
  investor: '💰',
};

export function getAgentEmoji(agentId: string, agent?: Agent): string {
  return agent?.identity?.emoji || AGENT_EMOJIS[agentId] || '🤖';
}

export function getAgentName(agent: Agent): string {
  return agent.identity?.name || agent.name || agent.id;
}
