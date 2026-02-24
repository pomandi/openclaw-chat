'use client';

import { useState, useEffect, useCallback } from 'react';

// Agent list
const AGENTS = [
  'main',
  'coding-agent',
  'fatura-collector',
  'customer-relations',
  'pomamarketing',
  'seo-agent',
  'personal-assistant',
  'ops-monitor',
  'ads-merchant',
  'hr',
  'investor',
  'mtm-tedarik',
  'product-upload',
  'qa-tester',
  'security',
  'vision',
];

interface AgentTask {
  id: number;
  title: string;
  description: string | null;
  status: 'pending' | 'running' | 'done' | 'failed' | 'blocked';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  created_by: string;
  assigned_agent: string;
  executing_agent: string | null;
  result: string | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface TaskStats {
  total: number;
  pending: number;
  running: number;
  done: number;
  failed: number;
  blocked?: number;
}

interface TasksResponse {
  tasks: AgentTask[];
  stats: TaskStats;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const AUTO_REFRESH_INTERVAL = 30_000; // 30 seconds

export default function TasksView() {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [stats, setStats] = useState<TaskStats>({ total: 0, pending: 0, running: 0, done: 0, failed: 0, blocked: 0 });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [agentFilter, setAgentFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [selectedTask, setSelectedTask] = useState<AgentTask | null>(null);
  const [showNewTaskModal, setShowNewTaskModal] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (agentFilter) params.set('assignedAgent', agentFilter);
      params.set('page', page.toString());
      params.set('limit', '50');

      const res = await fetch(`/api/tasks?${params.toString()}`);
      if (res.ok) {
        const data: TasksResponse = await res.json();
        setTasks(data.tasks);
        setStats(data.stats);
        setTotalPages(data.pagination.totalPages);
      }
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, agentFilter, page]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Auto-refresh
  useEffect(() => {
    const interval = setInterval(fetchTasks, AUTO_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Filter by search (client-side)
  const filteredTasks = search
    ? tasks.filter(t =>
        t.title.toLowerCase().includes(search.toLowerCase()) ||
        t.description?.toLowerCase().includes(search.toLowerCase()) ||
        t.assigned_agent.toLowerCase().includes(search.toLowerCase())
      )
    : tasks;

  const formatDuration = (start: string | null, end: string | null): string => {
    if (!start) return '-';
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : new Date();
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m`;
    const diffHours = Math.floor(diffMin / 60);
    return `${diffHours}h ${diffMin % 60}m`;
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return 'now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-500/20 text-yellow-400">Pending</span>;
      case 'running':
        return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-500/20 text-blue-400 animate-pulse">Running</span>;
      case 'done':
        return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-500/20 text-green-400">Done</span>;
      case 'failed':
        return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-500/20 text-red-400">Failed</span>;
      case 'blocked':
        return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-orange-500/10 text-orange-400">Blocked</span>;
      default:
        return null;
    }
  };

  const handleDelete = async (taskId: number) => {
    if (!confirm('Are you sure you want to delete this task?')) return;
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchTasks();
        setSelectedTask(null);
      }
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  };

  const blockedCount = stats.blocked ?? tasks.filter(t => t.status === 'blocked').length;

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] overflow-hidden">
      {/* Stats Cards */}
      <div className="shrink-0 p-4 border-b border-[var(--border)]">
        <div className="grid grid-cols-6 gap-2 sm:gap-4">
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Pending" value={stats.pending} color="yellow" />
          <StatCard label="Running" value={stats.running} color="blue" pulse />
          <StatCard label="Blocked" value={blockedCount} color="orange" />
          <StatCard label="Done" value={stats.done} color="green" />
          <StatCard label="Failed" value={stats.failed} color="red" />
        </div>
      </div>

      {/* Filters */}
      <div className="shrink-0 p-4 border-b border-[var(--border)] flex flex-wrap gap-3 items-center">
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
        >
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="running">Running</option>
          <option value="blocked">Blocked</option>
          <option value="done">Done</option>
          <option value="failed">Failed</option>
        </select>

        <select
          value={agentFilter}
          onChange={e => { setAgentFilter(e.target.value); setPage(1); }}
          className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
        >
          <option value="">All Agents</option>
          {AGENTS.map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[120px] max-w-[200px] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
        />

        <button
          onClick={() => setShowNewTaskModal(true)}
          className="ml-auto px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium rounded-lg transition-colors"
        >
          + New Task
        </button>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 bg-[var(--accent)] rounded-full typing-dot" />
              <div className="w-2.5 h-2.5 bg-[var(--accent)] rounded-full typing-dot" />
              <div className="w-2.5 h-2.5 bg-[var(--accent)] rounded-full typing-dot" />
            </div>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
            <span className="text-4xl mb-4">📋</span>
            <p>No tasks found</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {filteredTasks.map(task => (
              <button
                key={task.id}
                onClick={() => setSelectedTask(task)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--bg-hover)] transition-colors animate-fade-in"
              >
                {/* Status Badge */}
                <div className="shrink-0 w-16">
                  {getStatusBadge(task.status)}
                </div>

                {/* Title & Description */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">{task.title}</div>
                  {task.description && (
                    <div className="text-xs text-[var(--text-muted)] truncate mt-0.5">{task.description}</div>
                  )}
                </div>

                {/* Agent Chain */}
                <div className="hidden sm:flex items-center gap-1 text-xs text-[var(--text-secondary)] shrink-0">
                  <span className="px-1.5 py-0.5 bg-[var(--bg-tertiary)] rounded">{task.created_by}</span>
                  <span className="text-[var(--text-muted)]">→</span>
                  <span className="px-1.5 py-0.5 bg-[var(--bg-tertiary)] rounded">{task.assigned_agent}</span>
                  {task.executing_agent && task.executing_agent !== task.assigned_agent && (
                    <>
                      <span className="text-[var(--text-muted)]">→</span>
                      <span className="px-1.5 py-0.5 bg-[var(--bg-tertiary)] rounded">{task.executing_agent}</span>
                    </>
                  )}
                </div>

                {/* Duration */}
                <div className="shrink-0 text-xs text-[var(--text-muted)] w-12 text-right">
                  {formatDuration(task.started_at, task.completed_at)}
                </div>

                {/* Date */}
                <div className="shrink-0 text-xs text-[var(--text-muted)] w-16 text-right">
                  {formatDate(task.created_at)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="shrink-0 flex items-center justify-center gap-2 p-4 border-t border-[var(--border)]">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg disabled:opacity-50 hover:bg-[var(--bg-hover)]"
          >
            Prev
          </button>
          <span className="text-sm text-[var(--text-secondary)]">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg disabled:opacity-50 hover:bg-[var(--bg-hover)]"
          >
            Next
          </button>
        </div>
      )}

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onDelete={() => handleDelete(selectedTask.id)}
          onIntervene={() => { setSelectedTask(null); fetchTasks(); }}
          onToast={(msg, type) => setToast({ message: msg, type })}
        />
      )}

      {/* New Task Modal */}
      {showNewTaskModal && (
        <NewTaskModal
          onClose={() => setShowNewTaskModal(false)}
          onCreated={() => { setShowNewTaskModal(false); fetchTasks(); }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg animate-fade-in max-w-[90vw] text-center ${
            toast.type === 'success'
              ? 'bg-green-500/90 text-white'
              : 'bg-red-500/90 text-white'
          }`}
          onClick={() => setToast(null)}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color, pulse }: { label: string; value: number; color?: string; pulse?: boolean }) {
  const colorClass = {
    yellow: 'text-yellow-400',
    blue: 'text-blue-400',
    green: 'text-green-400',
    red: 'text-red-400',
    orange: 'text-orange-400',
  }[color || ''] || 'text-white';

  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg p-3 text-center">
      <div className={`text-xl sm:text-2xl font-bold ${colorClass} ${pulse ? 'animate-pulse' : ''}`}>
        {value}
      </div>
      <div className="text-[10px] sm:text-xs text-[var(--text-muted)] mt-1">{label}</div>
    </div>
  );
}

function TaskDetailModal({ task, onClose, onDelete, onIntervene, onToast }: {
  task: AgentTask;
  onClose: () => void;
  onDelete: () => void;
  onIntervene: () => void;
  onToast: (message: string, type: 'success' | 'error') => void;
}) {
  const [intervention, setIntervention] = useState('');
  const [sending, setSending] = useState(false);
  const [showReassign, setShowReassign] = useState(false);

  const isActive = task.status === 'pending' || task.status === 'running' || task.status === 'blocked';

  const handleIntervene = async () => {
    if (!intervention.trim()) return;
    setSending(true);

    try {
      // Step 1: Send intervention message to assigned agent
      const message = [
        `[Mudahale — Task #${task.id}]`,
        `Orijinal gorev: ${task.title}`,
        `Yeni talimat: ${intervention.trim()}`,
        '',
        `Gorev tamamlandiginda: task(action="update", taskId=${task.id}, status="done", summary="...")`,
        `Basarisizsa: task(action="update", taskId=${task.id}, status="failed", summary="...")`,
        `Engel varsa: task(action="update", taskId=${task.id}, status="blocked", summary="...")`,
      ].join('\n');

      const chatRes = await fetch('/api/gateway/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: task.assigned_agent,
          sessionKey: `agent:${task.assigned_agent}:main`,
          message,
        }),
      });

      if (!chatRes.ok) throw new Error('Mesaj gonderilemedi');

      // Step 2: Set task back to running
      await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'running' }),
      });

      onToast(`Task #${task.id} icin mudahale gonderildi`, 'success');
      onIntervene();
    } catch (err: any) {
      console.error('Intervention error:', err);
      onToast(`Mudahale hatasi: ${err.message}`, 'error');
    } finally {
      setSending(false);
    }
  };

  const handleReassign = async (newAgent: string) => {
    setShowReassign(false);
    try {
      // Send the task context to the new agent
      const message = [
        `[Tekrar Atama — Task #${task.id}]`,
        `Orijinal gorev: ${task.title}`,
        task.description ? `Aciklama: ${task.description}` : '',
        task.result ? `Onceki sonuc/durum: ${task.result}` : '',
        '',
        `Bu gorev sana yeniden atandi. Gorevi tamamla.`,
        `Gorev tamamlandiginda: task(action="update", taskId=${task.id}, status="done", summary="...")`,
      ].filter(Boolean).join('\n');

      const chatRes = await fetch('/api/gateway/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: newAgent,
          sessionKey: `agent:${newAgent}:main`,
          message,
        }),
      });

      if (!chatRes.ok) throw new Error('Mesaj gonderilemedi');

      // Update task: change assigned_agent and set running
      await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'running',
          metadata: { ...task.metadata, reassigned_from: task.assigned_agent, reassigned_to: newAgent },
        }),
      });

      onToast(`Task #${task.id} ${newAgent}'e atandi`, 'success');
      onIntervene();
    } catch (err: any) {
      console.error('Reassign error:', err);
      onToast(`Atama hatasi: ${err.message}`, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[var(--bg-secondary)] rounded-xl max-w-lg w-full max-h-[80vh] overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <h2 className="text-lg font-semibold text-white truncate pr-4">{task.title}</h2>
          <button onClick={onClose} className="shrink-0 p-2 hover:bg-[var(--bg-hover)] rounded-lg">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto max-h-[60vh] space-y-4">
          <div className="flex flex-wrap gap-2">
            <span className={`px-2 py-1 text-xs rounded-full ${
              task.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
              task.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
              task.status === 'done' ? 'bg-green-500/20 text-green-400' :
              task.status === 'blocked' ? 'bg-orange-500/10 text-orange-400' :
              'bg-red-500/20 text-red-400'
            }`}>{task.status}</span>
            <span className="px-2 py-1 text-xs rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">{task.priority}</span>
          </div>

          {task.description && (
            <div>
              <div className="text-xs text-[var(--text-muted)] mb-1">Description</div>
              <div className="text-sm text-[var(--text-primary)]">{task.description}</div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-xs text-[var(--text-muted)] mb-1">Created By</div>
              <div className="text-[var(--text-primary)]">{task.created_by}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--text-muted)] mb-1">Assigned To</div>
              <div className="text-[var(--text-primary)]">{task.assigned_agent}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--text-muted)] mb-1">Executing</div>
              <div className="text-[var(--text-primary)]">{task.executing_agent || '-'}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-xs text-[var(--text-muted)] mb-1">Created</div>
              <div className="text-[var(--text-primary)]">{new Date(task.created_at).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--text-muted)] mb-1">Started</div>
              <div className="text-[var(--text-primary)]">{task.started_at ? new Date(task.started_at).toLocaleString() : '-'}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--text-muted)] mb-1">Completed</div>
              <div className="text-[var(--text-primary)]">{task.completed_at ? new Date(task.completed_at).toLocaleString() : '-'}</div>
            </div>
          </div>

          {task.result && (
            <div>
              <div className="text-xs text-[var(--text-muted)] mb-1">Result</div>
              <pre className="text-sm text-green-400 bg-[var(--bg-primary)] p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">{task.result}</pre>
            </div>
          )}

          {task.error && (
            <div>
              <div className="text-xs text-[var(--text-muted)] mb-1">Error</div>
              <pre className="text-sm text-red-400 bg-[var(--bg-primary)] p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">{task.error}</pre>
            </div>
          )}

          {task.metadata && Object.keys(task.metadata).length > 0 && (
            <div>
              <div className="text-xs text-[var(--text-muted)] mb-1">Metadata</div>
              <pre className="text-xs text-[var(--text-secondary)] bg-[var(--bg-primary)] p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(task.metadata, null, 2)}
              </pre>
            </div>
          )}

          {/* Intervention Panel */}
          {isActive && (
            <div className="border-t border-[var(--border)] pt-4">
              <div className="text-xs text-[var(--text-muted)] mb-2 font-medium">Mudahale Et</div>
              <textarea
                value={intervention}
                onChange={e => setIntervention(e.target.value)}
                rows={3}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] resize-none"
                placeholder="Yeni talimat yaz..."
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleIntervene}
                  disabled={!intervention.trim() || sending}
                  className="px-4 py-2 text-sm bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {sending ? 'Gonderiliyor...' : 'Gonder'}
                </button>
                <div className="relative">
                  <button
                    onClick={() => setShowReassign(!showReassign)}
                    className="px-4 py-2 text-sm bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] rounded-lg transition-colors flex items-center gap-1"
                  >
                    Tekrar Ata
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showReassign && (
                    <div className="absolute bottom-full left-0 mb-1 w-48 max-h-60 overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl z-10">
                      {AGENTS.filter(a => a !== task.assigned_agent).map(a => (
                        <button
                          key={a}
                          onClick={() => handleReassign(a)}
                          className="w-full text-left px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-[var(--border)]">
          <button
            onClick={onDelete}
            className="px-4 py-2 text-sm text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
          >
            Delete
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function NewTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedAgent, setAssignedAgent] = useState('main');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          createdBy: 'user',
          assignedAgent,
        }),
      });
      if (res.ok) {
        onCreated();
      }
    } catch (err) {
      console.error('Failed to create task:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[var(--bg-secondary)] rounded-xl max-w-md w-full animate-slide-up">
        <form onSubmit={handleSubmit}>
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
            <h2 className="text-lg font-semibold text-white">New Task</h2>
            <button type="button" onClick={onClose} className="p-2 hover:bg-[var(--bg-hover)] rounded-lg">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Title *</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                placeholder="Task title..."
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Assign To</label>
              <select
                value={assignedAgent}
                onChange={e => setAssignedAgent(e.target.value)}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              >
                {AGENTS.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Description</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] resize-none"
                placeholder="Optional description..."
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 p-4 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || submitting}
              className="px-4 py-2 text-sm bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
