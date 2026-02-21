'use client';

import { useRef, useEffect } from 'react';
import type { ArenaEvent } from '@/lib/types-arena';

interface ActivityFeedProps {
  events: ArenaEvent[];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getEventTypeIcon(type: ArenaEvent['type']): string {
  switch (type) {
    case 'tool_call': return '🔮';
    case 'chat': return '💬';
    case 'quest_start': return '⚔️';
    case 'quest_complete': return '🏆';
    case 'quest_fail': return '💀';
    case 'status_change': return '✨';
    case 'message': return '📨';
    default: return '📌';
  }
}

function getEventTypeColor(type: ArenaEvent['type']): string {
  switch (type) {
    case 'tool_call': return 'text-purple-400';
    case 'chat': return 'text-blue-400';
    case 'quest_start': return 'text-yellow-400';
    case 'quest_complete': return 'text-green-400';
    case 'quest_fail': return 'text-red-400';
    case 'status_change': return 'text-cyan-400';
    case 'message': return 'text-[var(--text-secondary)]';
    default: return 'text-[var(--text-muted)]';
  }
}

export default function ActivityFeed({ events }: ActivityFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-4 py-3 border-b border-[var(--border)]">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          📜 Battle Log
          <span className="text-[10px] font-normal text-[var(--text-muted)]">
            {events.length} events
          </span>
        </h3>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)]">
            <span className="text-2xl mb-2">⏳</span>
            <span className="text-xs">Waiting for events...</span>
          </div>
        ) : (
          events.map((event) => (
            <div
              key={event.id}
              className="flex items-start gap-2 py-1.5 px-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors animate-fade-in"
            >
              <span className="text-xs shrink-0 mt-0.5">{getEventTypeIcon(event.type)}</span>
              <div className="min-w-0 flex-1">
                <span className={`text-xs ${getEventTypeColor(event.type)}`}>
                  {event.message}
                </span>
              </div>
              <span className="text-[10px] text-[var(--text-muted)] shrink-0 tabular-nums">
                {formatTime(event.timestamp)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
