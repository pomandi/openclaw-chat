import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import { getGatewayWS } from '@/lib/gateway-ws';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Reduced since this is now just an API call, not streaming

// POST /api/gateway/chat — send message via WebSocket, return immediate ACK
export async function POST(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { agentId, message, attachments, sessionKey } = await req.json();

    if (!agentId || !message) {
      return NextResponse.json({ error: 'agentId and message required' }, { status: 400 });
    }

    const gw = getGatewayWS();
    const sk = sessionKey || `agent:${agentId}:main`;

    // Build attachments for WebSocket format
    const wsAttachments = [];
    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        if (att.type === 'image' && att.dataUrl) {
          wsAttachments.push({
            type: 'image_url',
            image_url: { url: att.dataUrl, detail: 'auto' },
          });
        } else if (att.type === 'audio' && att.dataUrl) {
          // Send audio as input_audio in OpenAI multimodal format
          const base64Match = att.dataUrl.match(/^data:[^;]+;base64,(.+)$/);
          if (base64Match) {
            wsAttachments.push({
              type: 'input_audio',
              input_audio: {
                data: base64Match[1],
                format: att.mimeType?.includes('wav') ? 'wav' : 
                        att.mimeType?.includes('mp3') || att.mimeType?.includes('mpeg') ? 'mp3' : 
                        att.mimeType?.includes('mp4') ? 'mp4' : 'wav',
              },
            });
          } else {
            // Fallback: describe as text in message
            const durationStr = att.duration ? ` ${Math.round(att.duration)}s` : '';
            // We'll append this to the message text
          }
        } else if (att.type === 'file') {
          // For non-image files, we'll describe them in the message text
        }
      }
    }

    try {
      const result = await gw.chatSend(sk, message, wsAttachments);
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
