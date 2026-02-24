import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import { getGatewayWS } from '@/lib/gateway-ws';
import { inferMimeTypeFromFilename } from '@/lib/types';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Reduced since this is now just an API call, not streaming

// POST /api/gateway/chat — send message via WebSocket, return immediate ACK
export async function POST(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { agentId, message, attachments, sessionKey } = await req.json();

    const hasMessage = typeof message === 'string' && message.trim().length > 0;
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;

    if (!agentId || (!hasMessage && !hasAttachments)) {
      return NextResponse.json({ error: 'agentId and message/attachment required' }, { status: 400 });
    }

    const gw = getGatewayWS();
    const sk = sessionKey || `agent:${agentId}:main`;

    // Build attachments for Gateway RPC format
    const wsAttachments: Array<{
      type: string;
      mimeType: string;
      fileName: string;
      content: string;
    }> = [];

    const attachmentNotes: string[] = [];
    const seenAttachmentKeys = new Set<string>();
    const seenNoteKeys = new Set<string>();

    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        if (!att?.dataUrl) continue;

        const base64Match = String(att.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
        const base64Content = base64Match?.[2];
        if (!base64Content) continue;

        const inferredMime = inferMimeTypeFromFilename(att.name);
        const mimeType = (att.mimeType || base64Match?.[1] || inferredMime || 'application/octet-stream').toLowerCase();
        const fileName = att.name || `attachment-${Date.now()}`;

        const attachmentKey = `${fileName.toLowerCase()}|${mimeType}|${base64Content.length}`;
        if (seenAttachmentKeys.has(attachmentKey)) continue;
        seenAttachmentKeys.add(attachmentKey);

        wsAttachments.push({
          type: att.type || 'file',
          mimeType,
          fileName,
          content: base64Content,
        });

        // Fallback note so assistant still sees non-image docs if backend profile drops them.
        if (att.type === 'file') {
          const noteKey = `${fileName.toLowerCase()}|${mimeType}`;
          if (seenNoteKeys.has(noteKey)) continue;
          seenNoteKeys.add(noteKey);

          if (mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
            attachmentNotes.push(`[PDF attached: ${fileName}]`);
          } else if (fileName.toLowerCase().endsWith('.psd') || mimeType.includes('photoshop')) {
            attachmentNotes.push(`[PSD attached: ${fileName}]`);
          } else {
            attachmentNotes.push(`[File attached: ${fileName}]`);
          }
        }
      }
    }

    // Save non-image files to the target agent's workspace via host gateway
    const savedFilePaths: string[] = [];
    for (const att of wsAttachments) {
      const isImage = att.mimeType.startsWith('image/') && !att.mimeType.includes('photoshop');
      if (isImage) continue;

      try {
        const safeName = att.fileName.replace(/[^a-zA-Z0-9._\-\s\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF]/g, '_');
        const workspaceName = agentId === 'main' ? 'workspace' : `workspace-${agentId}`;
        const relPath = `${workspaceName}/uploads/${safeName}`;

        // Use gateway HTTP to save file on host via exec-like endpoint
        const gwHttpUrl = process.env.OPENCLAW_GATEWAY_HTTP_URL || 'https://gw.pomandi.com';
        const gwToken = process.env.OPENCLAW_GATEWAY_TOKEN || '';

        // Try saving via multiple paths (volume mount or gateway)
        const possiblePaths = [
          '/data/openclaw-home',           // Docker volume mount
          process.env.HOME ? join(process.env.HOME, '.openclaw') : null,  // Direct host
        ].filter(Boolean) as string[];

        let saved = false;
        for (const basePath of possiblePaths) {
          try {
            const workspaceDir = join(basePath, workspaceName);
            const uploadsDir = join(workspaceDir, 'uploads');
            await mkdir(uploadsDir, { recursive: true });
            const filePath = join(uploadsDir, safeName);
            await writeFile(filePath, Buffer.from(att.content, 'base64'));

            // Map container path to host path for agent access
            const hostPath = filePath.replace('/data/openclaw-home', '/home/claude/.openclaw');
            savedFilePaths.push(hostPath);
            console.log(`[API] Saved attachment: ${filePath} → host: ${hostPath} (${att.mimeType}, ${Buffer.from(att.content, 'base64').length} bytes)`);
            saved = true;
            break;
          } catch (pathErr: any) {
            console.warn(`[API] Path ${basePath} failed: ${pathErr.message}`);
          }
        }

        if (!saved) {
          console.error(`[API] Could not save ${att.fileName} to any path`);
        }
      } catch (saveErr: any) {
        console.error(`[API] Failed to save attachment ${att.fileName}:`, saveErr.message);
      }
    }

    // Build message with file paths so agent can access them
    const baseMessage = typeof message === 'string' ? message : '';
    const allNotes = [...attachmentNotes];
    if (savedFilePaths.length > 0) {
      allNotes.push(`[Files saved to disk: ${savedFilePaths.join(', ')}]`);
    }
    const outboundMessage = allNotes.length > 0
      ? `${baseMessage}\n${allNotes.join('\n')}`.trim()
      : baseMessage;

    try {
      const result = await gw.chatSend(sk, outboundMessage, wsAttachments);
      return NextResponse.json({ ok: true, ...result });
    } catch (err: any) {
      console.error('[API] WebSocket chat error:', err.message);
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
  } catch (err: any) {
    console.error('[API] chat error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
