#!/usr/bin/env node
/**
 * Lightweight HTTP server that serves transcript history from JSONL files.
 * Runs on the host and is accessible from Docker containers via host network.
 * 
 * Usage: node transcript-server.mjs
 * Port: 18790 (or TRANSCRIPT_PORT env)
 * Auth: Bearer token matching TRANSCRIPT_TOKEN env (defaults to gateway token)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = parseInt(process.env.TRANSCRIPT_PORT || '18790', 10);
const TOKEN = process.env.TRANSCRIPT_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN || '';
const AGENTS_BASE = process.env.AGENTS_PATH || path.join(process.env.HOME || '/home/claude', '.openclaw', 'agents');

function extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(part => part.type === 'text' && part.text)
      .map(part => part.text)
      .join('\n');
  }
  return '';
}

function parseTranscriptFile(filePath, limit) {
  if (!fs.existsSync(filePath)) return [];
  
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split(/\r?\n/);
  const messages = [];
  
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed?.type !== 'message' || !parsed?.message) continue;
      
      const msg = parsed.message;
      const role = msg.role;
      if (role !== 'user' && role !== 'assistant') continue;
      
      const text = extractTextContent(msg.content);
      if (!text.trim()) continue;
      
      // Skip internal messages
      if (text.startsWith('[cron:') || text.startsWith('[heartbeat')) continue;
      
      const ts = parsed.timestamp
        ? (typeof parsed.timestamp === 'string' ? new Date(parsed.timestamp).getTime() : parsed.timestamp)
        : Date.now();
      
      messages.push({
        id: `hist_${parsed.id || messages.length}_${ts}`,
        role,
        content: text,
        timestamp: ts,
      });
    } catch {
      // skip
    }
  }
  
  return messages.slice(-limit);
}

function getHistory(sessionKey, limit) {
  const parts = sessionKey.split(':');
  if (parts.length < 2 || parts[0] !== 'agent') {
    return { error: 'Invalid sessionKey format' };
  }
  const agentId = parts[1];
  
  const sessionsJsonPath = path.join(AGENTS_BASE, agentId, 'sessions', 'sessions.json');
  if (!fs.existsSync(sessionsJsonPath)) {
    return { messages: [], sessionKey };
  }
  
  const sessionsStore = JSON.parse(fs.readFileSync(sessionsJsonPath, 'utf-8'));
  const entry = sessionsStore[sessionKey];
  
  if (!entry?.sessionId) {
    return { messages: [], sessionKey };
  }
  
  const transcriptPath = path.join(AGENTS_BASE, agentId, 'sessions', `${entry.sessionId}.jsonl`);
  const messages = parseTranscriptFile(transcriptPath, limit);
  
  return {
    messages,
    sessionKey,
    sessionId: entry.sessionId,
    total: messages.length,
  };
}

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // Auth check
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (TOKEN && bearerToken !== TOKEN) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  
  if (url.pathname === '/history' && req.method === 'GET') {
    const sessionKey = url.searchParams.get('sessionKey') || '';
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200);
    
    try {
      const result = getHistory(sessionKey, limit);
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Transcript server listening on port ${PORT}`);
  console.log(`Agents base: ${AGENTS_BASE}`);
});
