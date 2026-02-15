'use client';

import { useState, useRef, useEffect, useCallback, FormEvent } from 'react';
import { Agent, ChatMessage, Attachment, getAgentEmoji, getAgentName, MAX_FILE_SIZE, SUPPORTED_IMAGE_TYPES, SUPPORTED_FILE_TYPES } from '@/lib/types';
import MarkdownRenderer from './MarkdownRenderer';
import VoiceRecorder, { AudioBubblePlayer } from './VoiceRecorder';

// Helper to extract text from multimodal content
function extractText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p: any) => p.type === 'text' && p.text)
      .map((p: any) => p.text)
      .join('\n');
  }
  return String(content || '');
}

interface ChatViewProps {
  agent: Agent;
  sessionKey: string;
  onOpenSidebar?: () => void;
  onBack?: () => void;
}

export default function ChatView({ agent, sessionKey, onOpenSidebar, onBack }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [retryMessage, setRetryMessage] = useState<ChatMessage | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
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

  // Load chat history from server (transcripts), then merge with localStorage
  useEffect(() => {
    let cancelled = false;
    setLoadingHistory(true);
    setMessages([]);

    async function loadHistory() {
      try {
        const res = await fetch(`/api/gateway/history?sessionKey=${encodeURIComponent(sessionKey)}&limit=100`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          const serverMessages: ChatMessage[] = (data.messages || []).map((m: any) => ({
            ...m,
            status: 'sent' as const,
          }));

          const stored = localStorage.getItem(`chat:${sessionKey}`);
          let localMessages: ChatMessage[] = [];
          if (stored) {
            try {
              localMessages = JSON.parse(stored);
            } catch { /* ignore */ }
          }

          if (serverMessages.length > 0) {
            const lastServerTs = serverMessages[serverMessages.length - 1]?.timestamp || 0;
            const localOnly = localMessages.filter(m =>
              m.timestamp > lastServerTs && !m.id.startsWith('hist_')
            );
            setMessages([...serverMessages, ...localOnly]);
          } else if (localMessages.length > 0) {
            setMessages(localMessages);
          }
        }
      } catch (err) {
        console.error('[Chat] history load error:', err);
        const stored = localStorage.getItem(`chat:${sessionKey}`);
        if (stored && !cancelled) {
          try { setMessages(JSON.parse(stored)); } catch { /* */ }
        }
      } finally {
        if (!cancelled) {
          setLoadingHistory(false);
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
          }, 100);
        }
      }
    }

    loadHistory();

    // Reload history when tab becomes visible again (browser was closed/minimized)
    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && !cancelled) {
        loadHistory();
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [sessionKey]);

  // Poll for new messages every 10 seconds (from other channels like Telegram)
  useEffect(() => {
    if (loadingHistory) return;
    
    const pollInterval = setInterval(async () => {
      // Don't poll while sending (we'll get the response via stream)
      if (sending) return;
      
      // Find the latest message timestamp
      const lastTs = messages.length > 0 
        ? Math.max(...messages.map(m => m.timestamp || 0))
        : 0;
      
      if (!lastTs) return;
      
      try {
        const res = await fetch(
          `/api/gateway/history?sessionKey=${encodeURIComponent(sessionKey)}&since=${lastTs}`
        );
        if (!res.ok) return;
        const data = await res.json();
        const newMessages: ChatMessage[] = (data.messages || [])
          .filter((m: any) => {
            // Skip messages we already have (by content + role + close timestamp)
            return !messages.some(existing => 
              existing.role === m.role && 
              existing.content === extractText(m.content) &&
              Math.abs((existing.timestamp || 0) - (m.timestamp || 0)) < 5000
            );
          })
          .map((m: any) => ({
            ...m,
            content: extractText(m.content),
            status: 'sent' as const,
          }));
        
        if (newMessages.length > 0) {
          setMessages(prev => [...prev, ...newMessages]);
        }
      } catch {
        // silent
      }
    }, 10_000);
    
    return () => clearInterval(pollInterval);
  }, [sessionKey, messages, sending, loadingHistory]);

  // Save messages to localStorage
  useEffect(() => {
    if (messages.length > 0) {
      const toSave = messages.slice(-100).map(m => ({
        ...m,
        attachments: m.attachments?.map(a => ({
          ...a,
          dataUrl: a.type === 'audio'
            ? (a.dataUrl.length < 700000 ? a.dataUrl : a.dataUrl.substring(0, 200) + '...')
            : a.type === 'image'
              ? a.dataUrl.substring(0, 200) + '...'
              : '',
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
    
    if (!text && msgAttachments.length === 0) return;
    
    // If already sending, allow force-reset by tapping send again
    if (sending) {
      // Force cancel current request and allow new one
      if (abortRef.current) {
        console.warn('[Chat] Force-cancelling stuck request');
        abortRef.current.abort();
      }
      setSending(false);
      setStreaming(false);
      setStreamText('');
      return;
    }

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

    // Safety timeout: auto-reset sending state after 60s to prevent stuck UI
    const safetyTimeout = setTimeout(() => {
      console.warn('[Chat] Safety timeout: resetting sending state after 60s');
      setSending(false);
      setStreaming(false);
      setStreamText('');
      controller.abort();
    }, 60_000);

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
        let errBody = '';
        try { errBody = await res.text(); } catch {}
        const parsed = errBody ? (() => { try { return JSON.parse(errBody); } catch { return null; } })() : null;
        throw new Error(parsed?.error || `Server error: ${res.status}`);
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
        buffer = lines.pop() || '';

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
      console.error('[Chat] send error:', err);
      
      // For abort errors, check if we got any streamed content
      if (err.name === 'AbortError') {
        // If we had partial content, still save it
        // Don't return silently — show timeout message
      }
      
      // Mark user message as error
      setMessages(prev => prev.map(m =>
        m.id === userMsg.id ? { ...m, status: 'error' as const } : m
      ));
      setRetryMessage(userMsg);

      // Add error message
      const errorText = err.name === 'AbortError' 
        ? 'Request timed out. Tap retry to try again.'
        : `Failed to send: ${err.message}`;
      setMessages(prev => [...prev, {
        id: `err_${Date.now()}`,
        role: 'system',
        content: errorText,
        timestamp: Date.now(),
        status: 'error',
      }]);
    } finally {
      clearTimeout(safetyTimeout);
      setSending(false);
      setStreaming(false);
      setStreamText('');
      abortRef.current = null;
      scrollToBottom(true);
    }
  }

  function handleRetry() {
    if (retryMessage) {
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
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
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

  // Voice message handler
  function handleVoiceSend(dataUrl: string, duration: number, mimeType: string) {
    const audioAttachment: Attachment = {
      id: `att_voice_${Date.now()}`,
      type: 'audio',
      name: `voice_${Date.now()}.${mimeType.includes('webm') ? 'webm' : mimeType.includes('ogg') ? 'ogg' : 'mp4'}`,
      size: Math.round((dataUrl.length * 3) / 4),
      mimeType,
      dataUrl,
      duration,
    };

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: '🎤 Transcribing...',
      timestamp: Date.now(),
      status: 'sending',
      attachments: [audioAttachment],
    };

    setMessages(prev => [...prev, userMsg]);
    setVoiceMode(false);
    setSending(true);
    setStreaming(false);
    setStreamText('');

    const controller = new AbortController();
    abortRef.current = controller;
    const agentId = sessionKey.split(':')[1] || agent.id;

    (async () => {
      try {
        // Step 1: Transcribe audio to text
        let transcribedText = '';
        try {
          const transcribeRes = await fetch('/api/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio: dataUrl, language: 'tr' }),
            signal: AbortSignal.timeout(55000),
          });
          if (transcribeRes.ok) {
            const transcribeData = await transcribeRes.json();
            if (transcribeData.text?.trim()) {
              transcribedText = transcribeData.text.trim();
            }
          }
        } catch (e) {
          console.warn('[Voice] Transcription failed, sending as audio:', e);
        }

        // Update user message with transcribed text or indicate voice message
        const displayText = transcribedText || '🎤 Voice message';
        setMessages(prev => prev.map(m =>
          m.id === userMsg.id ? { ...m, content: displayText } : m
        ));

        // Step 2: Send to agent - use transcribed text if available, otherwise send audio
        const messageToSend = transcribedText || '[Voice message - audio attached]';
        const res = await fetch('/api/gateway/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId,
            message: messageToSend,
            sessionKey,
            ...(!transcribedText ? {
              attachments: [{
                type: 'audio',
                name: audioAttachment.name,
                size: audioAttachment.size,
                mimeType: audioAttachment.mimeType,
                dataUrl: audioAttachment.dataUrl,
                duration,
              }],
            } : {}),
          }),
          signal: controller.signal,
        });

        setMessages(prev => prev.map(m =>
          m.id === userMsg.id ? { ...m, status: 'sent' as const } : m
        ));

        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        if (!res.body) throw new Error('No response stream');

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
          buffer = lines.pop() || '';
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
              } catch { /* */ }
            }
          }
        }

        if (accumulated.trim()) {
          setMessages(prev => [...prev, {
            id: `asst_${Date.now()}`,
            role: 'assistant',
            content: accumulated,
            timestamp: Date.now(),
            status: 'sent',
          }]);
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        setMessages(prev => prev.map(m =>
          m.id === userMsg.id ? { ...m, status: 'error' as const } : m
        ));
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
    })();
  }

  const hasInput = input.trim().length > 0 || attachments.length > 0;

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
      <div className="flex items-center gap-2 px-3 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border)] safe-top shrink-0">
        {/* Back button — always visible, large touch target */}
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center justify-center w-11 h-11 -ml-1 hover:bg-[var(--bg-hover)] rounded-xl transition-colors active:scale-95 shrink-0"
            title="Back to agents"
            aria-label="Back to agents"
          >
            <svg className="w-7 h-7 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        
        <div className="w-10 h-10 rounded-full bg-[var(--accent)]/20 flex items-center justify-center text-lg shrink-0">
          {agentEmoji}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white text-[15px] truncate">{agentName}</div>
          <div className="text-xs text-[var(--text-muted)] truncate">{agent.id}</div>
        </div>

        {/* Mobile: hamburger for sidebar */}
        {onOpenSidebar && (
          <button
            onClick={onOpenSidebar}
            className="flex items-center justify-center w-11 h-11 hover:bg-[var(--bg-hover)] rounded-xl transition-colors md:hidden active:scale-95 shrink-0"
            title="Switch agent"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}

        {sending ? (
          <div className="text-xs text-[var(--accent)] flex items-center gap-1.5 shrink-0">
            <div className="w-2 h-2 bg-[var(--accent)] rounded-full animate-pulse" />
            <span className="hidden sm:inline">Processing...</span>
          </div>
        ) : (
          <div className="text-[9px] text-[var(--text-muted)]/50 shrink-0 select-none">v6</div>
        )}
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-3 relative messages-container">
        {loadingHistory ? (
          <div className="space-y-4 animate-pulse">
            {[...Array(5)].map((_, i) => (
              <div key={i} className={`flex gap-2 ${i % 2 === 0 ? 'flex-row-reverse' : ''}`}>
                {i % 2 !== 0 && (
                  <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] shrink-0 mt-1" />
                )}
                <div className={`${i % 2 === 0 ? 'ml-auto' : ''} max-w-[70%]`}>
                  <div
                    className={`h-10 rounded-2xl ${
                      i % 2 === 0
                        ? 'bg-[var(--bubble-user)]/40 rounded-tr-md'
                        : 'bg-[var(--bubble-assistant)]/40 rounded-tl-md'
                    }`}
                    style={{ width: `${100 + Math.random() * 150}px` }}
                  />
                  <div className="h-3 w-12 mt-1 rounded bg-[var(--bg-tertiary)]/30 ml-1" />
                </div>
              </div>
            ))}
          </div>
        ) : messages.length === 0 && !streaming ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="text-5xl mb-4">{agentEmoji}</div>
            <h2 className="text-lg font-semibold text-white mb-2">Chat with {agentName}</h2>
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
                <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-sm shrink-0 mt-1">
                  {agentEmoji}
                </div>
                <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-tl-md bg-[var(--bubble-assistant)] text-sm break-words">
                  <MarkdownRenderer content={streamText} />
                  <span className="inline-block w-0.5 h-4 bg-[var(--accent)] ml-0.5 animate-blink" />
                </div>
              </div>
            )}
            
            {/* Typing indicator */}
            {sending && !streaming && !streamText && (
              <div className="flex gap-2 animate-fade-in">
                <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-sm shrink-0 mt-1">
                  {agentEmoji}
                </div>
                <div className="px-4 py-3 rounded-2xl rounded-tl-md bg-[var(--bubble-assistant)]">
                  <div className="flex gap-1.5">
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
                  className="flex items-center gap-2 px-5 py-2.5 bg-[var(--error)]/10 hover:bg-[var(--error)]/20 text-[var(--error)] text-sm font-medium rounded-full transition-colors active:scale-95"
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
            className="fixed bottom-28 right-4 sm:right-6 z-10 w-11 h-11 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border)] rounded-full flex items-center justify-center shadow-lg transition-all animate-fade-in active:scale-95"
          >
            <svg className="w-5 h-5 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
        )}
      </div>

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="shrink-0 px-4 py-2.5 bg-[var(--bg-secondary)] border-t border-[var(--border)] flex gap-2 overflow-x-auto">
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
                className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-[var(--error)] text-white rounded-full flex items-center justify-center text-xs shadow-md"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="shrink-0 px-3 sm:px-4 py-3 bg-[var(--bg-secondary)] border-t border-[var(--border)] safe-bottom">
        {voiceMode ? (
          /* Voice recording mode */
          <div className="flex items-center gap-2 min-h-[52px]">
            <VoiceRecorder
              onSend={handleVoiceSend}
              onCancel={() => setVoiceMode(false)}
              disabled={sending}
            />
          </div>
        ) : (
          /* Normal text input mode */
          <form onSubmit={handleSend} className="flex items-end gap-2">
            {/* Attachment button — 44x44 touch target */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center w-11 h-11 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded-xl transition-colors shrink-0 active:scale-95"
              title="Attach file"
            >
              <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
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

            {/* Textarea — NOT disabled during sending (Fix #3) */}
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={`Message ${agentName}...`}
              rows={1}
              className="flex-1 min-h-[44px] max-h-[150px] px-4 py-3 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-2xl text-[15px] text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors resize-none leading-snug"
            />

            {/* Send or Voice button — 44x44 touch target */}
            {hasInput ? (
              <button
                type="submit"
                disabled={sending}
                className="flex items-center justify-center w-11 h-11 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-xl transition-all shrink-0 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-[var(--accent)]/20"
              >
                {sending ? (
                  <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                  </svg>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setVoiceMode(true)}
                disabled={sending}
                className="flex items-center justify-center w-11 h-11 text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 rounded-xl transition-colors shrink-0 active:scale-95 disabled:opacity-40"
                title="Record voice message"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>
            )}
          </form>
        )}
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
        <div className="px-4 py-2 rounded-full bg-[var(--error)]/10 text-[var(--error)] text-xs">
          {message.content}
        </div>
      </div>
    );
  }

  const msgDate = new Date(message.timestamp);
  const now = new Date();
  const isToday = msgDate.toDateString() === now.toDateString();
  const isYesterday = msgDate.toDateString() === new Date(now.getTime() - 86400000).toDateString();
  const timeStr = isToday
    ? msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : isYesterday
      ? `Yesterday ${msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : `${msgDate.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  return (
    <div className={`flex gap-2 animate-fade-in ${isUser ? 'flex-row-reverse' : ''}`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-sm shrink-0 mt-1">
          {agentEmoji}
        </div>
      )}
      
      <div className="max-w-[85%]">
        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className={`flex flex-wrap gap-2 mb-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
            {message.attachments.map(att => (
              att.type === 'audio' ? (
                <div
                  key={att.id}
                  className={`px-3 py-2.5 rounded-2xl ${
                    isUser
                      ? 'bg-[var(--bubble-user)] rounded-tr-md'
                      : 'bg-[var(--bubble-assistant)] rounded-tl-md'
                  }`}
                >
                  <AudioBubblePlayer
                    src={att.dataUrl}
                    duration={att.duration}
                    isUser={isUser}
                  />
                </div>
              ) : att.type === 'image' && att.previewUrl ? (
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
          <div className={`px-4 py-3 rounded-2xl text-[15px] break-words leading-relaxed ${
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
        <div className={`flex items-center gap-1 mt-1 px-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
          <span className="text-[10px] text-[var(--text-muted)]">{timeStr}</span>
          {isUser && message.status === 'sending' && (
            <svg className="w-3 h-3 text-[var(--text-muted)] animate-spin" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {isUser && message.status === 'sent' && (
            <svg className="w-3.5 h-3.5 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          {isUser && message.status === 'error' && (
            <svg className="w-3.5 h-3.5 text-[var(--error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
