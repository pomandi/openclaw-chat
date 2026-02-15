import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';

const AGENTS_DIR = process.env.AGENTS_PATH || '/data/agents';

// Agent IDs we care about
const AGENT_IDS = [
  'main', 'coding-agent', 'ops-monitor', 'pomamarketing',
  'fatura-collector', 'mtm-tedarik', 'customer-relations', 'hr',
  'vision', 'security', 'qa-tester', 'product-upload',
  'seo-agent', 'personal-assistant', 'ads-merchant', 'investor',
];

function extractTextContent(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part: any) => part.type === 'text' && part.text)
      .map((part: any) => part.text)
      .join(' ');
  }
  return '';
}

function findSessionFile(agentId: string): string | null {
  const sessionsDir = path.join(AGENTS_DIR, agentId, 'sessions');
  const sessionKey = `agent:${agentId}:main`;
  
  // Try sessions.json mapping first
  const sessionsJsonPath = path.join(sessionsDir, 'sessions.json');
  if (fs.existsSync(sessionsJsonPath)) {
    try {
      const store = JSON.parse(fs.readFileSync(sessionsJsonPath, 'utf-8'));
      const entry = store[sessionKey];
      if (entry?.sessionId) {
        const transcriptPath = path.join(sessionsDir, `${entry.sessionId}.jsonl`);
        if (fs.existsSync(transcriptPath)) return transcriptPath;
      }
    } catch {}
  }
  
  // Fallback: most recent .jsonl
  if (!fs.existsSync(sessionsDir)) return null;
  const files = fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.jsonl') && !f.endsWith('.lock'))
    .map(f => ({
      path: path.join(sessionsDir, f),
      mtime: fs.statSync(path.join(sessionsDir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  
  return files[0]?.path || null;
}

interface AgentLatest {
  lastTs: number;
  lastAssistantTs: number;
  preview: string;
  previewRole: 'user' | 'assistant';
}

/** Read only the tail of a file (last ~32KB) to avoid loading huge JSONL files */
function readTailLines(filePath: string, maxBytes = 32768): string[] {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const size = stat.size;
    if (size === 0) return [];
    
    const readSize = Math.min(maxBytes, size);
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, size - readSize);
    
    const raw = buffer.toString('utf-8');
    const lines = raw.split(/\r?\n/);
    
    // First line may be partial (cut mid-line), skip it unless we read from start
    if (readSize < size) {
      lines.shift();
    }
    
    return lines;
  } finally {
    fs.closeSync(fd);
  }
}

function getAgentLatest(agentId: string): AgentLatest | null {
  const filePath = findSessionFile(agentId);
  if (!filePath) return null;
  
  try {
    const lines = readTailLines(filePath);
    
    let lastTs = 0;
    let lastAssistantTs = 0;
    let preview = '';
    let previewRole: 'user' | 'assistant' = 'assistant';
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const parsed = JSON.parse(line);
        let msg = parsed;
        if (parsed?.type === 'message' && parsed?.message) {
          msg = parsed.message;
        }
        
        const role = msg.role;
        if (role !== 'user' && role !== 'assistant') continue;
        
        const text = extractTextContent(msg.content);
        if (!text.trim()) continue;
        
        // Skip internal messages
        if (text === 'NO_REPLY' || text === 'HEARTBEAT_OK') continue;
        if (text.startsWith('Read HEARTBEAT.md')) continue;
        if (text.startsWith('[cron:') || text.startsWith('[heartbeat')) continue;
        if (text.startsWith('Pre-compaction memory flush')) continue;
        if (text.startsWith('[System Message]')) continue;
        
        const ts = parsed.timestamp
          ? (typeof parsed.timestamp === 'string' ? new Date(parsed.timestamp).getTime() : parsed.timestamp)
          : msg.timestamp || 0;
        
        if (ts > lastTs) {
          lastTs = ts;
          preview = text.substring(0, 100);
          previewRole = role;
        }
        
        if (role === 'assistant' && ts > lastAssistantTs) {
          lastAssistantTs = ts;
        }
      } catch {
        // skip malformed lines
      }
    }
    
    if (lastTs === 0) return null;
    return { lastTs, lastAssistantTs, preview, previewRole };
  } catch {
    return null;
  }
}

// Check cron sessions for latest message (last 24h)
function getCronLatest(agentId: string): AgentLatest | null {
  const sessionsDir = path.join(AGENTS_DIR, agentId, 'sessions');
  const sessionsJsonPath = path.join(sessionsDir, 'sessions.json');
  if (!fs.existsSync(sessionsJsonPath)) return null;

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  let bestTs = 0;
  let bestPreview = '';

  try {
    const store = JSON.parse(fs.readFileSync(sessionsJsonPath, 'utf-8'));
    for (const [key, entry] of Object.entries(store) as [string, any][]) {
      if (!key.includes(':cron:') || key.includes(':run:')) continue;
      const updatedAt = entry?.updatedAt || 0;
      if (updatedAt < oneDayAgo || updatedAt <= bestTs) continue;
      if (!entry?.sessionId) continue;

      const transcriptPath = path.join(sessionsDir, `${entry.sessionId}.jsonl`);
      if (!fs.existsSync(transcriptPath)) continue;

      // Read last few lines to get the final assistant message
      try {
        const lines = readTailLines(transcriptPath, 8192);
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            let msg = parsed;
            if (parsed?.type === 'message' && parsed?.message) msg = parsed.message;
            if (msg.role !== 'assistant') continue;
            const text = extractTextContent(msg.content);
            if (!text.trim() || text === 'NO_REPLY' || text === 'HEARTBEAT_OK') continue;

            const ts = parsed.timestamp
              ? (typeof parsed.timestamp === 'string' ? new Date(parsed.timestamp).getTime() : parsed.timestamp)
              : msg.timestamp || 0;

            if (ts > bestTs) {
              bestTs = ts;
              const label = entry?.label || 'Cron';
              bestPreview = `📋 ${label}: ${text.substring(0, 80)}`;
            }
          } catch {}
        }
      } catch {}
    }
  } catch {}

  if (bestTs === 0) return null;
  return { lastTs: bestTs, lastAssistantTs: bestTs, preview: bestPreview, previewRole: 'assistant' };
}

// GET /api/gateway/unread — returns latest message info for all agents
export async function GET(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const result: Record<string, AgentLatest> = {};
  
  for (const agentId of AGENT_IDS) {
    const mainLatest = getAgentLatest(agentId);
    const cronLatest = getCronLatest(agentId);

    // Use whichever is more recent
    if (mainLatest && cronLatest) {
      result[agentId] = cronLatest.lastTs > mainLatest.lastTs ? cronLatest : mainLatest;
    } else if (mainLatest) {
      result[agentId] = mainLatest;
    } else if (cronLatest) {
      result[agentId] = cronLatest;
    }
  }
  
  return NextResponse.json(result);
}
