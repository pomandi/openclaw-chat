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

export interface Attachment {
  id: string;
  type: 'image' | 'file' | 'audio';
  name: string;
  size: number;
  mimeType: string;
  dataUrl: string; // base64 data URL
  previewUrl?: string; // for images, a thumbnail
  duration?: number; // for audio, in seconds
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  status?: 'sending' | 'sent' | 'error';
  runId?: string;
  attachments?: Attachment[];
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
  'web-analytics': '📊',
  gatekeeper: '🚪',
};

export function getAgentEmoji(agentId: string, agent?: Agent): string {
  return agent?.identity?.emoji || AGENT_EMOJIS[agentId] || '🤖';
}

export function getAgentName(agent: Agent): string {
  return agent.identity?.name || agent.name || agent.id;
}

// Max file size: 10MB
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Supported file types
export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
export const SUPPORTED_AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'];
export const SUPPORTED_PDF_TYPES = ['application/pdf'];
export const SUPPORTED_PSD_TYPES = [
  'image/vnd.adobe.photoshop',
  'image/x-photoshop',
  'application/photoshop',
  'application/x-photoshop',
];

// Used by <input accept="..."> (include extensions for iOS/Safari file pickers)
export const SUPPORTED_FILE_TYPES = [
  'image/*',
  ...SUPPORTED_IMAGE_TYPES,
  ...SUPPORTED_PDF_TYPES,
  ...SUPPORTED_PSD_TYPES,
  '.pdf',
  '.psd',
];

export function inferMimeTypeFromFilename(fileName?: string): string | undefined {
  if (!fileName) return undefined;
  const ext = fileName.toLowerCase().split('.').pop();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'pdf':
      return 'application/pdf';
    case 'psd':
      return 'image/vnd.adobe.photoshop';
    default:
      return undefined;
  }
}
