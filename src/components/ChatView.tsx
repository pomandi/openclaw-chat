'use client';

import { useState, useRef, useEffect, useCallback, FormEvent } from 'react';
import { Agent, ChatMessage, getAgentEmoji, getAgentName } from '@/lib/types';

interface ChatViewProps {
  agent: Agent;
  sessionKey: string;
  onOpenSidebar?: () => void;
}

export default function ChatView({ agent, sessionKey, onOpenSidebar }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load chat history
  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setLoading(true);
      try {
        const res = await fetch(`/api/gateway/chat?sessionKey=${encodeURIComponent(sessionKey)}`);
        if (!res.ok) throw new Error('Failed to load history');
        const data = await res.json();
        
        if (cancelled) return;

        // Transform history to ChatMessage format
        const history: ChatMessage[] = [];
        if (data.messages) {
          for (const msg of data.messages) {
            if (msg.role === 'user' || msg.role === 'assistant') {
              const content = typeof msg.content === 'string' 
                ? msg.content 
                : Array.isArray(msg.content) 
                  ? msg.content.map((c: any) => c.text || c.content || '').join('')
                  : '';
              if (content.trim()) {
                history.push({
                  id: `hist_${history.length}`,
                  role: msg.role,
                  content,
                  timestamp: msg.ts || Date.now(),
                  status: 'sent',
                });
              }
            }
          }
        }
        setMessages(history);
      } catch (err) {
        console.error('Failed to load history:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadHistory();
    return () => { cancelled = true; };
  }, [sessionKey]);

  // Subscribe to SSE events
  useEffect(() => {
    const es = new EventSource(`/api/gateway/chat/stream?sessionKey=${encodeURIComponent(sessionKey)}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'chat') {
          if (data.state === 'delta' && data.message) {
            setStreaming(true);
            const text = typeof data.message === 'string' 
              ? data.message 
              : data.message.content || data.message.text || '';
            setStreamText(prev => prev + text);
          } else if (data.state === 'final') {
            setStreaming(false);
            const finalText = typeof data.message === 'string'
              ? data.message
              : data.message?.content || data.message?.text || '';
            
            if (finalText.trim()) {
              setMessages(prev => {
                // Remove any existing message with same runId
                const filtered = prev.filter(m => m.runId !== data.runId);
                return [...filtered, {
                  id: `msg_${Date.now()}`,
                  role: 'assistant',
                  content: finalText,
                  timestamp: Date.now(),
                  status: 'sent',
                  runId: data.runId,
                }];
              });
            }
            setStreamText('');
            setSending(false);
          } else if (data.state === 'aborted' || data.state === 'error') {
            setStreaming(false);
            setStreamText('');
            setSending(false);
            if (data.errorMessage) {
              setMessages(prev => [...prev, {
                id: `err_${Date.now()}`,
                role: 'system',
                content: `Error: ${data.errorMessage}`,
                timestamp: Date.now(),
                status: 'error',
              }]);
            }
          }
        }
      } catch {
        // Skip parse errors
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [sessionKey]);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollToBottom();
  }, [messages, streamText, scrollToBottom]);

  async function handleSend(e?: FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    // Add user message
    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      status: 'sending',
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    try {
      const res = await fetch('/api/gateway/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionKey, message: text }),
      });

      if (!res.ok) {
        throw new Error('Failed to send');
      }

      // Update user message status
      setMessages(prev => prev.map(m => 
        m.id === userMsg.id ? { ...m, status: 'sent' as const } : m
      ));
    } catch (err) {
      setSending(false);
      setMessages(prev => prev.map(m =>
        m.id === userMsg.id ? { ...m, status: 'error' as const } : m
      ));
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  }

  const agentEmoji = getAgentEmoji(agent.id, agent);
  const agentName = getAgentName(agent);

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border)] safe-top shrink-0">
        {onOpenSidebar && (
          <button
            onClick={onOpenSidebar}
            className="p-2 -ml-2 hover:bg-[var(--bg-hover)] rounded-lg transition-colors md:hidden"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
        
        <div className="w-9 h-9 rounded-full bg-[var(--accent)]/20 flex items-center justify-center text-lg">
          {agentEmoji}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="font-medium text-white text-sm truncate">{agentName}</div>
          <div className="text-xs text-[var(--text-muted)] truncate">{agent.id}</div>
        </div>

        {sending && (
          <div className="text-xs text-[var(--accent)] flex items-center gap-1">
            <div className="w-1.5 h-1.5 bg-[var(--accent)] rounded-full animate-pulse" />
            Processing...
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex gap-1">
              <div className="w-2 h-2 bg-[var(--accent)] rounded-full typing-dot" />
              <div className="w-2 h-2 bg-[var(--accent)] rounded-full typing-dot" />
              <div className="w-2 h-2 bg-[var(--accent)] rounded-full typing-dot" />
            </div>
          </div>
        ) : messages.length === 0 && !streaming ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-4xl mb-4">{agentEmoji}</div>
            <h2 className="text-lg font-medium text-white mb-2">Chat with {agentName}</h2>
            <p className="text-sm text-[var(--text-muted)] max-w-sm">
              Send a message to start the conversation
            </p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} agentEmoji={agentEmoji} />
            ))}
            
            {/* Streaming indicator */}
            {streaming && streamText && (
              <div className="flex gap-2 animate-fade-in">
                <div className="w-7 h-7 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-sm shrink-0 mt-1">
                  {agentEmoji}
                </div>
                <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-tl-md bg-[var(--bubble-assistant)] text-sm whitespace-pre-wrap break-words">
                  {streamText}
                  <span className="inline-block w-1 h-4 bg-[var(--accent)] ml-0.5 animate-pulse" />
                </div>
              </div>
            )}
            
            {/* Typing indicator */}
            {sending && !streaming && !streamText && (
              <div className="flex gap-2 animate-fade-in">
                <div className="w-7 h-7 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-sm shrink-0 mt-1">
                  {agentEmoji}
                </div>
                <div className="px-4 py-3 rounded-2xl rounded-tl-md bg-[var(--bubble-assistant)]">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-[var(--text-muted)] rounded-full typing-dot" />
                    <div className="w-2 h-2 bg-[var(--text-muted)] rounded-full typing-dot" />
                    <div className="w-2 h-2 bg-[var(--text-muted)] rounded-full typing-dot" />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 px-4 py-3 bg-[var(--bg-secondary)] border-t border-[var(--border)] safe-bottom">
        <form onSubmit={handleSend} className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${agentName}...`}
            rows={1}
            className="flex-1 px-4 py-2.5 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-2xl text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors resize-none"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={!input.trim() || sending || loading}
            className="p-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({ message, agentEmoji }: { message: ChatMessage; agentEmoji: string }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center animate-fade-in">
        <div className="px-3 py-1.5 rounded-full bg-[var(--error)]/10 text-[var(--error)] text-xs">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-2 animate-fade-in ${isUser ? 'flex-row-reverse' : ''}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-sm shrink-0 mt-1">
          {agentEmoji}
        </div>
      )}
      
      <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words ${
        isUser
          ? 'bg-[var(--bubble-user)] text-white rounded-tr-md'
          : 'bg-[var(--bubble-assistant)] text-[var(--text-primary)] rounded-tl-md'
      }`}>
        {message.content}
      </div>

      {isUser && message.status === 'sending' && (
        <div className="self-end mb-1">
          <svg className="w-3 h-3 text-[var(--text-muted)] animate-spin" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      )}
    </div>
  );
}
