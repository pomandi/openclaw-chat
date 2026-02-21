'use client';

import { useState, useEffect, useRef } from 'react';
import type { AgentDetailData, MindMessage } from '@/lib/types-arena';
import { getStatusLabel, getStatusColor, getHPColor, getMPColor } from '@/lib/rpg-mapping';

interface AgentDetailProps {
  agentId: string;
  onClose: () => void;
}

function MindBubble({ msg }: { msg: MindMessage }) {
  const isUser = msg.role === 'user';
  const isAssistant = msg.role === 'assistant';
  const isTool = msg.role === 'toolResult';
  const isSystem = msg.role === 'system';

  const roleLabel = isUser ? 'User' : isAssistant ? 'Agent' : isTool ? 'Tool Result' : 'System';
  const roleColor = isUser ? 'text-blue-400' : isAssistant ? 'text-green-400' : isTool ? 'text-purple-400' : 'text-yellow-400';
  const bgColor = isUser ? 'bg-blue-500/10 border-blue-500/20' : isAssistant ? 'bg-green-500/10 border-green-500/20' : isTool ? 'bg-purple-500/10 border-purple-500/20' : 'bg-yellow-500/10 border-yellow-500/20';
  const roleIcon = isUser ? '👤' : isAssistant ? '🤖' : isTool ? '🔧' : '⚙️';

  if (!msg.content && isAssistant) return null;

  return (
    <div className={`rounded-lg border p-3 ${bgColor}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs">{roleIcon}</span>
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${roleColor}`}>{roleLabel}</span>
        {msg.timestamp && (
          <span className="text-[10px] text-[var(--text-muted)] ml-auto tabular-nums">
            {new Date(msg.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
      <pre className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap break-words font-mono leading-relaxed max-h-40 overflow-y-auto">
        {msg.content || '(empty response — tool calls follow)'}
      </pre>
    </div>
  );
}

export default function AgentDetail({ agentId, onClose }: AgentDetailProps) {
  const [data, setData] = useState<AgentDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'mind' | 'soul' | 'skills' | 'quests'>('mind');
  const mindRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/gateway/arena/${agentId}`)
      .then(res => res.ok ? res.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [agentId]);

  // Auto-scroll mind to bottom
  useEffect(() => {
    if (activeTab === 'mind' && mindRef.current) {
      mindRef.current.scrollTop = mindRef.current.scrollHeight;
    }
  }, [activeTab, data]);

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

  const mindMessages = data.mind || [];
  const userMessages = mindMessages.filter(m => m.role === 'user').length;
  const assistantMessages = mindMessages.filter(m => m.role === 'assistant').length;
  const toolMessages = mindMessages.filter(m => m.role === 'toolResult').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[var(--bg-secondary)] rounded-xl max-w-3xl w-full max-h-[90vh] overflow-hidden animate-slide-up">
        {/* Header */}
        <div
          className="p-5 border-b border-[var(--border)]"
          style={{ background: `linear-gradient(135deg, ${data.color}10 0%, transparent 60%)` }}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div
                className="flex items-center justify-center w-14 h-14 rounded-2xl text-2xl"
                style={{ backgroundColor: data.color + '20' }}
              >
                {data.icon}
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">{data.id}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-sm font-medium" style={{ color: data.color }}>{data.rpgClass}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                    Lv.{data.level}
                  </span>
                  <span className="text-xs font-medium" style={{ color: statusColor }}>
                    {getStatusLabel(data.status)}
                  </span>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-[var(--bg-hover)] rounded-lg shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Compact stats */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <div className="flex justify-between text-[10px] text-[var(--text-muted)] mb-0.5">
                <span>HP</span>
                <span>{(data.totalTokens / 1000).toFixed(0)}K / {(data.maxTokens / 1000).toFixed(0)}K</span>
              </div>
              <div className="h-2 bg-[var(--bg-primary)] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${Math.round(data.hp * 100)}%`, backgroundColor: hpColor }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-[var(--text-muted)] mb-0.5">
                <span>MP</span>
                <span>{Math.round(data.mp * 100)}%</span>
              </div>
              <div className="h-2 bg-[var(--bg-primary)] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${Math.round(data.mp * 100)}%`, backgroundColor: mpColor }} />
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--border)]">
          {(['mind', 'soul', 'skills', 'quests'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'text-white border-b-2 border-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {tab === 'mind' ? `🧠 Mind (${mindMessages.length})` : tab === 'soul' ? '📖 Soul' : tab === 'skills' ? '⚡ Skills' : '⚔️ Quests'}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="overflow-y-auto max-h-[50vh] p-4" ref={activeTab === 'mind' ? mindRef : undefined}>
          {activeTab === 'mind' && (
            <div>
              {mindMessages.length > 0 ? (
                <>
                  {/* Mind stats */}
                  <div className="flex gap-3 mb-3 text-[10px] text-[var(--text-muted)]">
                    <span>👤 User: <span className="text-blue-400 font-medium">{userMessages}</span></span>
                    <span>🤖 Agent: <span className="text-green-400 font-medium">{assistantMessages}</span></span>
                    <span>🔧 Tools: <span className="text-purple-400 font-medium">{toolMessages}</span></span>
                    <span>Total: <span className="text-white font-medium">{mindMessages.length}</span> messages in context</span>
                  </div>
                  <div className="space-y-2">
                    {mindMessages.map((msg, i) => (
                      <MindBubble key={i} msg={msg} />
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-center text-[var(--text-muted)] py-8">
                  <span className="text-2xl block mb-2">🧠</span>
                  <span className="text-sm">No active context window — agent may be idle</span>
                </div>
              )}
            </div>
          )}

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
