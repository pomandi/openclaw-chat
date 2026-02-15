'use client';

import { Agent, getAgentEmoji, getAgentName } from '@/lib/types';

interface AgentSidebarProps {
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onClose?: () => void;
  loading?: boolean;
}

export default function AgentSidebar({ agents, selectedAgentId, onSelectAgent, onClose, loading }: AgentSidebarProps) {
  return (
    <div className="flex flex-col h-full w-full bg-[var(--bg-secondary)]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] safe-top shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🐾</span>
          <h1 className="text-lg font-bold text-white">OpenClaw</h1>
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
      <div className="flex-1 overflow-y-auto py-2">
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
          agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => onSelectAgent(agent.id)}
              className={`w-full flex items-center gap-3 px-5 py-3.5 text-left transition-all duration-150 active:scale-[0.98] ${
                selectedAgentId === agent.id
                  ? 'bg-[var(--bg-active)] border-l-3 border-[var(--accent)]'
                  : 'hover:bg-[var(--bg-hover)] border-l-3 border-transparent'
              }`}
            >
              {/* Avatar */}
              <div className={`w-11 h-11 rounded-full flex items-center justify-center text-lg shrink-0 transition-colors ${
                selectedAgentId === agent.id 
                  ? 'bg-[var(--accent)]/20' 
                  : 'bg-[var(--bg-tertiary)]'
              }`}>
                {getAgentEmoji(agent.id, agent)}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-white truncate">
                  {getAgentName(agent)}
                </div>
                <div className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                  {agent.id}
                </div>
              </div>

              {/* Status dot */}
              <div className="w-2.5 h-2.5 rounded-full bg-[var(--success)] shrink-0" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
