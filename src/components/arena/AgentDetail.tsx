'use client';

import { useState, useEffect } from 'react';
import type { AgentDetailData } from '@/lib/types-arena';
import { getStatusLabel, getStatusColor, getHPColor, getMPColor } from '@/lib/rpg-mapping';

interface AgentDetailProps {
  agentId: string;
  onClose: () => void;
}

export default function AgentDetail({ agentId, onClose }: AgentDetailProps) {
  const [data, setData] = useState<AgentDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'soul' | 'skills' | 'quests'>('soul');

  useEffect(() => {
    fetch(`/api/gateway/arena/${agentId}`)
      .then(res => res.ok ? res.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [agentId]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-[var(--bg-secondary)] rounded-xl max-w-2xl w-full p-8 flex justify-center">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 bg-[var(--accent)] rounded-full typing-dot" />
            <div className="w-2.5 h-2.5 bg-[var(--accent)] rounded-full typing-dot" />
            <div className="w-2.5 h-2.5 bg-[var(--accent)] rounded-full typing-dot" />
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const hpColor = getHPColor(data.hp);
  const mpColor = getMPColor(data.mp);
  const statusColor = getStatusColor(data.status);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[var(--bg-secondary)] rounded-xl max-w-2xl w-full max-h-[85vh] overflow-hidden animate-slide-up">
        {/* Header */}
        <div
          className="p-6 border-b border-[var(--border)]"
          style={{ background: `linear-gradient(135deg, ${data.color}10 0%, transparent 60%)` }}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div
                className="flex items-center justify-center w-16 h-16 rounded-2xl text-3xl"
                style={{ backgroundColor: data.color + '20' }}
              >
                {data.icon}
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">{data.id}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm font-medium" style={{ color: data.color }}>{data.rpgClass}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                    Lv.{data.level}
                  </span>
                  <span
                    className="text-xs font-medium"
                    style={{ color: statusColor }}
                  >
                    {getStatusLabel(data.status)}
                  </span>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1 italic">{data.description}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-[var(--bg-hover)] rounded-lg shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Stats bars */}
          <div className="mt-4 grid grid-cols-2 gap-4">
            {/* HP */}
            <div>
              <div className="flex justify-between text-[10px] text-[var(--text-muted)] mb-1">
                <span>HP (Context Usage)</span>
                <span>{(data.totalTokens / 1000).toFixed(0)}K / {(data.maxTokens / 1000).toFixed(0)}K</span>
              </div>
              <div className="h-3 bg-[var(--bg-primary)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{ width: `${Math.round(data.hp * 100)}%`, backgroundColor: hpColor }}
                />
              </div>
            </div>
            {/* MP */}
            <div>
              <div className="flex justify-between text-[10px] text-[var(--text-muted)] mb-1">
                <span>MP (Remaining)</span>
                <span>{Math.round(data.mp * 100)}%</span>
              </div>
              <div className="h-3 bg-[var(--bg-primary)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{ width: `${Math.round(data.mp * 100)}%`, backgroundColor: mpColor }}
                />
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-3 flex gap-4 text-xs">
            <span className="text-[var(--text-muted)]">
              XP: <span className="text-white font-medium">
                {data.xp > 1_000_000 ? `${(data.xp / 1_000_000).toFixed(1)}M` : `${(data.xp / 1000).toFixed(0)}K`}
              </span>
            </span>
            <span className="text-[var(--text-muted)]">
              Sessions: <span className="text-white font-medium">{data.sessionCount}</span>
            </span>
            {data.workspace && (
              <span className="text-[var(--text-muted)] truncate">
                Workspace: <span className="text-[var(--text-secondary)] font-mono text-[10px]">{data.workspace.split('/').pop()}</span>
              </span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--border)]">
          {(['soul', 'skills', 'quests'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'text-white border-b-2 border-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {tab === 'soul' ? '📖 Soul' : tab === 'skills' ? '⚡ Skills' : '⚔️ Quests'}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="overflow-y-auto max-h-[40vh] p-4">
          {activeTab === 'soul' && (
            <div>
              {data.soulMd ? (
                <pre className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap font-mono leading-relaxed">
                  {data.soulMd}
                </pre>
              ) : (
                <div className="text-center text-[var(--text-muted)] py-8">
                  <span className="text-2xl block mb-2">📜</span>
                  <span className="text-sm">No SOUL.md found for this agent</span>
                </div>
              )}
              {data.recentMemory.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[var(--border)]">
                  <div className="text-xs text-[var(--text-muted)] mb-2">Memory Files</div>
                  <div className="flex flex-wrap gap-1.5">
                    {data.recentMemory.map(f => (
                      <span key={f} className="px-2 py-1 text-[10px] bg-[var(--bg-primary)] rounded text-[var(--text-secondary)]">
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'skills' && (
            <div>
              {data.skills.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {data.skills.map(skill => (
                    <div key={skill} className="flex items-center gap-2 p-2.5 bg-[var(--bg-primary)] rounded-lg">
                      <span className="text-sm">⚡</span>
                      <span className="text-sm text-[var(--text-secondary)]">{skill}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-[var(--text-muted)] py-8">
                  <span className="text-2xl block mb-2">🔮</span>
                  <span className="text-sm">No skills discovered</span>
                </div>
              )}
            </div>
          )}

          {activeTab === 'quests' && (
            <div>
              {data.quests.length > 0 ? (
                <div className="space-y-2">
                  {data.quests.map(quest => (
                    <div key={quest.id} className="p-3 bg-[var(--bg-primary)] rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-white font-medium">{quest.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          quest.enabled
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                        }`}>
                          {quest.enabled ? 'Active' : 'Disabled'}
                        </span>
                      </div>
                      <div className="flex gap-4 text-[10px] text-[var(--text-muted)]">
                        <span>Cron: <span className="font-mono text-[var(--text-secondary)]">{quest.cronExpr}</span></span>
                        {quest.lastStatus && (
                          <span>Last: <span className={quest.lastStatus === 'ok' ? 'text-green-400' : 'text-red-400'}>{quest.lastStatus}</span></span>
                        )}
                        {quest.lastDurationMs && (
                          <span>Duration: {Math.round(quest.lastDurationMs / 1000)}s</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-[var(--text-muted)] py-8">
                  <span className="text-2xl block mb-2">🏰</span>
                  <span className="text-sm">No quests assigned</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
