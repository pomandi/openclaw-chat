import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';

// Transcript files are volume-mounted from host at /data/transcripts
// Host path: /home/claude/.openclaw/agents/{agentId}/sessions/
// Container path: /data/transcripts/{agentId}/sessions/
const TRANSCRIPTS_BASE = process.env.TRANSCRIPTS_PATH || '/data/transcripts';

interface TranscriptMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{ type: string; text?: string; thinking?: string }>;
  timestamp?: number;
}

interface HistoryMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part: any) => part.type === 'text' && part.text)
      .map((part: any) => part.text)
      .join('\n');
  }
  return '';
}

function parseTranscriptFile(filePath: string, limit: number): HistoryMessage[] {
  if (!fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split(/\r?\n/);
  const messages: HistoryMessage[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);

      // Only process message entries
      if (parsed?.type !== 'message' || !parsed?.message) continue;

      const msg = parsed.message as TranscriptMessage;
      const role = msg.role;

      // Only include user and assistant messages
      if (role !== 'user' && role !== 'assistant') continue;

      const text = extractTextContent(msg.content);
      if (!text.trim()) continue;

      // Skip internal/system prefixed messages
      if (text.startsWith('[cron:') || text.startsWith('[heartbeat')) continue;

      const timestamp = parsed.timestamp
        ? (typeof parsed.timestamp === 'string' ? new Date(parsed.timestamp).getTime() : parsed.timestamp)
        : Date.now();

      messages.push({
        id: `hist_${parsed.id || messages.length}_${timestamp}`,
        role,
        content: text,
        timestamp,
      });
    } catch {
      // skip invalid lines
    }
  }

  // Return the last N messages
  return messages.slice(-limit);
}

// GET /api/gateway/history?sessionKey=agent:main:main&limit=50
export async function GET(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sessionKey = req.nextUrl.searchParams.get('sessionKey');
  const limitStr = req.nextUrl.searchParams.get('limit');
  const limit = Math.min(Math.max(parseInt(limitStr || '50', 10) || 50, 1), 200);

  if (!sessionKey) {
    return NextResponse.json({ error: 'sessionKey required' }, { status: 400 });
  }

  // Parse session key: agent:{agentId}:main
  const parts = sessionKey.split(':');
  if (parts.length < 2 || parts[0] !== 'agent') {
    return NextResponse.json({ error: 'Invalid sessionKey format' }, { status: 400 });
  }
  const agentId = parts[1];

  try {
    // Read sessions.json to find the active session ID
    const sessionsJsonPath = path.join(TRANSCRIPTS_BASE, agentId, 'sessions', 'sessions.json');

    if (!fs.existsSync(sessionsJsonPath)) {
      return NextResponse.json({ messages: [], sessionKey });
    }

    const sessionsStore = JSON.parse(fs.readFileSync(sessionsJsonPath, 'utf-8'));
    const entry = sessionsStore[sessionKey];

    if (!entry?.sessionId) {
      return NextResponse.json({ messages: [], sessionKey });
    }

    // Read the transcript JSONL file
    const transcriptPath = path.join(
      TRANSCRIPTS_BASE, agentId, 'sessions', `${entry.sessionId}.jsonl`
    );

    const messages = parseTranscriptFile(transcriptPath, limit);

    return NextResponse.json({
      messages,
      sessionKey,
      sessionId: entry.sessionId,
      total: messages.length,
    });
  } catch (err: any) {
    console.error('[API] history error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
