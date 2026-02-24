// Tiny HTTP file receiver — runs on HOST, saves uploaded files to agent workspaces
import { createServer } from 'http';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

const PORT = 18900;
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || '/home/claude/.openclaw';
const AUTH_TOKEN = process.env.FILE_RECEIVER_TOKEN || 'fr-pomandi-2026';

createServer(async (req, res) => {
  if (req.method !== 'POST' || !req.url?.startsWith('/save')) {
    res.writeHead(404); res.end('Not found'); return;
  }
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${AUTH_TOKEN}`) {
    res.writeHead(401); res.end('Unauthorized'); return;
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const { agentId, fileName, content } = body; // content = base64
    if (!agentId || !fileName || !content) {
      res.writeHead(400); res.end('Missing agentId/fileName/content'); return;
    }
    const ws = agentId === 'main' ? 'workspace' : `workspace-${agentId}`;
    const dir = join(OPENCLAW_HOME, ws, 'uploads');
    await mkdir(dir, { recursive: true });
    const safe = fileName.replace(/[^a-zA-Z0-9._\-\s\u00C0-\u024F\u0400-\u04FF]/g, '_');
    const fp = join(dir, safe);
    await writeFile(fp, Buffer.from(content, 'base64'));
    console.log(`[file-receiver] Saved ${fp} (${Buffer.from(content, 'base64').length} bytes)`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path: fp }));
  } catch (e) {
    console.error('[file-receiver] Error:', e.message);
    res.writeHead(500); res.end(e.message);
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`[file-receiver] Listening on :${PORT}`);
});
