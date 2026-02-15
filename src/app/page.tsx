'use client';

import { useState, useEffect, useCallback } from 'react';
import LoginScreen from '@/components/LoginScreen';
import AgentSidebar from '@/components/AgentSidebar';
import ChatView from '@/components/ChatView';
import { Agent, AgentsListResult } from '@/lib/types';

export default function Home() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [defaultAgentId, setDefaultAgentId] = useState<string>('main');
  const [mainKey, setMainKey] = useState<string>('');

  // Handle agent selection with browser history
  const selectAgent = useCallback((agentId: string | null) => {
    if (agentId && !selectedAgentId) {
      // Entering an agent — push a history entry so browser back returns to list
      window.history.pushState({ view: 'chat', agentId }, '');
    } else if (!agentId && selectedAgentId) {
      // Going back to list — no push needed (already navigating back)
    }
    setSelectedAgentId(agentId);
    setSidebarOpen(false);
  }, [selectedAgentId]);

  // Handle browser back button / swipe gesture
  useEffect(() => {
    function handlePopState(e: PopStateEvent) {
      // When user presses back, go to agent list
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
  }

  function getSessionKey(agentId: string): string {
    // Generate session key matching OpenClaw convention
    return `agent:${agentId}:main`;
  }

  // Navigate back to agent list (also pops browser history)
  const goBack = useCallback(() => {
    setSelectedAgentId(null);
    setSidebarOpen(false);
    // Pop the history entry we pushed when selecting agent
    if (window.history.state?.view === 'chat') {
      window.history.back();
    }
  }, []);

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
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar - desktop: always visible, fixed width */}
      <div className="hidden md:flex md:flex-col w-72 shrink-0 border-r border-[var(--border)]">
        <AgentSidebar
          agents={agents}
          selectedAgentId={selectedAgentId}
          onSelectAgent={selectAgent}
          loading={loadingAgents}
        />
      </div>

      {/* Mobile: full-screen agent list when no agent selected */}
      {!selectedAgentId && (
        <div className="flex flex-col flex-1 md:hidden">
          <AgentSidebar
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={selectAgent}
            loading={loadingAgents}
          />
        </div>
      )}

      {/* Mobile: sidebar overlay when agent is selected and sidebar toggled */}
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
            />
          </div>
        </div>
      )}

      {/* Main content - hidden on mobile when no agent, always visible on desktop */}
      <div className={`flex-1 min-w-0 flex flex-col ${!selectedAgentId ? 'hidden md:flex' : 'flex'}`}>
        {selectedAgent ? (
          <ChatView
            agent={selectedAgent}
            sessionKey={getSessionKey(selectedAgent.id)}
            onOpenSidebar={() => setSidebarOpen(true)}
            onBack={goBack}
          />
        ) : (
          <EmptyState onOpenSidebar={() => setSidebarOpen(true)} />
        )}
      </div>
    </div>
  );
}

function EmptyState({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  return (
    <div className="flex flex-col h-full">
      {/* Mobile header */}
      <div className="flex items-center px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border)] md:hidden safe-top">
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
