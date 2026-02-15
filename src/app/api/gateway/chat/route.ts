import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import { streamChatMessage, MessageContent } from '@/lib/gateway';
import { sendPushNotification } from '@/lib/push';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// POST /api/gateway/chat — send message, return streaming SSE response
export async function POST(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { agentId, message, attachments, sessionKey } = await req.json();

    if (!agentId || !message) {
      return NextResponse.json({ error: 'agentId and message required' }, { status: 400 });
    }

    // Build message content - multimodal if attachments present
    let content: string | MessageContent[] = message;
    if (attachments && attachments.length > 0) {
      const parts: MessageContent[] = [];
      if (message.trim()) {
        parts.push({ type: 'text', text: message });
      }
      for (const att of attachments) {
        if (att.type === 'image' && att.dataUrl) {
          parts.push({
            type: 'image_url',
            image_url: { url: att.dataUrl, detail: 'auto' },
          });
        } else if (att.type === 'file') {
          // For non-image files, describe them as text
          parts.push({
            type: 'text',
            text: `[Attached file: ${att.name} (${att.mimeType}, ${Math.round(att.size / 1024)}KB)]`,
          });
        }
      }
      content = parts.length > 0 ? parts : message;
    }

    const gatewayRes = await streamChatMessage(agentId, content, sessionKey);

    if (!gatewayRes.ok) {
      const text = await gatewayRes.text();
      return NextResponse.json({ error: `Gateway error: ${text}` }, { status: 502 });
    }

    if (!gatewayRes.body) {
      return NextResponse.json({ error: 'No response stream' }, { status: 502 });
    }

    // Create a transform stream to collect the full response for push notification
    const reader = gatewayRes.body.getReader();
    let fullResponse = '';

    const stream = new ReadableStream({
      async start(controller) {
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              // Send push notification with collected response
              if (fullResponse.trim()) {
                const preview = fullResponse.length > 100
                  ? fullResponse.substring(0, 100) + '...'
                  : fullResponse;
                sendPushNotification(
                  `${agentId}`,
                  preview,
                  { agentId, url: '/' }
                ).catch(() => {}); // fire and forget
              }
              break;
            }

            // Pass through the chunk
            controller.enqueue(value);

            // Try to extract content from SSE chunks for push notification
            const text = decoder.decode(value, { stream: true });
            const lines = text.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                try {
                  const json = JSON.parse(line.slice(6));
                  const delta = json.choices?.[0]?.delta?.content;
                  if (delta) fullResponse += delta;
                } catch {
                  // ignore parse errors
                }
              }
            }
          }
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err: any) {
    console.error('[API] chat error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
