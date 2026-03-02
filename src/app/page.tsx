'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import LoginScreen from '@/components/LoginScreen';
import AgentSidebar, { AgentUnreadInfo } from '@/components/AgentSidebar';
import ChatView from '@/components/ChatView';
import TasksView from '@/components/TasksView';
import ArenaView from '@/components/ArenaView';
import NotesView from '@/components/NotesView';
import SettingsView from '@/components/SettingsView';
import { Agent, AgentsListResult } from '@/lib/types';

const LAST_SEEN_KEY = 'openclaw-lastSeen';
const SELECTED_AGENT_KEY = 'openclaw-selectedAgent';
const UNREAD_POLL_INTERVAL = 30_000; // 30 seconds

type AppView = 'chat' | 'tasks' | 'arena' | 'notes' | 'settings';

function loadLastSeen(): Record<string, number> {
  try {
    const stored = localStorage.getItem(LAST_SEEN_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveLastSeen(map: Record<string, number>) {
  try {
    localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(map));
  } catch {}
}

export default function Home() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(() => {
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem(SELECTED_AGENT_KEY) : null;
      if (stored) {
        localStorage.removeItem(SELECTED_AGENT_KEY);
        return stored;
      }
    } catch {}
    return null;
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [defaultAgentId, setDefaultAgentId] = useState<string>('main');
  const [mainKey, setMainKey] = useState<string>('');
  const [unreadMap, setUnreadMap] = useState<Record<string, AgentUnreadInfo>>({});
  const [lastSeenMap, setLastSeenMap] = useState<Record<string, number>>(loadLastSeen);
  const [activeView, setActiveView] = useState<AppView>('chat');
  const [pendingTaskCount, setPendingTaskCount] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch unread info
  const fetchUnread = useCallback(async () => {
    try {
      const res = await fetch('/api/gateway/unread');
      if (res.ok) {
        const data = await res.json();
        setUnreadMap(data);
      }
    } catch {
      // silent fail
    }
  }, []);

  // Mark agent as read
  const markAsRead = useCallback((agentId: string) => {
    setLastSeenMap(prev => {
      const updated = { ...prev, [agentId]: Date.now() };
      saveLastSeen(updated);
      return updated;
    });
  }, []);

  // Handle agent selection with browser history
  const selectAgent = useCallback((agentId: string | null) => {
    if (agentId && !selectedAgentId) {
      window.history.pushState({ view: 'chat', agentId }, '');
    }
    setSelectedAgentId(agentId);
    setSidebarOpen(false);

    // Mark as read when selecting
    if (agentId) {
      markAsRead(agentId);
    }
  }, [selectedAgentId, markAsRead]);

  // Handle browser back button / swipe gesture
  useEffect(() => {
    function handlePopState() {
      setSelectedAgentId(null);
      setSidebarOpen(false);
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Check auth on mount
  useEffect(() => {
    fetch('/api/gateway/agents')
      .then(res => {
        if (res.status === 401) {
          setAuthenticated(false);
        } else if (res.ok) {
          setAuthenticated(true);
          return res.json();
        }
      })
      .then(data => {
        if (data) {
          handleAgentsData(data);
        }
      })
      .catch(() => setAuthenticated(false));
  }, []);

  function handleAgentsData(data: AgentsListResult) {
    setAgents(data.agents || []);
    setDefaultAgentId(data.defaultId || 'main');
    setMainKey(data.mainKey || '');
    setLoadingAgents(false);
  }

  // Fetch pending forward task count
  const fetchPendingTaskCount = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks?status=pending&metadataType=forward&limit=1');
      if (res.ok) {
        const data = await res.json();
        setPendingTaskCount(data.pagination?.total || 0);
      }
    } catch {
      // silent fail
    }
  }, []);

  // Start polling for unread + pending tasks when authenticated
  useEffect(() => {
    if (!authenticated) return;

    // Initial fetch
    fetchUnread();
    fetchPendingTaskCount();

    // Poll every 30s
    pollRef.current = setInterval(() => {
      fetchUnread();
      fetchPendingTaskCount();
    }, UNREAD_POLL_INTERVAL);

    // Also fetch on visibility change (tab becomes active)
    function onVisibility() {
      if (document.visibilityState === 'visible') {
        fetchUnread();
        fetchPendingTaskCount();
      }
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [authenticated, fetchUnread, fetchPendingTaskCount]);

  // Mark current agent as read when receiving new messages
  useEffect(() => {
    if (selectedAgentId) {
      markAsRead(selectedAgentId);
    }
  }, [selectedAgentId, unreadMap, markAsRead]);

  // Load agents after login
  const loadAgents = useCallback(async () => {
    setLoadingAgents(true);
    try {
      const res = await fetch('/api/gateway/agents');
      if (res.ok) {
        const data = await res.json();
        handleAgentsData(data);
      }
    } catch (err) {
      console.error('Failed to load agents:', err);
    } finally {
      setLoadingAgents(false);
    }
  }, []);

  function handleLogin() {
    setAuthenticated(true);
    loadAgents();
    fetchUnread();
  }

  function getSessionKey(agentId: string): string {
    return `agent:${agentId}:main`;
  }

  // Navigate back to agent list
  const goBack = useCallback(() => {
    setSelectedAgentId(null);
    setSidebarOpen(false);
    if (window.history.state?.view === 'chat') {
      window.history.back();
    }
    // Refresh unread when going back to list
    fetchUnread();
  }, [fetchUnread]);

  // Refresh: save current agent to localStorage, then reload
  const handleRefresh = useCallback(() => {
    if (selectedAgentId) {
      try {
        localStorage.setItem(SELECTED_AGENT_KEY, selectedAgentId);
      } catch {}
    }
    window.location.reload();
  }, [selectedAgentId]);

  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  // Loading state
  if (authenticated === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--bg-primary)]">
        <div className="flex gap-1">
          <div className="w-2 h-2 bg-[var(--accent)] rounded-full typing-dot" />
          <div className="w-2 h-2 bg-[var(--accent)] rounded-full typing-dot" />
          <div className="w-2 h-2 bg-[var(--accent)] rounded-full typing-dot" />
        </div>
      </div>
    );
  }

  // Login
  if (!authenticated) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="flex flex-col h-dvh overflow-hidden" style={{ height: '100dvh' }}>
      {/* Navigation Tabs - always visible on top */}
      <NavTabs activeView={activeView} onChangeView={setActiveView} onRefresh={handleRefresh} pendingTaskCount={pendingTaskCount} />

      {/* Content based on active view */}
      {activeView === 'settings' ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <SettingsView />
        </div>
      ) : activeView === 'arena' ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <ArenaView />
        </div>
      ) : activeView === 'notes' ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <NotesView />
        </div>
      ) : activeView === 'tasks' ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <TasksView />
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Sidebar - desktop: always visible */}
          <div className="hidden md:flex md:flex-col w-72 shrink-0 min-h-0 border-r border-[var(--border)]">
            <AgentSidebar
              agents={agents}
              selectedAgentId={selectedAgentId}
              onSelectAgent={selectAgent}
              loading={loadingAgents}
              unreadMap={unreadMap}
              lastSeenMap={lastSeenMap}
            />
          </div>

          {/* Mobile: full-screen agent list when no agent selected */}
          {!selectedAgentId && (
            <div className="flex flex-col flex-1 min-h-0 md:hidden">
              <AgentSidebar
                agents={agents}
                selectedAgentId={selectedAgentId}
                onSelectAgent={selectAgent}
                loading={loadingAgents}
                unreadMap={unreadMap}
                lastSeenMap={lastSeenMap}
              />
            </div>
          )}

          {/* Mobile: sidebar overlay */}
          {selectedAgentId && sidebarOpen && (
            <div className="fixed inset-0 z-50 md:hidden">
              <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={() => setSidebarOpen(false)}
              />
              <div className="absolute left-0 top-0 bottom-0 w-[85vw] max-w-80 shadow-2xl animate-slide-in-left">
                <AgentSidebar
                  agents={agents}
                  selectedAgentId={selectedAgentId}
                  onSelectAgent={selectAgent}
                  onClose={() => setSidebarOpen(false)}
                  loading={loadingAgents}
                  unreadMap={unreadMap}
                  lastSeenMap={lastSeenMap}
                />
              </div>
            </div>
          )}

          {/* Main content */}
          <div className={`flex-1 min-w-0 flex flex-col ${!selectedAgentId ? 'hidden md:flex' : 'flex'}`}>
            {selectedAgent ? (
              <ChatView
                key={selectedAgent.id}
                agent={selectedAgent}
                agents={agents}
                sessionKey={getSessionKey(selectedAgent.id)}
                onOpenSidebar={() => setSidebarOpen(true)}
                onBack={goBack}
              />
            ) : (
              <EmptyState onOpenSidebar={() => setSidebarOpen(true)} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NavTabs({ activeView, onChangeView, onRefresh, pendingTaskCount = 0 }: { activeView: AppView; onChangeView: (view: AppView) => void; onRefresh?: () => void; pendingTaskCount?: number }) {
  return (
    <div className="shrink-0 flex items-center gap-1 px-4 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border)] safe-top">
      <span className="text-xl mr-2">🐾</span>
      <button
        onClick={() => onChangeView('chat')}
        className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
          activeView === 'chat'
            ? 'bg-[var(--accent)] text-white'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
        }`}
      >
        Chat
      </button>
      <button
        onClick={() => onChangeView('tasks')}
        className={`relative px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
          activeView === 'tasks'
            ? 'bg-[var(--accent)] text-white'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
        }`}
      >
        Tasks
        {pendingTaskCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-[var(--error)] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {pendingTaskCount}
          </span>
        )}
      </button>
      <button
        onClick={() => onChangeView('arena')}
        className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
          activeView === 'arena'
            ? 'bg-[var(--accent)] text-white'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
        }`}
      >
        Arena
      </button>
      <button
        onClick={() => onChangeView('notes')}
        className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
          activeView === 'notes'
            ? 'bg-[var(--accent)] text-white'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
        }`}
      >
        Notes
      </button>
      {/* Spacer + Settings + Refresh button */}
      <div className="flex-1" />
      <button
        onClick={() => onChangeView('settings')}
        className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors active:scale-90 ${
          activeView === 'settings'
            ? 'text-white bg-[var(--accent)]'
            : 'text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-hover)]'
        }`}
        aria-label="Settings"
        title="Settings"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
      {onRefresh && (
        <button
          onClick={onRefresh}
          className="flex items-center justify-center w-8 h-8 text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-hover)] rounded-lg transition-colors active:scale-90"
          aria-label="Refresh page"
          title="Refresh"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.49 9A9 9 0 105.64 5.64L4 4m16 16l-1.64-1.64A9 9 0 009 20.49" />
          </svg>
        </button>
      )}
    </div>
  );
}

function EmptyState({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border)] md:hidden">
        <button
          onClick={onOpenSidebar}
          className="p-2 -ml-2 hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="ml-2 font-medium">OpenClaw Chat</span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
        <div className="text-6xl mb-6">🐾</div>
        <h2 className="text-xl font-semibold text-white mb-2">OpenClaw Chat</h2>
        <p className="text-[var(--text-secondary)] max-w-sm text-sm">
          Select an agent from the sidebar to start chatting
        </p>
        <button
          onClick={onOpenSidebar}
          className="mt-6 px-6 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium rounded-xl transition-colors md:hidden"
        >
          Choose Agent
        </button>
      </div>
    </div>
  );
}
