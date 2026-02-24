import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import { getGatewayWS } from '@/lib/gateway-ws';
import { inferMimeTypeFromFilename } from '@/lib/types';

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

    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        if (!att?.dataUrl) continue;

        const base64Match = String(att.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
        const base64Content = base64Match?.[2];
        if (!base64Content) continue;

        const inferredMime = inferMimeTypeFromFilename(att.name);
        const mimeType = (att.mimeType || base64Match?.[1] || inferredMime || 'application/octet-stream').toLowerCase();
        const fileName = att.name || `attachment-${Date.now()}`;

        wsAttachments.push({
          type: att.type || 'file',
          mimeType,
          fileName,
          content: base64Content,
        });

        // Fallback note so assistant still sees non-image docs if backend profile drops them.
        if (att.type === 'file') {
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

    const baseMessage = typeof message === 'string' ? message : '';
    const outboundMessage = attachmentNotes.length > 0
      ? `${baseMessage}\n${attachmentNotes.join('\n')}`.trim()
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
