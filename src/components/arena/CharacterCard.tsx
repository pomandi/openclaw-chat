'use client';

import type { AgentRPGState } from '@/lib/types-arena';
import { getStatusAnimation, getStatusLabel, getStatusColor, getHPColor, getMPColor } from '@/lib/rpg-mapping';

interface CharacterCardProps {
  agent: AgentRPGState;
  onClick: () => void;
}

export default function CharacterCard({ agent, onClick }: CharacterCardProps) {
  const statusAnim = getStatusAnimation(agent.status);
  const statusColor = getStatusColor(agent.status);
  const hpColor = getHPColor(agent.hp);
  const mpColor = getMPColor(agent.mp);
  const hpPercent = Math.round(agent.hp * 100);
  const mpPercent = Math.round(agent.mp * 100);

  return (
    <button
      onClick={onClick}
      className={`relative bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] p-4 text-left transition-all duration-300 hover:border-opacity-60 hover:scale-[1.02] hover:shadow-lg group ${statusAnim}`}
      style={{
        borderColor: agent.status === 'working' || agent.status === 'thinking'
          ? agent.color + '40'
          : undefined,
        boxShadow: agent.status === 'working'
          ? `0 0 20px ${agent.color}20`
          : undefined,
      }}
    >
      {/* Status indicator dot */}
      <div
        className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full"
        style={{ backgroundColor: statusColor }}
        title={getStatusLabel(agent.status)}
      >
        {(agent.status === 'working' || agent.status === 'thinking') && (
          <div
            className="absolute inset-0 rounded-full animate-ping"
            style={{ backgroundColor: statusColor, opacity: 0.4 }}
          />
        )}
      </div>

      {/* Header: Icon + Class + Level */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className="flex items-center justify-center w-12 h-12 rounded-xl text-2xl"
          style={{ backgroundColor: agent.color + '20' }}
        >
          {agent.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white truncate">{agent.id}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs font-medium" style={{ color: agent.color }}>{agent.rpgClass}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
              Lv.{agent.level}
            </span>
          </div>
        </div>
      </div>

      {/* HP Bar (Context Window Usage) */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">HP</span>
          <span className="text-[10px] text-[var(--text-muted)]">
            {(agent.totalTokens / 1000).toFixed(0)}K / {(agent.maxTokens / 1000).toFixed(0)}K
          </span>
        </div>
        <div className="h-2 bg-[var(--bg-primary)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000 ease-out"
            style={{
              width: `${hpPercent}%`,
              backgroundColor: hpColor,
            }}
          />
        </div>
      </div>

      {/* MP Bar (Remaining Capacity) */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">MP</span>
          <span className="text-[10px] text-[var(--text-muted)]">{mpPercent}%</span>
        </div>
        <div className="h-1.5 bg-[var(--bg-primary)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000 ease-out"
            style={{
              width: `${mpPercent}%`,
              backgroundColor: mpColor,
            }}
          />
        </div>
      </div>

      {/* XP + Status row */}
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-[var(--text-muted)]">
          XP: {agent.xp > 1_000_000 ? `${(agent.xp / 1_000_000).toFixed(1)}M` : `${(agent.xp / 1000).toFixed(0)}K`}
        </span>
        <span
          className="font-medium"
          style={{ color: statusColor }}
        >
          {getStatusLabel(agent.status)}
        </span>
      </div>

      {/* Active quest indicator */}
      {agent.activeQuest && (
        <div className="mt-2 px-2 py-1 bg-[var(--bg-primary)] rounded-lg flex items-center gap-1.5">
          <span className="text-[10px]">⚔️</span>
          <span className="text-[10px] text-[var(--text-secondary)] truncate">{agent.activeQuest}</span>
        </div>
      )}

      {/* Last tool */}
      {agent.lastTool && (
        <div className="mt-1.5 text-[10px] text-[var(--text-muted)] truncate">
          🔮 Cast: <code className="text-[var(--text-secondary)]">{agent.lastTool}</code>
        </div>
      )}
    </button>
  );
}
