'use client';

import { useState, useEffect, useCallback } from 'react';

interface Note {
  id: number;
  title: string;
  content: string;
  url: string | null;
  note_type: string;
  color: string;
  pinned: boolean;
  created_by: string;
  agent_id: string | null;
  created_at: string;
  updated_at: string;
}

const COLORS = [
  { id: 'default', bg: 'bg-[var(--bg-tertiary)]', border: 'border-[var(--border)]' },
  { id: 'blue', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  { id: 'green', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  { id: 'yellow', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  { id: 'red', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  { id: 'purple', bg: 'bg-purple-500/10', border: 'border-purple-500/30' },
];

function getColorClasses(color: string) {
  return COLORS.find(c => c.id === color) || COLORS[0];
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function isValidUrl(str: string): boolean {
  try { new URL(str); return true; } catch { return false; }
}

export default function NotesView() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ title: '', content: '', url: '', color: 'default' });
  const [saving, setSaving] = useState(false);

  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch('/api/notes');
      if (res.ok) {
        const data = await res.json();
        setNotes(data.notes || []);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  const handleSave = async () => {
    if (!form.title.trim() && !form.content.trim() && !form.url.trim()) return;
    setSaving(true);

    try {
      if (editingId) {
        await fetch(`/api/notes/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: form.title,
            content: form.content,
            url: form.url || null,
            color: form.color,
            note_type: form.url ? 'link' : 'text',
          }),
        });
      } else {
        await fetch('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: form.title,
            content: form.content,
            url: form.url || null,
            color: form.color,
            note_type: form.url ? 'link' : 'text',
          }),
        });
      }
      setForm({ title: '', content: '', url: '', color: 'default' });
      setShowAdd(false);
      setEditingId(null);
      fetchNotes();
    } catch {}
    setSaving(false);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this note?')) return;
    await fetch(`/api/notes/${id}`, { method: 'DELETE' });
    fetchNotes();
  };

  const handlePin = async (note: Note) => {
    await fetch(`/api/notes/${note.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: !note.pinned }),
    });
    fetchNotes();
  };

  const startEdit = (note: Note) => {
    setForm({
      title: note.title,
      content: note.content,
      url: note.url || '',
      color: note.color,
    });
    setEditingId(note.id);
    setShowAdd(true);
  };

  const cancelEdit = () => {
    setForm({ title: '', content: '', url: '', color: 'default' });
    setShowAdd(false);
    setEditingId(null);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">📝</span>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Notes</h2>
          <span className="text-xs text-[var(--text-muted)]">{notes.length}</span>
        </div>
        <button
          onClick={() => { setShowAdd(!showAdd); setEditingId(null); setForm({ title: '', content: '', url: '', color: 'default' }); }}
          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity active:scale-95"
        >
          + Add Note
        </button>
      </div>

      {/* Add/Edit form */}
      {showAdd && (
        <div className="shrink-0 px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]/50 space-y-2 animate-fade-in">
          <input
            type="text"
            placeholder="Title (optional)"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            className="w-full px-3 py-2 text-sm bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
          <textarea
            placeholder="Write a note..."
            value={form.content}
            onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
            rows={3}
            className="w-full px-3 py-2 text-sm bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] resize-none"
          />
          <input
            type="url"
            placeholder="Link URL (optional) — paste PDF, webpage, etc."
            value={form.url}
            onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
            className="w-full px-3 py-2 text-sm bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
          {/* Color picker */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-muted)]">Color:</span>
            {COLORS.map(c => (
              <button
                key={c.id}
                onClick={() => setForm(f => ({ ...f, color: c.id }))}
                className={`w-6 h-6 rounded-full border-2 ${c.bg} ${form.color === c.id ? 'border-[var(--accent)] scale-110' : 'border-transparent'} transition-all`}
              />
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={cancelEdit}
              className="px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 text-sm font-medium rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? 'Saving...' : editingId ? 'Update' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex gap-1.5">
              <div className="w-2 h-2 bg-[var(--accent)] rounded-full typing-dot" />
              <div className="w-2 h-2 bg-[var(--accent)] rounded-full typing-dot" />
              <div className="w-2 h-2 bg-[var(--accent)] rounded-full typing-dot" />
            </div>
          </div>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <span className="text-4xl mb-3">📋</span>
            <p className="text-sm text-[var(--text-muted)]">No notes yet</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Save links, PDFs, and important info from your agents</p>
          </div>
        ) : (
          notes.map(note => {
            const colorClasses = getColorClasses(note.color);
            return (
              <div
                key={note.id}
                className={`group relative p-3 rounded-xl border ${colorClasses.bg} ${colorClasses.border} transition-all hover:shadow-md`}
              >
                {/* Pin indicator */}
                {note.pinned && (
                  <span className="absolute -top-1.5 -left-1.5 text-xs">📌</span>
                )}

                {/* Header */}
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex-1 min-w-0">
                    {note.title && (
                      <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">{note.title}</h3>
                    )}
                    <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                      <span>{formatDate(note.updated_at)}</span>
                      {note.agent_id && (
                        <span className="px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-secondary)]">
                          🤖 {note.agent_id}
                        </span>
                      )}
                      {note.note_type === 'link' && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">🔗 Link</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={() => handlePin(note)}
                      className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                      title={note.pinned ? 'Unpin' : 'Pin'}
                    >
                      <svg className="w-3.5 h-3.5" fill={note.pinned ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => startEdit(note)}
                      className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                      title="Edit"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(note.id)}
                      className="p-1 rounded hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Content */}
                {note.content && (
                  <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap mt-1 line-clamp-4">{note.content}</p>
                )}

                {/* URL */}
                {note.url && isValidUrl(note.url) && (
                  <a
                    href={note.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-primary)]/50 border border-[var(--border)] hover:border-[var(--accent)] transition-colors group/link"
                  >
                    <svg className="w-4 h-4 text-[var(--accent)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    <span className="text-xs text-[var(--text-secondary)] group-hover/link:text-[var(--accent)] truncate transition-colors">
                      {note.url.length > 60 ? note.url.slice(0, 60) + '...' : note.url}
                    </span>
                  </a>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
