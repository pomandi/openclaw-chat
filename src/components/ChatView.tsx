'use client';

import { useState, useRef, useEffect, useCallback, FormEvent } from 'react';
import { Agent, ChatMessage, Attachment, getAgentEmoji, getAgentName, MAX_FILE_SIZE, SUPPORTED_IMAGE_TYPES, SUPPORTED_FILE_TYPES } from '@/lib/types';
import MarkdownRenderer from './MarkdownRenderer';

interface ChatViewProps {
  agent: Agent;
  sessionKey: string;
  onOpenSidebar?: () => void;
}

export default function ChatView({ agent, sessionKey, onOpenSidebar }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [retryMessage, setRetryMessage] = useState<ChatMessage | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const agentEmoji = getAgentEmoji(agent.id, agent);
  const agentName = getAgentName(agent);

  const scrollToBottom = useCallback((force = false) => {
    if (force || !showScrollBtn) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [showScrollBtn]);

  // Scroll detection for "scroll to bottom" button
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    
    function handleScroll() {
      if (!container) return;
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      setShowScrollBtn(distanceFromBottom > 100);
    }
    
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-scroll on new messages (only if already at bottom)
  useEffect(() => {
    scrollToBottom();
  }, [messages, streamText, scrollToBottom]);

  // Load messages from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(`chat:${sessionKey}`);
    if (stored) {
      try {
        setMessages(JSON.parse(stored));
      } catch { /* ignore */ }
    }
  }, [sessionKey]);

  // Save messages to localStorage
  useEffect(() => {
    if (messages.length > 0) {
      // Only save last 100 messages and strip large attachments
      const toSave = messages.slice(-100).map(m => ({
        ...m,
        attachments: m.attachments?.map(a => ({
          ...a,
          dataUrl: a.type === 'image' ? a.dataUrl.substring(0, 200) + '...' : '', // truncate for storage
        })),
      }));
      localStorage.setItem(`chat:${sessionKey}`, JSON.stringify(toSave));
    }
  }, [messages, sessionKey]);

  // File handling
  function handleFileSelect(files: FileList | null) {
    if (!files) return;
    
    Array.from(files).forEach(file => {
      if (file.size > MAX_FILE_SIZE) {
        alert(`File "${file.name}" is too large. Maximum size is 10MB.`);
        return;
      }
      
      if (!SUPPORTED_FILE_TYPES.includes(file.type)) {
        alert(`File type "${file.type}" is not supported.`);
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const isImage = SUPPORTED_IMAGE_TYPES.includes(file.type);
        
        const attachment: Attachment = {
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          type: isImage ? 'image' : 'file',
          name: file.name,
          size: file.size,
          mimeType: file.type,
          dataUrl,
          previewUrl: isImage ? dataUrl : undefined,
        };
        
        setAttachments(prev => [...prev, attachment]);
      };
      reader.readAsDataURL(file);
    });
  }

  function removeAttachment(id: string) {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }

  // Drag & drop
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    handleFileSelect(e.dataTransfer.files);
  }

  // Send message with streaming
  async function handleSend(e?: FormEvent, retryMsg?: ChatMessage) {
    e?.preventDefault();
    const text = retryMsg?.content || input.trim();
    const msgAttachments = retryMsg?.attachments || [...attachments];
    
    if ((!text && msgAttachments.length === 0) || sending) return;

    // Derive agentId from sessionKey (format: agent:AGENTID:main)
    const agentId = sessionKey.split(':')[1] || agent.id;

    // Add user message
    const userMsg: ChatMessage = retryMsg || {
      id: `user_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      status: 'sending',
      attachments: msgAttachments.length > 0 ? msgAttachments : undefined,
    };

    if (!retryMsg) {
      setMessages(prev => [...prev, userMsg]);
      setInput('');
      setAttachments([]);
    } else {
      setMessages(prev => prev.map(m => 
        m.id === retryMsg.id ? { ...m, status: 'sending' as const } : m
      ));
    }
    
    setSending(true);
    setStreaming(false);
    setStreamText('');
    setRetryMessage(null);

    // Reset textarea height
    if (inputRef.current) inputRef.current.style.height = 'auto';

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/gateway/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          message: text,
          sessionKey,
          attachments: msgAttachments.map(a => ({
            type: a.type,
            name: a.name,
            size: a.size,
            mimeType: a.mimeType,
            dataUrl: a.dataUrl,
          })),
        }),
        signal: controller.signal,
      });

      // Update user message status
      setMessages(prev => prev.map(m =>
        m.id === userMsg.id ? { ...m, status: 'sent' as const } : m
      ));

      if (!res.ok) {
        throw new Error(`Server error: ${res.status}`);
      }

      if (!res.body) {
        throw new Error('No response stream');
      }

      // Read SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let buffer = '';
      setStreaming(true);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            
            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                accumulated += delta;
                setStreamText(accumulated);
              }
              
              // Check for finish
              if (json.choices?.[0]?.finish_reason) {
                // Stream finished
              }
            } catch {
              // ignore parse errors for partial JSON
            }
          }
        }
      }

      // Add final assistant message
      if (accumulated.trim()) {
        const assistantMsg: ChatMessage = {
          id: `asst_${Date.now()}`,
          role: 'assistant',
          content: accumulated,
          timestamp: Date.now(),
          status: 'sent',
        };
        setMessages(prev => [...prev, assistantMsg]);
      }

    } catch (err: any) {
      if (err.name === 'AbortError') return;
      
      console.error('[Chat] send error:', err);
      
      // Mark user message as error
      setMessages(prev => prev.map(m =>
        m.id === userMsg.id ? { ...m, status: 'error' as const } : m
      ));
      setRetryMessage(userMsg);

      // Add error message
      setMessages(prev => [...prev, {
        id: `err_${Date.now()}`,
        role: 'system',
        content: `Failed to send: ${err.message}`,
        timestamp: Date.now(),
        status: 'error',
      }]);
    } finally {
      setSending(false);
      setStreaming(false);
      setStreamText('');
      abortRef.current = null;
      scrollToBottom(true);
    }
  }

  function handleRetry() {
    if (retryMessage) {
      // Remove the error system message
      setMessages(prev => prev.filter(m => m.role !== 'system' || m.status !== 'error'));
      handleSend(undefined, retryMessage);
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
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const dt = new DataTransfer();
          dt.items.add(file);
          handleFileSelect(dt.files);
        }
      }
    }
  }

  return (
    <div
      className="flex flex-col h-full bg-[var(--bg-primary)]"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-50 bg-[var(--accent)]/10 border-2 border-dashed border-[var(--accent)] rounded-lg flex items-center justify-center pointer-events-none">
          <div className="text-[var(--accent)] text-lg font-medium flex items-center gap-2">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            Drop files here
          </div>
        </div>
      )}

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
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 relative">
        {messages.length === 0 && !streaming ? (
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
            
            {/* Streaming response */}
            {streaming && streamText && (
              <div className="flex gap-2 animate-fade-in">
                <div className="w-7 h-7 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-sm shrink-0 mt-1">
                  {agentEmoji}
                </div>
                <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-tl-md bg-[var(--bubble-assistant)] text-sm break-words">
                  <MarkdownRenderer content={streamText} />
                  <span className="inline-block w-0.5 h-4 bg-[var(--accent)] ml-0.5 animate-blink" />
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

            {/* Retry button */}
            {retryMessage && !sending && (
              <div className="flex justify-center animate-fade-in">
                <button
                  onClick={handleRetry}
                  className="flex items-center gap-2 px-4 py-2 bg-[var(--error)]/10 hover:bg-[var(--error)]/20 text-[var(--error)] text-sm rounded-full transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Retry
                </button>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />

        {/* Scroll to bottom button */}
        {showScrollBtn && (
          <button
            onClick={() => scrollToBottom(true)}
            className="fixed bottom-24 right-6 z-10 w-10 h-10 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border)] rounded-full flex items-center justify-center shadow-lg transition-all animate-fade-in"
          >
            <svg className="w-5 h-5 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
        )}
      </div>

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="shrink-0 px-4 py-2 bg-[var(--bg-secondary)] border-t border-[var(--border)] flex gap-2 overflow-x-auto">
          {attachments.map(att => (
            <div key={att.id} className="relative group shrink-0">
              {att.type === 'image' && att.previewUrl ? (
                <img
                  src={att.previewUrl}
                  alt={att.name}
                  className="w-16 h-16 object-cover rounded-lg border border-[var(--border)]"
                />
              ) : (
                <div className="w-16 h-16 bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border)] flex flex-col items-center justify-center">
                  <svg className="w-6 h-6 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-[8px] text-[var(--text-muted)] mt-1 truncate max-w-[56px]">{att.name}</span>
                </div>
              )}
              <button
                onClick={() => removeAttachment(att.id)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[var(--error)] text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 px-4 py-3 bg-[var(--bg-secondary)] border-t border-[var(--border)] safe-bottom">
        <form onSubmit={handleSend} className="flex items-end gap-2">
          {/* Attachment button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded-full transition-colors shrink-0"
            title="Attach file"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={SUPPORTED_FILE_TYPES.join(',')}
            onChange={(e) => handleFileSelect(e.target.files)}
            className="hidden"
          />

          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={`Message ${agentName}...`}
            rows={1}
            className="flex-1 px-4 py-2.5 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-2xl text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors resize-none"
            disabled={sending}
          />

          <button
            type="submit"
            disabled={(!input.trim() && attachments.length === 0) || sending}
            className="p-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          >
            {sending ? (
              <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
              </svg>
            )}
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

  const timeStr = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={`flex gap-2 animate-fade-in ${isUser ? 'flex-row-reverse' : ''}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-sm shrink-0 mt-1">
          {agentEmoji}
        </div>
      )}
      
      <div className={`max-w-[85%] ${isUser ? '' : ''}`}>
        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className={`flex flex-wrap gap-2 mb-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
            {message.attachments.map(att => (
              att.type === 'image' && att.previewUrl ? (
                <img
                  key={att.id}
                  src={att.previewUrl}
                  alt={att.name}
                  className="max-w-[200px] max-h-[200px] rounded-xl object-cover cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => window.open(att.dataUrl, '_blank')}
                />
              ) : (
                <div
                  key={att.id}
                  className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-tertiary)] rounded-xl text-xs text-[var(--text-secondary)]"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  {att.name}
                </div>
              )
            ))}
          </div>
        )}

        {/* Message content */}
        {message.content && (
          <div className={`px-4 py-2.5 rounded-2xl text-sm break-words ${
            isUser
              ? 'bg-[var(--bubble-user)] text-white rounded-tr-md'
              : 'bg-[var(--bubble-assistant)] text-[var(--text-primary)] rounded-tl-md'
          }`}>
            {isUser ? (
              <span className="whitespace-pre-wrap">{message.content}</span>
            ) : (
              <MarkdownRenderer content={message.content} />
            )}
          </div>
        )}

        {/* Timestamp & status */}
        <div className={`flex items-center gap-1 mt-0.5 px-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
          <span className="text-[10px] text-[var(--text-muted)]">{timeStr}</span>
          {isUser && message.status === 'sending' && (
            <svg className="w-3 h-3 text-[var(--text-muted)] animate-spin" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {isUser && message.status === 'sent' && (
            <svg className="w-3 h-3 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          {isUser && message.status === 'error' && (
            <svg className="w-3 h-3 text-[var(--error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
