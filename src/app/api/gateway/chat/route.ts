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
      if (message.trim() && message !== '[Voice message]') {
        parts.push({ type: 'text', text: message });
      }
      for (const att of attachments) {
        if (att.type === 'image' && att.dataUrl) {
          parts.push({
            type: 'image_url',
            image_url: { url: att.dataUrl, detail: 'auto' },
          });
        } else if (att.type === 'audio' && att.dataUrl) {
          // Send audio as input_audio in OpenAI multimodal format
          // Extract base64 data from data URL
          const base64Match = att.dataUrl.match(/^data:[^;]+;base64,(.+)$/);
          if (base64Match) {
            parts.push({
              type: 'input_audio' as any,
              input_audio: {
                data: base64Match[1],
                format: att.mimeType?.includes('wav') ? 'wav' : 
                        att.mimeType?.includes('mp3') || att.mimeType?.includes('mpeg') ? 'mp3' : 
                        att.mimeType?.includes('mp4') ? 'mp4' : 'wav',
              },
            } as any);
          } else {
            // Fallback: describe as text
            const durationStr = att.duration ? ` ${Math.round(att.duration)}s` : '';
            parts.push({
              type: 'text',
              text: `[Voice message${durationStr} - audio attached (${att.mimeType})]`,
            });
          }
        } else if (att.type === 'file') {
          // For non-image files, describe them as text
          parts.push({
            type: 'text',
            text: `[Attached file: ${att.name} (${att.mimeType}, ${Math.round(att.size / 1024)}KB)]`,
          });
        }
      }
      // If only audio and no text parts yet, add a description
      if (parts.length > 0 && !parts.some(p => p.type === 'text')) {
        parts.unshift({ type: 'text', text: '[Voice message - please listen to the attached audio]' });
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

    // Create a transform stream that keeps consuming gateway response
    // even if the browser disconnects (so the agent run completes)
    const reader = gatewayRes.body.getReader();
    let fullResponse = '';
    let browserDisconnected = false;

    const stream = new ReadableStream({
      async start(controller) {
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (!browserDisconnected) {
                try { controller.close(); } catch {}
              }
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

            // Try to pass through the chunk to browser
            if (!browserDisconnected) {
              try {
                controller.enqueue(value);
              } catch {
                // Browser disconnected — keep consuming gateway stream
                // so the agent run completes and writes to transcript
                browserDisconnected = true;
                console.log(`[API] Browser disconnected for ${agentId}, continuing agent run in background`);
              }
            }
            // If browserDisconnected, we keep looping and reading from gateway
            // The agent continues its work, transcript gets written
          }
        } catch (err) {
          // Gateway connection error
          if (!browserDisconnected) {
            try { controller.error(err); } catch {}
          }
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
