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

// Find cron session files for an agent (last 24h, max 10 sessions)
function findCronSessionFiles(agentId: string): { path: string; label: string }[] {
  const sessionsDir = path.join(AGENTS_DIR, agentId, 'sessions');
  const sessionsJsonPath = path.join(sessionsDir, 'sessions.json');
  if (!fs.existsSync(sessionsJsonPath)) return [];

  const results: { path: string; label: string; updatedAt: number }[] = [];
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  try {
    const store = JSON.parse(fs.readFileSync(sessionsJsonPath, 'utf-8'));
    for (const [key, entry] of Object.entries(store) as [string, any][]) {
      // Match cron sessions: agent:{id}:cron:{cronId} (not :run: sub-sessions)
      if (!key.includes(':cron:') || key.includes(':run:')) continue;
      const updatedAt = entry?.updatedAt || 0;
      if (updatedAt < oneDayAgo) continue;
      if (!entry?.sessionId) continue;

      const transcriptPath = path.join(sessionsDir, `${entry.sessionId}.jsonl`);
      if (!fs.existsSync(transcriptPath)) continue;

      const label = entry?.label || key.split(':cron:')[1]?.substring(0, 8) || 'cron';
      results.push({ path: transcriptPath, label, updatedAt });
    }
  } catch {}

  return results
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 10)
    .map(r => ({ path: r.path, label: r.label }));
}

// Parse cron transcript — extract only the final assistant response (the report)
function parseCronTranscript(filePath: string, label: string): any[] {
  if (!fs.existsSync(filePath)) return [];

  // Read only last 16KB for efficiency
  const fd = fs.openSync(filePath, 'r');
  const stat = fs.fstatSync(fd);
  const readSize = Math.min(stat.size, 16384);
  const buffer = Buffer.alloc(readSize);
  fs.readSync(fd, buffer, 0, readSize, stat.size - readSize);
  fs.closeSync(fd);

  const raw = buffer.toString('utf-8');
  const lines = raw.split(/\r?\n/);
  // Skip potentially partial first line from the cut
  if (stat.size > readSize) lines.shift();

  // Find last assistant message
  let lastAssistant: { text: string; ts: number } | null = null;

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
        : msg.timestamp || Date.now();

      lastAssistant = { text, ts };
    } catch {}
  }

  if (!lastAssistant) return [];

  return [{
    id: `cron_${label}_${lastAssistant.ts}`,
    role: 'assistant',
    content: `📋 **${label}**\n\n${lastAssistant.text}`,
    timestamp: lastAssistant.ts,
    isCron: true,
  }];
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
    // Get main session messages (Telegram / webchat)
    const mainKey = `agent:${agentId}:main`;
    const mainFile = findSessionFile(agentId, mainKey);
    const mainMessages = mainFile ? parseTranscriptFile(mainFile, limit) : [];

    // Get app session messages (web app)
    const appKey = `agent:${agentId}:app`;
    const appFile = findSessionFile(agentId, appKey);
    const appMessages = appFile ? parseTranscriptFile(appFile, limit) : [];

    // Get cron session messages (last 24h)
    const cronFiles = findCronSessionFiles(agentId);
    const cronMessages: any[] = [];
    for (const cf of cronFiles) {
      cronMessages.push(...parseCronTranscript(cf.path, cf.label));
    }

    // Merge all sources and sort by timestamp
    const allMessages = [...mainMessages, ...appMessages, ...cronMessages]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-limit);

    return NextResponse.json({ messages: allMessages, sessionKey, total: allMessages.length });
  } catch (err: any) {
    console.error('[API] history error:', err.message);
    return NextResponse.json({ messages: [], sessionKey });
  }
}
