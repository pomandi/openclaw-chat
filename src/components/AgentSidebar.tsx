'use client';

import { Agent, getAgentEmoji, getAgentName } from '@/lib/types';

export interface AgentUnreadInfo {
  lastTs: number;
  lastAssistantTs: number;
  preview: string;
  previewRole: 'user' | 'assistant';
}

interface AgentSidebarProps {
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onClose?: () => void;
  loading?: boolean;
  unreadMap?: Record<string, AgentUnreadInfo>;
  lastSeenMap?: Record<string, number>;
}

function formatTimeAgo(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  
  if (diff < 60_000) return 'now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
  if (diff < 604800_000) return `${Math.floor(diff / 86400_000)}d`;
  return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export default function AgentSidebar({ agents, selectedAgentId, onSelectAgent, onClose, loading, unreadMap, lastSeenMap }: AgentSidebarProps) {
  // Calculate total unread count
  const totalUnread = agents.filter(a => {
    const info = unreadMap?.[a.id];
    const lastSeen = lastSeenMap?.[a.id] || 0;
    return info && info.lastTs > lastSeen;
  }).length;

  // Sort agents: unread first, then by last message time
  const sortedAgents = [...agents].sort((a, b) => {
    const aInfo = unreadMap?.[a.id];
    const bInfo = unreadMap?.[b.id];
    const aLastSeen = lastSeenMap?.[a.id] || 0;
    const bLastSeen = lastSeenMap?.[b.id] || 0;
    const aUnread = aInfo && aInfo.lastTs > aLastSeen;
    const bUnread = bInfo && bInfo.lastTs > bLastSeen;
    
    // Unread first
    if (aUnread && !bUnread) return -1;
    if (!aUnread && bUnread) return 1;
    
    // Then by last message time (most recent first)
    const aTs = aInfo?.lastTs || 0;
    const bTs = bInfo?.lastTs || 0;
    return bTs - aTs;
  });

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full bg-[var(--bg-secondary)]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] bg-[var(--bg-secondary)] safe-top shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🐾</span>
          <h1 className="text-lg font-bold text-white">OpenClaw</h1>
          {totalUnread > 0 && (
            <span className="min-w-5 h-5 px-1.5 flex items-center justify-center bg-[var(--accent)] text-white text-[11px] font-bold rounded-full animate-fade-in">
              {totalUnread}
            </span>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="flex items-center justify-center w-10 h-10 hover:bg-[var(--bg-hover)] rounded-xl transition-colors md:hidden active:scale-95"
            aria-label="Close sidebar"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Agent List */}
      <div className="relative flex-1 min-h-0">
        <div className="absolute inset-0 overflow-y-auto overscroll-contain py-1" style={{ WebkitOverflowScrolling: 'touch' }}>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 bg-[var(--accent)] rounded-full typing-dot" />
              <div className="w-2.5 h-2.5 bg-[var(--accent)] rounded-full typing-dot" />
              <div className="w-2.5 h-2.5 bg-[var(--accent)] rounded-full typing-dot" />
            </div>
          </div>
        ) : agents.length === 0 ? (
          <p className="text-center text-[var(--text-muted)] py-12 text-sm">
            No agents found
          </p>
        ) : (
          sortedAgents.map((agent) => {
            const info = unreadMap?.[agent.id];
            const lastSeen = lastSeenMap?.[agent.id] || 0;
            const hasUnread = info && info.lastTs > lastSeen;
            const isSelected = selectedAgentId === agent.id;

            return (
              <button
                key={agent.id}
                onClick={() => onSelectAgent(agent.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-150 active:scale-[0.98] ${
                  isSelected
                    ? 'bg-[var(--bg-active)] border-l-3 border-[var(--accent)]'
                    : 'hover:bg-[var(--bg-hover)] border-l-3 border-transparent'
                }`}
              >
                {/* Avatar with unread indicator */}
                <div className="relative shrink-0">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl transition-colors ${
                    isSelected
                      ? 'bg-[var(--accent)]/20' 
                      : 'bg-[var(--bg-tertiary)]'
                  }`}>
                    {getAgentEmoji(agent.id, agent)}
                  </div>
                  {/* Unread dot */}
                  {hasUnread && !isSelected && (
                    <div className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[var(--accent)] rounded-full border-2 border-[var(--bg-secondary)] animate-fade-in" />
                  )}
                </div>

                {/* Info — name + last message preview */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className={`text-sm truncate ${hasUnread ? 'font-bold text-white' : 'font-medium text-white'}`}>
                      {getAgentName(agent)}
                    </div>
                    {/* Timestamp */}
                    {info && (
                      <span className={`text-[10px] shrink-0 ${hasUnread ? 'text-[var(--accent)] font-semibold' : 'text-[var(--text-muted)]'}`}>
                        {formatTimeAgo(info.lastTs)}
                      </span>
                    )}
                  </div>
                  
                  {/* Last message preview */}
                  {info ? (
                    <div className={`text-xs truncate mt-0.5 ${hasUnread ? 'text-[var(--text-secondary)] font-medium' : 'text-[var(--text-muted)]'}`}>
                      {info.previewRole === 'user' && (
                        <span className="text-[var(--text-muted)]">You: </span>
                      )}
                      {info.preview}
                    </div>
                  ) : (
                    <div className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                      {agent.id}
                    </div>
                  )}
                </div>
              </button>
            );
          })
        )}
        </div>
      </div>
    </div>
  );
}
