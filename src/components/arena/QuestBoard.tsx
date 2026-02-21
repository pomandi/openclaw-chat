'use client';

import { useState, useEffect } from 'react';
import type { QuestInfo } from '@/lib/types-arena';
import { getRPGClass } from '@/lib/rpg-mapping';

interface QuestBoardProps {
  quests: QuestInfo[];
}

function formatCountdown(targetMs: number): string {
  const diff = targetMs - Date.now();
  if (diff <= 0) return 'Now!';
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

function formatDuration(ms: number | null): string {
  if (!ms) return '-';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function formatTime(ms: number | null): string {
  if (!ms) return '-';
  const d = new Date(ms);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export default function QuestBoard({ quests }: QuestBoardProps) {
  const [, setTick] = useState(0);

  // Re-render every 30s for countdown updates
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  const enabledQuests = quests.filter(q => q.enabled);
  const upcomingQuests = enabledQuests
    .filter(q => q.nextRunAtMs && q.nextRunAtMs > Date.now())
    .sort((a, b) => (a.nextRunAtMs || 0) - (b.nextRunAtMs || 0));

  const recentQuests = enabledQuests
    .filter(q => q.lastRunAtMs)
    .sort((a, b) => (b.lastRunAtMs || 0) - (a.lastRunAtMs || 0))
    .slice(0, 8);

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-4 py-3 border-b border-[var(--border)]">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          ⚔️ Quest Board
          <span className="text-[10px] font-normal text-[var(--text-muted)]">
            {enabledQuests.length} active
          </span>
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Upcoming quests */}
        {upcomingQuests.length > 0 && (
          <div className="px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">Upcoming</div>
            <div className="space-y-2">
              {upcomingQuests.slice(0, 5).map(quest => {
                const rpg = getRPGClass(quest.agentId);
                return (
                  <div key={quest.id} className="flex items-center gap-2 p-2 bg-[var(--bg-primary)] rounded-lg">
                    <span className="text-sm shrink-0">{rpg.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-white truncate">{quest.name}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">{quest.agentId}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-mono text-yellow-400">
                        {formatCountdown(quest.nextRunAtMs!)}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)]">
                        {formatTime(quest.nextRunAtMs)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent quests */}
        {recentQuests.length > 0 && (
          <div className="px-4 py-3 border-t border-[var(--border)]">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">Recent</div>
            <div className="space-y-1.5">
              {recentQuests.map(quest => {
                const rpg = getRPGClass(quest.agentId);
                const isOk = quest.lastStatus === 'ok';
                return (
                  <div key={quest.id} className="flex items-center gap-2 py-1.5">
                    <span className="text-xs shrink-0">{rpg.icon}</span>
                    <span className="text-xs text-[var(--text-secondary)] truncate flex-1">{quest.name}</span>
                    <span className={`text-[10px] shrink-0 ${isOk ? 'text-green-400' : 'text-red-400'}`}>
                      {isOk ? '✓' : '✗'}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)] shrink-0 w-10 text-right tabular-nums">
                      {formatDuration(quest.lastDurationMs)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {enabledQuests.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)]">
            <span className="text-2xl mb-2">🏰</span>
            <span className="text-xs">No active quests</span>
          </div>
        )}
      </div>
    </div>
  );
}
