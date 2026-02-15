import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';

// Agents directory - mounted as Docker volume from host
const AGENTS_DIR = process.env.AGENTS_PATH || '/data/agents';

function extractTextContent(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part: any) => part.type === 'text' && part.text)
      .map((part: any) => part.text)
      .join('\n');
  }
  return '';
}

function parseTranscriptFile(filePath: string, limit: number) {
  if (!fs.existsSync(filePath)) return [];
  
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split(/\r?\n/);
  const messages: any[] = [];
  
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      
      // Handle both formats: { type: 'message', message: {...} } and { role: 'user', content: '...' }
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
      
      const ts = parsed.timestamp
        ? (typeof parsed.timestamp === 'string' ? new Date(parsed.timestamp).getTime() : parsed.timestamp)
        : msg.timestamp || Date.now();
      
      messages.push({
        id: `hist_${messages.length}_${ts}`,
        role,
        content: text,
        timestamp: ts,
      });
    } catch {
      // skip unparseable lines
    }
  }
  
  return messages.slice(-limit);
}

function findSessionFile(agentId: string, sessionKey: string): string | null {
  const sessionsDir = path.join(AGENTS_DIR, agentId, 'sessions');
  
  // First try sessions.json mapping
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
  
  // Fallback: find most recent .jsonl file
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

// GET /api/gateway/history?sessionKey=agent:main:main&limit=50
export async function GET(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sessionKey = req.nextUrl.searchParams.get('sessionKey');
  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('limit') || '50', 10) || 50, 1), 200);

  if (!sessionKey) {
    return NextResponse.json({ error: 'sessionKey required' }, { status: 400 });
  }

  const parts = sessionKey.split(':');
  if (parts.length < 2 || parts[0] !== 'agent') {
    return NextResponse.json({ error: 'Invalid sessionKey format' }, { status: 400 });
  }
  
  const agentId = parts[1];

  try {
    const filePath = findSessionFile(agentId, sessionKey);
    if (!filePath) {
      return NextResponse.json({ messages: [], sessionKey });
    }
    
    const messages = parseTranscriptFile(filePath, limit);
    return NextResponse.json({ messages, sessionKey, total: messages.length });
  } catch (err: any) {
    console.error('[API] history error:', err.message);
    return NextResponse.json({ messages: [], sessionKey });
  }
}
