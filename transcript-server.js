#!/usr/bin/env node
/**
 * Lightweight transcript server — reads OpenClaw session JSONL files
 * and serves chat history via HTTP.
 * Runs on port 18790 on the host machine.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 18790;
const AGENTS_DIR = '/home/claude/.openclaw/agents';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

function parseSessionKey(sessionKey) {
  // Format: agent:{agentId}:main or agent:{agentId}:subagent:{id}
  const parts = sessionKey.split(':');
  if (parts.length < 3 || parts[0] !== 'agent') return null;
  return { agentId: parts[1], type: parts[2] };
}

function findLatestSession(agentId) {
  const sessionsDir = path.join(AGENTS_DIR, agentId, 'sessions');
  if (!fs.existsSync(sessionsDir)) return null;
  
  const files = fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.jsonl') && !f.endsWith('.lock'))
    .map(f => ({
      name: f,
      path: path.join(sessionsDir, f),
      mtime: fs.statSync(path.join(sessionsDir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  
  return files[0] || null;
}

function parseTranscript(filePath, limit = 50) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  
  const messages = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      // Extract chat messages (user and assistant roles)
      if (entry.role === 'user' || entry.role === 'assistant') {
        // Skip system/tool messages and internal stuff
        let content = '';
        if (typeof entry.content === 'string') {
          content = entry.content;
        } else if (Array.isArray(entry.content)) {
          // Multimodal content
          content = entry.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n');
        }
        
        // Skip empty, heartbeat, NO_REPLY, HEARTBEAT_OK
        if (!content || 
            content === 'NO_REPLY' || 
            content === 'HEARTBEAT_OK' ||
            content.startsWith('Read HEARTBEAT.md')) continue;
        
        messages.push({
          id: `hist_${messages.length}`,
          role: entry.role,
          content: content,
          timestamp: entry.timestamp || entry.ts || Date.now(),
        });
      }
    } catch (e) {
      // Skip unparseable lines
    }
  }
  
  // Return last N messages
  return messages.slice(-limit);
}

function getAllSessions(agentId) {
  const sessionsDir = path.join(AGENTS_DIR, agentId, 'sessions');
  if (!fs.existsSync(sessionsDir)) return [];
  
  return fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.jsonl') && !f.endsWith('.lock'))
    .map(f => {
      const stat = fs.statSync(path.join(sessionsDir, f));
      return {
        id: f.replace('.jsonl', ''),
        path: path.join(sessionsDir, f),
        size: stat.size,
        modified: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.modified - a.modified);
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  // Auth check
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (GATEWAY_TOKEN && token !== GATEWAY_TOKEN) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  
  if (parsed.pathname === '/history') {
    const sessionKey = parsed.query.sessionKey;
    const limit = parseInt(parsed.query.limit || '50', 10);
    
    if (!sessionKey) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'sessionKey required' }));
      return;
    }
    
    const info = parseSessionKey(sessionKey);
    if (!info) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid sessionKey' }));
      return;
    }
    
    const session = findLatestSession(info.agentId);
    if (!session) {
      res.end(JSON.stringify({ messages: [], sessionKey }));
      return;
    }
    
    try {
      const messages = parseTranscript(session.path, limit);
      res.end(JSON.stringify({ messages, sessionKey, sessionId: session.name.replace('.jsonl', '') }));
    } catch (err) {
      console.error('Parse error:', err.message);
      res.end(JSON.stringify({ messages: [], sessionKey, error: err.message }));
    }
    return;
  }
  
  if (parsed.pathname === '/sessions') {
    const agentId = parsed.query.agentId;
    if (!agentId) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'agentId required' }));
      return;
    }
    
    const sessions = getAllSessions(agentId);
    res.end(JSON.stringify({ sessions, agentId }));
    return;
  }
  
  if (parsed.pathname === '/health') {
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }
  
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Transcript server running on port ${PORT}`);
});
