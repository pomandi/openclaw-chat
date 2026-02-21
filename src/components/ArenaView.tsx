'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AgentRPGState, ArenaEvent, QuestInfo, ArenaData } from '@/lib/types-arena';
import CharacterCard from '@/components/arena/CharacterCard';
import ActivityFeed from '@/components/arena/ActivityFeed';
import QuestBoard from '@/components/arena/QuestBoard';
import AgentDetail from '@/components/arena/AgentDetail';

const POLL_INTERVAL = 5_000;
const MAX_EVENTS = 50;

export default function ArenaView() {
  const [agents, setAgents] = useState<AgentRPGState[]>([]);
  const [quests, setQuests] = useState<QuestInfo[]>([]);
  const [events, setEvents] = useState<ArenaEvent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidePanel, setSidePanel] = useState<'feed' | 'quests'>('feed');
  const eventSourceRef = useRef<EventSource | null>(null);

  // Fetch arena data (polling)
  const fetchArena = useCallback(async () => {
    try {
      const res = await fetch('/api/gateway/arena');
      if (res.ok) {
        const data: ArenaData = await res.json();
        setAgents(data.agents);
        setQuests(data.quests);
      }
    } catch (err) {
      console.error('[Arena] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    fetchArena();
    const interval = setInterval(fetchArena, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchArena]);

  // SSE for real-time events
  useEffect(() => {
    const es = new EventSource('/api/gateway/arena/events');
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const arenaEvent: ArenaEvent = JSON.parse(event.data);
        setEvents(prev => {
          const updated = [...prev, arenaEvent];
          return updated.slice(-MAX_EVENTS);
        });

        // Update agent status from events
        setAgents(prev => prev.map(agent => {
          if (agent.id === arenaEvent.agentId) {
            const updates: Partial<AgentRPGState> = { lastActivity: arenaEvent.timestamp };
            if (arenaEvent.type === 'tool_call') {
              updates.lastTool = arenaEvent.message.match(/`([^`]+)`/)?.[1] || null;
              updates.status = 'working';
            } else if (arenaEvent.type === 'status_change') {
              if (arenaEvent.message.includes('error')) updates.status = 'error';
              else if (arenaEvent.message.includes('working')) updates.status = 'working';
              else if (arenaEvent.message.includes('idle')) updates.status = 'idle';
            } else if (arenaEvent.type === 'chat') {
              updates.status = 'working';
            } else if (arenaEvent.type === 'quest_start') {
              updates.status = 'working';
              updates.activeQuest = arenaEvent.message;
            } else if (arenaEvent.type === 'quest_complete' || arenaEvent.type === 'quest_fail') {
              updates.activeQuest = null;
            }
            return { ...agent, ...updates };
          }
          return agent;
        }));
      } catch (err) {
        // Ignore parse errors (comments, keepalives)
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  // Stats
  const working = agents.filter(a => a.status === 'working' || a.status === 'thinking').length;
  const idle = agents.filter(a => a.status === 'idle').length;
  const offline = agents.filter(a => a.status === 'offline').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-[var(--bg-primary)]">
        <div className="flex flex-col items-center gap-4">
          <span className="text-4xl">⚔️</span>
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 bg-[var(--accent)] rounded-full typing-dot" />
            <div className="w-2.5 h-2.5 bg-[var(--accent)] rounded-full typing-dot" />
            <div className="w-2.5 h-2.5 bg-[var(--accent)] rounded-full typing-dot" />
          </div>
          <span className="text-sm text-[var(--text-muted)]">Loading Arena...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] overflow-hidden">
      {/* Header stats */}
      <div className="shrink-0 px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-semibold text-white">Agent Arena</h2>
            <div className="flex gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-[var(--text-muted)]">Active: <span className="text-white font-medium">{working}</span></span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-gray-500" />
                <span className="text-[var(--text-muted)]">Idle: <span className="text-white font-medium">{idle}</span></span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-gray-700" />
                <span className="text-[var(--text-muted)]">Offline: <span className="text-white font-medium">{offline}</span></span>
              </span>
            </div>
          </div>

          {/* Side panel toggle - mobile */}
          <div className="flex items-center gap-1 lg:hidden">
            <button
              onClick={() => setSidePanel('feed')}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                sidePanel === 'feed' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              Log
            </button>
            <button
              onClick={() => setSidePanel('quests')}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                sidePanel === 'quests' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              Quests
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Agent grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {agents.map(agent => (
              <CharacterCard
                key={agent.id}
                agent={agent}
                onClick={() => setSelectedAgentId(agent.id)}
              />
            ))}
          </div>
        </div>

        {/* Side panel - desktop: always visible, mobile: toggle */}
        <div className="hidden lg:flex lg:flex-col w-80 shrink-0 border-l border-[var(--border)]">
          {/* Desktop: both panels stacked */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <div className="flex-1 min-h-0 overflow-hidden border-b border-[var(--border)]">
              <ActivityFeed events={events} />
            </div>
            <div className="h-72 shrink-0 overflow-hidden">
              <QuestBoard quests={quests} />
            </div>
          </div>
        </div>

        {/* Mobile side panel */}
        <div className="flex lg:hidden flex-col w-72 shrink-0 border-l border-[var(--border)]">
          {sidePanel === 'feed' ? (
            <ActivityFeed events={events} />
          ) : (
            <QuestBoard quests={quests} />
          )}
        </div>
      </div>

      {/* Agent detail modal */}
      {selectedAgentId && (
        <AgentDetail
          agentId={selectedAgentId}
          onClose={() => setSelectedAgentId(null)}
        />
      )}
    </div>
  );
}
