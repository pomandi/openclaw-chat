'use client';

import { useState, useRef, useEffect, useCallback, FormEvent } from 'react';
import {
  Agent,
  ChatMessage,
  Attachment,
  getAgentEmoji,
  getAgentName,
  MAX_FILE_SIZE,
  SUPPORTED_IMAGE_TYPES,
  SUPPORTED_FILE_TYPES,
  SUPPORTED_PDF_TYPES,
  SUPPORTED_PSD_TYPES,
  inferMimeTypeFromFilename,
} from '@/lib/types';
// Forward task type (subset of AgentTask from db)
interface ForwardTask {
  id: number;
  title: string;
  created_by: string;
  status: string;
  metadata: Record<string, unknown> | string | null;
  created_at: string;
}
import MarkdownRenderer from './MarkdownRenderer';
import VoiceRecorder, { AudioBubblePlayer } from './VoiceRecorder';
import VoiceMode from './VoiceMode';

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

// Helper to format dates for separators
function formatDateSeparator(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  
  if (msgDate.getTime() === today.getTime()) return 'Today';
  if (msgDate.getTime() === yesterday.getTime()) return 'Yesterday';
  
  return date.toLocaleDateString([], { 
    day: 'numeric', 
    month: 'short',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {})
  });
}

// Helper to check if messages should be grouped
function shouldGroupMessages(current: ChatMessage, previous: ChatMessage): boolean {
  if (!previous) return false;
  if (current.role !== previous.role) return false;
  if (current.role === 'system') return false;
  
  // Group if messages are within 2 minutes of each other
  const timeDiff = (current.timestamp || 0) - (previous.timestamp || 0);
  return timeDiff < 120000; // 2 minutes
}

interface ChatViewProps {
  agent: Agent;
  agents: Agent[];
  sessionKey: string;
  onOpenSidebar?: () => void;
  onBack?: () => void;
}

export default function ChatView({ agent, agents, sessionKey, onOpenSidebar, onBack }: ChatViewProps) {
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
  const [fullVoiceMode, setFullVoiceMode] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [forwardingSelection, setForwardingSelection] = useState(false);

  // Forward/Resolve state
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [forwardMode, setForwardMode] = useState<'solve' | 'explain'>('solve');
  const [openTasksForAgent, setOpenTasksForAgent] = useState<ForwardTask[]>([]);
  const [resolvingTaskId, setResolvingTaskId] = useState<number | null>(null);
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Instruction modal state (shown after agent selection)
  const [showInstructionModal, setShowInstructionModal] = useState(false);
  const [forwardInstruction, setForwardInstruction] = useState('');
  const [selectedTargetAgent, setSelectedTargetAgent] = useState<Agent | null>(null);
  const instructionInputRef = useRef<HTMLTextAreaElement>(null);

  // Pull to refresh state
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    message: ChatMessage | null;
    x: number;
    y: number;
  }>({
    visible: false,
    message: null,
    x: 0,
    y: 0,
  });
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pullStartY = useRef<number>(0);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);

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

  // Reset selection mode when session changes
  useEffect(() => {
    setSelectionMode(false);
    setSelectedMessageIds(new Set());
    setResolvingTaskId(null);
    setShowAgentPicker(false);
    setShowTaskPicker(false);
    setShowInstructionModal(false);
    setSelectedTargetAgent(null);
    setForwardInstruction('');
  }, [sessionKey]);

  // Poll open forward tasks for this agent
  useEffect(() => {
    async function fetchOpenTasks() {
      try {
        const res = await fetch(`/api/tasks/open-for-agent?agentId=${encodeURIComponent(agent.id)}`);
        if (res.ok) {
          const data = await res.json();
          setOpenTasksForAgent(data.tasks || []);
        }
      } catch {
        // silent
      }
    }
    fetchOpenTasks();
    const interval = setInterval(fetchOpenTasks, 30_000);
    return () => clearInterval(interval);
  }, [agent.id]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // SSE connection for real-time events (replaces polling)
  useEffect(() => {
    if (loadingHistory) return;
    
    console.log('[SSE] Connecting to events stream for sessionKey:', sessionKey);
    const eventSource = new EventSource(`/api/gateway/events?sessionKey=${encodeURIComponent(sessionKey)}`);
    
    eventSource.onopen = () => {
      console.log('[SSE] Connected to events stream');
    };
    
    eventSource.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        console.log('[SSE] Received event:', payload);
        
        // Filter by sessionKey (server should already filter, but double-check)
        if (payload.sessionKey !== sessionKey) {
          console.log('[SSE] Ignoring event for different session:', payload.sessionKey);
          return;
        }
        
        if (payload.state === 'delta') {
          // Streaming text update
          const text = payload.message?.content?.[0]?.text || 
                      payload.message?.content?.text ||
                      payload.message?.content ||
                      '';
          setStreamText(text);
          setStreaming(true);
        } else if (payload.state === 'final') {
          // Add completed message
          const content = payload.message?.content;
          const text = Array.isArray(content) 
            ? content.filter(p => p.type === 'text').map(p => p.text).join('')
            : typeof content === 'string' ? content : String(content || '');
          
          const msgId = `asst_${Date.now()}_${Math.random()}`;
          if (text?.trim()) {
            setMessages(prev => [...prev, {
              id: msgId,
              role: 'assistant',
              content: text,
              timestamp: Date.now(),
              status: 'sent',
            }]);
            
            // Fetch token usage for this session after response
            if (sessionKey) {
              fetch(`/api/gateway/usage?sessionKey=${encodeURIComponent(sessionKey)}`)
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                  if (data?.totals) {
                    setMessages(prev => prev.map(m => 
                      m.id === msgId ? { ...m, usage: data.totals } : m
                    ));
                  }
                })
                .catch(() => {}); // Silent fail for usage
            }
          }
          setStreaming(false);
          setStreamText('');
          setSending(false);
        } else if (payload.state === 'error') {
          // Handle error
          const errorText = payload.errorMessage || 'Agent error occurred';
          setMessages(prev => [...prev, {
            id: `err_${Date.now()}`,
            role: 'system',
            content: errorText,
            timestamp: Date.now(),
            status: 'error',
          }]);
          setStreaming(false);
          setStreamText('');
          setSending(false);
        }
      } catch (err) {
        console.error('[SSE] Failed to parse event:', err, e.data);
      }
    };
    
    eventSource.onerror = (err) => {
      console.error('[SSE] Connection error:', err);
      // EventSource will automatically reconnect
    };
    
    return () => {
      console.log('[SSE] Closing events stream');
      eventSource.close();
    };
  }, [sessionKey, loadingHistory]);

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

      const rawMime = (file.type || '').toLowerCase();
      const inferredMime = inferMimeTypeFromFilename(file.name);
      const effectiveMime = rawMime || inferredMime || '';

      const isImage = SUPPORTED_IMAGE_TYPES.includes(effectiveMime);
      const isPdf = SUPPORTED_PDF_TYPES.includes(effectiveMime) || file.name.toLowerCase().endsWith('.pdf');
      const isPsd = SUPPORTED_PSD_TYPES.includes(effectiveMime) || file.name.toLowerCase().endsWith('.psd');

      if (!isImage && !isPdf && !isPsd) {
        const label = effectiveMime || 'unknown';
        alert(`File type "${label}" is not supported.`);
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;

        const attachment: Attachment = {
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          type: isImage ? 'image' : 'file',
          name: file.name,
          size: file.size,
          mimeType: effectiveMime || 'application/octet-stream',
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

  // Send message via WebSocket (non-blocking, response comes via SSE)
  async function handleSend(e?: FormEvent, retryMsg?: ChatMessage) {
    e?.preventDefault();
    const text = retryMsg?.content || input.trim();
    const msgAttachments = retryMsg?.attachments || [...attachments];
    
    if (!text && msgAttachments.length === 0) return;
    
    // If already sending, allow force-reset by tapping send again
    if (sending) {
      console.warn('[Chat] Force-cancelling stuck request');
      setSending(false);
      setStreaming(false);
      setStreamText('');
      return;
    }

    const agentId = sessionKey.split(':')[1] || agent.id;

    // Add user message to UI immediately
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

    // Safety timeout: auto-reset sending state after 30s
    const safetyTimeout = setTimeout(() => {
      console.warn('[Chat] Safety timeout: resetting sending state after 30s');
      setSending(false);
      setStreaming(false);
      setStreamText('');
    }, 30_000);

    try {
      // Send via API (non-blocking) - will get ACK, response comes via SSE
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
            duration: a.duration,
          })),
        }),
      });

      if (!res.ok) {
        let errBody = '';
        try { errBody = await res.text(); } catch {}
        const parsed = errBody ? (() => { try { return JSON.parse(errBody); } catch { return null; } })() : null;
        throw new Error(parsed?.error || `Server error: ${res.status}`);
      }

      // Mark user message as sent (successful API call)
      setMessages(prev => prev.map(m =>
        m.id === userMsg.id ? { ...m, status: 'sent' as const } : m
      ));

      // Response will come via SSE — setSending(false) will be called when 'final' event arrives
      // Don't call setSending(false) here, wait for SSE events

    } catch (err: any) {
      console.error('[Chat] send error:', err);
      clearTimeout(safetyTimeout);
      
      // Mark user message as error
      setMessages(prev => prev.map(m =>
        m.id === userMsg.id ? { ...m, status: 'error' as const } : m
      ));
      setRetryMessage(userMsg);

      // Add error message
      const errorText = `Failed to send: ${err.message}`;
      setMessages(prev => [...prev, {
        id: `err_${Date.now()}`,
        role: 'system',
        content: errorText,
        timestamp: Date.now(),
        status: 'error',
      }]);
      
      // Reset state since we failed before agent processing
      setSending(false);
      setStreaming(false);
      setStreamText('');
    }
    
    // Note: We don't clear safetyTimeout here because we want it to run
    // It will be cleared when SSE events reset the state
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

  // Voice message handler (updated for WebSocket flow)
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

        // Step 2: Send to agent via WebSocket (response will come via SSE)
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
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Server error: ${res.status} - ${errText}`);
        }

        // Mark user message as sent
        setMessages(prev => prev.map(m =>
          m.id === userMsg.id ? { ...m, status: 'sent' as const } : m
        ));

        // Response will come via SSE — don't reset sending state here

      } catch (err: any) {
        console.error('[Voice] send error:', err);
        setMessages(prev => prev.map(m =>
          m.id === userMsg.id ? { ...m, status: 'error' as const } : m
        ));
        setMessages(prev => [...prev, {
          id: `err_${Date.now()}`,
          role: 'system',
          content: `Failed to send voice message: ${err.message}`,
          timestamp: Date.now(),
          status: 'error',
        }]);
        
        // Reset state since we failed before agent processing
        setSending(false);
        setStreaming(false);
        setStreamText('');
      }
    })();
  }

  function toggleMessageSelection(messageId: string) {
    if (!selectionMode) return;
    setSelectedMessageIds(prev => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

  // Forward: open agent picker for Çöz or Açıkla
  function startForward(mode: 'solve' | 'explain') {
    setForwardMode(mode);
    setShowAgentPicker(true);
  }

  // Forward: after agent selection, show instruction modal
  function onAgentSelected(targetAgent: Agent) {
    setShowAgentPicker(false);
    setSelectedTargetAgent(targetAgent);
    const defaultInstruction = forwardMode === 'solve'
      ? 'Bu durumu çöz. Gerekli aksiyonu net ve uygulanabilir şekilde ver.'
      : 'Bu durumu açıkla ve net bir çözüm planı çıkar.';
    setForwardInstruction(defaultInstruction);
    setShowInstructionModal(true);
    // Focus the textarea after modal renders
    setTimeout(() => instructionInputRef.current?.focus(), 100);
  }

  // Forward selected messages to a target agent (called from instruction modal)
  async function forwardSelectedToAgent(targetAgent: Agent, customInstruction?: string) {
    setShowInstructionModal(false);
    setSelectedTargetAgent(null);
    const selectedMessages = messages
      .filter(m => selectedMessageIds.has(m.id) && (m.role === 'user' || m.role === 'assistant'))
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    if (selectedMessages.length === 0) return;

    setForwardingSelection(true);
    const targetName = getAgentName(targetAgent);

    try {
      const instruction = customInstruction?.trim() || (forwardMode === 'solve'
        ? 'Bu durumu çöz. Gerekli aksiyonu net ve uygulanabilir şekilde ver.'
        : 'Bu durumu açıkla ve net bir çözüm planı çıkar.');

      const forwardedMsgs = selectedMessages.map(m => ({
        role: m.role,
        content: m.content || '',
        timestamp: m.timestamp,
      }));

      const lines = selectedMessages.map((m, idx) => {
        const time = new Date(m.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const role = m.role.toUpperCase();
        const attachmentInfo = m.attachments?.length
          ? ` | attachments: ${m.attachments.map(a => a.name).join(', ')}`
          : '';
        return `${idx + 1}. [${role} ${time}] ${m.content || '(empty)'}${attachmentInfo}`;
      });

      // Step 1: Create task
      const taskMetadata = {
        type: 'forward',
        mode: forwardMode,
        source_agent: agent.id,
        source_session: sessionKey,
        target_agent: targetAgent.id,
        target_session: `agent:${targetAgent.id}:main`,
        forwarded_messages: forwardedMsgs,
      };

      const taskRes = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `[${forwardMode === 'solve' ? 'Çöz' : 'Açıkla'}] ${agentName} → ${targetName}: ${selectedMessages.length} mesaj`,
          description: lines.join('\n'),
          createdBy: agent.id,
          assignedAgent: targetAgent.id,
          priority: 'normal',
          metadata: taskMetadata,
        }),
      });

      if (!taskRes.ok) throw new Error('Task oluşturulamadı');
      const task = await taskRes.json();

      // Step 2: Send context to target agent
      const forwardedContext = [
        `[Forward Task #${task.id} from app.pomandi]`,
        `Source agent: ${agentName} (${agent.id})`,
        `Source session: ${sessionKey}`,
        `Task ID: ${task.id}`,
        `Mode: ${forwardMode}`,
        `Selected messages: ${selectedMessages.length}`,
        '',
        ...lines,
        '',
        `Instruction: ${instruction}`,
        '',
        `Bu gorev Task #${task.id} olarak takip ediliyor.`,
        `Is bittiginde durumu task tool ile guncelle:`,
        `- Basarili: task(action="update", taskId=${task.id}, status="done", summary="ozet")`,
        `- Basarisiz: task(action="update", taskId=${task.id}, status="failed", summary="neden")`,
        `- Engel var: task(action="update", taskId=${task.id}, status="blocked", summary="ne lazim")`,
      ].join('\n');

      const chatRes = await fetch('/api/gateway/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: targetAgent.id,
          sessionKey: `agent:${targetAgent.id}:main`,
          message: forwardedContext,
        }),
      });

      if (!chatRes.ok) throw new Error(`${targetName}'e mesaj gönderilemedi`);

      // Step 3: Mark task as running
      await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'running' }),
      });

      setSelectionMode(false);
      setSelectedMessageIds(new Set());
      setToast({ message: `${selectedMessages.length} mesaj ${targetName}'e iletildi (Task #${task.id})`, type: 'success' });
    } catch (err: any) {
      console.error('[Chat] forwardSelectedToAgent error:', err);
      setToast({ message: `Forward hatası: ${err.message}`, type: 'error' });
    } finally {
      setForwardingSelection(false);
    }
  }

  // Resolve: start resolution flow
  function startResolve() {
    if (openTasksForAgent.length === 1) {
      // Single task — go directly to selection mode
      setResolvingTaskId(openTasksForAgent[0].id);
      setSelectionMode(true);
      setSelectedMessageIds(new Set());
    } else if (openTasksForAgent.length > 1) {
      // Multiple tasks — show task picker
      setShowTaskPicker(true);
    }
  }

  function selectTaskToResolve(taskId: number) {
    setShowTaskPicker(false);
    setResolvingTaskId(taskId);
    setSelectionMode(true);
    setSelectedMessageIds(new Set());
  }

  // Complete resolution: send selected messages back to source agent
  async function resolveForwardTask() {
    if (!resolvingTaskId) return;

    const selectedMessages = messages
      .filter(m => selectedMessageIds.has(m.id) && (m.role === 'user' || m.role === 'assistant'))
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    if (selectedMessages.length === 0) return;

    const task = openTasksForAgent.find(t => t.id === resolvingTaskId);
    if (!task) return;

    setForwardingSelection(true);

    try {
      const metadata = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : task.metadata;
      const sourceAgentId = metadata?.source_agent || task.created_by;
      const sourceSession = metadata?.source_session || `agent:${sourceAgentId}:main`;
      const sourceAgentObj = agents.find(a => a.id === sourceAgentId);
      const sourceAgentName = sourceAgentObj ? getAgentName(sourceAgentObj) : sourceAgentId;

      const resolutionMsgs = selectedMessages.map(m => ({
        role: m.role,
        content: m.content || '',
        timestamp: m.timestamp,
      }));

      const resolutionText = selectedMessages.map((m, idx) => {
        const time = new Date(m.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const role = m.role.toUpperCase();
        return `${idx + 1}. [${role} ${time}] ${m.content || '(empty)'}`;
      }).join('\n');

      // Step 1: Update task as done with resolution
      const updatedMetadata = {
        ...metadata,
        resolution_messages: resolutionMsgs,
        resolved_from_session: sessionKey,
      };

      await fetch(`/api/tasks/${resolvingTaskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'done',
          result: resolutionText,
          metadata: updatedMetadata,
        }),
      });

      // Step 2: Send resolution back to source agent
      const resolutionContext = [
        `[Resolution for Task #${resolvingTaskId} from app.pomandi]`,
        `Resolved by: ${agentName} (${agent.id})`,
        `Original task: ${task.title}`,
        `Resolution (${selectedMessages.length} messages):`,
        '',
        resolutionText,
      ].join('\n');

      await fetch('/api/gateway/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: sourceAgentId,
          sessionKey: sourceSession,
          message: resolutionContext,
        }),
      });

      // Clean up
      setSelectionMode(false);
      setSelectedMessageIds(new Set());
      setResolvingTaskId(null);
      setOpenTasksForAgent(prev => prev.filter(t => t.id !== resolvingTaskId));
      setToast({ message: `Task #${resolvingTaskId} çözüldü, ${sourceAgentName}'e iletildi`, type: 'success' });
    } catch (err: any) {
      console.error('[Chat] resolveForwardTask error:', err);
      setToast({ message: `Çözüm hatası: ${err.message}`, type: 'error' });
    } finally {
      setForwardingSelection(false);
    }
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
          <div className="text-xs text-[var(--text-muted)] truncate">
            {agent.code && <span className="font-mono text-red-400 mr-1.5">{agent.code}</span>}
            {agent.id}
          </div>
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

        {/* Selection mode: forward or resolve buttons */}
        {selectionMode && selectedMessageIds.size > 0 && !resolvingTaskId && (
          <>
            <button
              onClick={() => startForward('solve')}
              disabled={forwardingSelection}
              className="px-2.5 py-1.5 rounded-lg bg-[var(--accent)]/20 text-[var(--accent)] text-xs font-medium hover:bg-[var(--accent)]/30 disabled:opacity-50"
              title="Seçilen mesajları bir agente ilet ve çöz"
            >
              Çöz ({selectedMessageIds.size})
            </button>
            <button
              onClick={() => startForward('explain')}
              disabled={forwardingSelection}
              className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-xs font-medium hover:bg-[var(--bg-hover)] disabled:opacity-50"
              title="Seçilen mesajları bir agente ilet ve açıkla"
            >
              Açıkla
            </button>
          </>
        )}

        {/* Resolution mode: resolve button */}
        {selectionMode && resolvingTaskId && selectedMessageIds.size > 0 && (
          <button
            onClick={resolveForwardTask}
            disabled={forwardingSelection}
            className="px-2.5 py-1.5 rounded-lg bg-green-500/20 text-green-400 text-xs font-medium hover:bg-green-500/30 disabled:opacity-50"
            title="Seçilen mesajlarla task'ı çöz"
          >
            Çözüldü ({selectedMessageIds.size})
          </button>
        )}

        {/* Open tasks resolve button (when not in selection mode) */}
        {!selectionMode && openTasksForAgent.length > 0 && (
          <button
            onClick={startResolve}
            className="px-2.5 py-1.5 rounded-lg bg-green-500/20 text-green-400 text-xs font-medium hover:bg-green-500/30 animate-pulse"
            title="Açık forward task'ları çöz"
          >
            Çözüldü ({openTasksForAgent.length})
          </button>
        )}

        <button
          onClick={() => {
            if (selectionMode) {
              setSelectionMode(false);
              setSelectedMessageIds(new Set());
              setResolvingTaskId(null);
            } else {
              setSelectionMode(true);
            }
          }}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            selectionMode
              ? 'bg-[var(--error)]/15 text-[var(--error)] hover:bg-[var(--error)]/25'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
          }`}
          title={selectionMode ? 'Seçimi kapat' : 'Mesaj seçimi aç'}
        >
          {selectionMode ? 'İptal' : 'Seç'}
        </button>

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
              <MessageBubble
                key={msg.id}
                message={msg}
                agentEmoji={agentEmoji}
                selectable={selectionMode && (msg.role === 'user' || msg.role === 'assistant')}
                selected={selectedMessageIds.has(msg.id)}
                onToggleSelect={toggleMessageSelection}
              />
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

      {/* Agent Picker Dropdown */}
      {showAgentPicker && (
        <div className="fixed inset-0 z-50" onClick={() => setShowAgentPicker(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute top-16 right-4 w-64 max-h-80 overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl animate-fade-in"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-[var(--border)] text-xs text-[var(--text-muted)] font-medium">
              {forwardMode === 'solve' ? 'Çöz' : 'Açıkla'} — Hedef Agent Seç
            </div>
            {agents.filter(a => a.id !== agent.id).map(a => (
              <button
                key={a.id}
                onClick={() => onAgentSelected(a)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-hover)] transition-colors text-left"
              >
                <span className="text-lg">{getAgentEmoji(a.id, a)}</span>
                <div className="min-w-0">
                  <div className="text-sm text-white font-medium truncate">{getAgentName(a)}</div>
                  <div className="text-[10px] text-[var(--text-muted)] truncate">{a.id}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Task Picker Dropdown */}
      {showTaskPicker && (
        <div className="fixed inset-0 z-50" onClick={() => setShowTaskPicker(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute top-16 right-4 w-72 max-h-80 overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl animate-fade-in"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-[var(--border)] text-xs text-[var(--text-muted)] font-medium">
              Çözülecek Task Seç
            </div>
            {openTasksForAgent.map(t => (
              <button
                key={t.id}
                onClick={() => selectTaskToResolve(t.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-hover)] transition-colors text-left"
              >
                <span className="text-xs text-[var(--accent)] font-mono font-bold">#{t.id}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white truncate">{t.title}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">from: {t.created_by}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Instruction Modal — shown after agent selection */}
      {showInstructionModal && selectedTargetAgent && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => { setShowInstructionModal(false); setSelectedTargetAgent(null); }}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full sm:w-96 max-h-[80vh] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-t-2xl sm:rounded-2xl shadow-2xl animate-slide-up overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
              <span className="text-lg">{getAgentEmoji(selectedTargetAgent.id, selectedTargetAgent)}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white truncate">
                  {forwardMode === 'solve' ? 'Çöz' : 'Açıkla'} → {getAgentName(selectedTargetAgent)}
                </div>
                <div className="text-[10px] text-[var(--text-muted)]">
                  {selectedMessageIds.size} mesaj seçili
                </div>
              </div>
              <button
                onClick={() => { setShowInstructionModal(false); setSelectedTargetAgent(null); }}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Selected messages preview */}
            <div className="px-4 py-2 max-h-32 overflow-y-auto border-b border-[var(--border)]/50">
              {messages
                .filter(m => selectedMessageIds.has(m.id))
                .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
                .map((m, idx) => (
                  <div key={m.id} className="flex items-start gap-2 py-1">
                    <span className="text-[10px] text-[var(--text-muted)] font-mono shrink-0 mt-0.5">{idx + 1}.</span>
                    <span className={`text-[10px] font-medium shrink-0 mt-0.5 ${m.role === 'user' ? 'text-blue-400' : 'text-green-400'}`}>
                      {m.role === 'user' ? 'USER' : 'ASST'}
                    </span>
                    <span className="text-xs text-[var(--text-secondary)] line-clamp-2">{m.content || '(empty)'}</span>
                  </div>
                ))}
            </div>

            {/* Instruction input */}
            <div className="px-4 py-3">
              <label className="block text-xs text-[var(--text-muted)] font-medium mb-1.5">
                Talimat (düzenleyebilirsiniz)
              </label>
              <textarea
                ref={instructionInputRef}
                value={forwardInstruction}
                onChange={(e) => setForwardInstruction(e.target.value)}
                placeholder="Ek talimat yazın... Örn: Web search yaparak araştır, bu agente şu özelliği ver..."
                rows={3}
                className="w-full px-3 py-2.5 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-xl text-sm text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors resize-none leading-snug"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    forwardSelectedToAgent(selectedTargetAgent, forwardInstruction);
                  }
                }}
              />
              <div className="text-[10px] text-[var(--text-muted)] mt-1">
                ⌘+Enter ile hızlı gönder
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 px-4 py-3 border-t border-[var(--border)]">
              <button
                onClick={() => { setShowInstructionModal(false); setSelectedTargetAgent(null); }}
                className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-sm font-medium hover:bg-[var(--bg-hover)] transition-colors active:scale-[0.98]"
              >
                İptal
              </button>
              <button
                onClick={() => forwardSelectedToAgent(selectedTargetAgent, forwardInstruction)}
                disabled={forwardingSelection}
                className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--accent)] text-white text-sm font-semibold hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50 active:scale-[0.98] shadow-md shadow-[var(--accent)]/20"
              >
                {forwardingSelection ? 'Gönderiliyor...' : 'Gönder'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg animate-fade-in max-w-[90vw] text-center ${
            toast.type === 'success'
              ? 'bg-green-500/90 text-white'
              : 'bg-[var(--error)]/90 text-white'
          }`}
          onClick={() => setToast(null)}
        >
          {toast.message}
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
              <>
                {/* Voice mode (hands-free) button */}
                <button
                  type="button"
                  onClick={() => setFullVoiceMode(true)}
                  disabled={sending}
                  className="flex items-center justify-center w-11 h-11 text-[var(--text-muted)] hover:text-[var(--success)] hover:bg-[var(--success)]/10 rounded-xl transition-colors shrink-0 active:scale-95 disabled:opacity-40"
                  title="Hands-free voice mode"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.651a3.75 3.75 0 010-5.303m5.304 0a3.75 3.75 0 010 5.303m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.79M12 12h.008v.007H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                  </svg>
                </button>
                {/* Voice recording button */}
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
              </>
            )}
          </form>
        )}
      </div>

      {/* Full-screen voice mode overlay */}
      {fullVoiceMode && (
        <VoiceMode
          agent={agent}
          sessionKey={sessionKey}
          onClose={() => setFullVoiceMode(false)}
          onMessageSent={(text) => {
            // Add user message to chat history
            setMessages(prev => [...prev, {
              id: `user_vm_${Date.now()}`,
              role: 'user',
              content: text,
              timestamp: Date.now(),
              status: 'sent',
            }]);
          }}
          onAgentResponse={(text) => {
            // Agent response is already handled by the main SSE listener
            // No need to add here to avoid duplicates
          }}
        />
      )}
    </div>
  );
}


function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <button
      onClick={handleCopy}
      className="p-0.5 rounded opacity-40 hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all active:scale-90"
      title={copied ? 'Copied!' : 'Copy message'}
    >
      {copied ? (
        <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}

function MessageBubble({
  message,
  agentEmoji,
  selectable,
  selected,
  onToggleSelect,
}: {
  message: ChatMessage;
  agentEmoji: string;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (messageId: string) => void;
}) {
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
    <div
      className={`group/msg flex gap-2 animate-fade-in ${isUser ? 'flex-row-reverse' : ''} ${selectable ? 'cursor-pointer' : ''}`}
      onClick={() => {
        if (selectable && onToggleSelect) onToggleSelect(message.id);
      }}
    >
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-sm shrink-0 mt-1">
          {agentEmoji}
        </div>
      )}
      
      <div className={`max-w-[85%] ${selected ? 'ring-2 ring-[var(--accent)] rounded-2xl' : ''}`}>
        {selectable && (
          <div className={`mb-1 text-[10px] ${isUser ? 'text-right' : 'text-left'} text-[var(--text-muted)]`}>
            {selected ? '☑ Seçili' : '☐ Seç'}
          </div>
        )}
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
                  onClick={(e) => {
                    e.stopPropagation();
                    if (selectable && onToggleSelect) {
                      onToggleSelect(message.id);
                      return;
                    }
                    window.open(att.dataUrl, '_blank');
                  }}
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

        {/* Timestamp, status & usage */}
        <div className={`flex items-center gap-1 mt-1 px-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
          <span className="text-[10px] text-[var(--text-muted)]">{timeStr}</span>
          {!isUser && message.usage && (
            <span className="text-[10px] text-[var(--text-muted)] opacity-70 ml-1" title={`Input: ${message.usage.input.toLocaleString()} | Output: ${message.usage.output.toLocaleString()} | Cache: ${message.usage.cacheRead.toLocaleString()} | Cost: $${message.usage.totalCost.toFixed(4)}`}>
              📊 {message.usage.totalTokens >= 1000 ? `${(message.usage.totalTokens / 1000).toFixed(1)}k` : message.usage.totalTokens} tok · ${message.usage.totalCost < 0.01 ? '<$0.01' : `$${message.usage.totalCost.toFixed(2)}`}
            </span>
          )}
          {/* Copy button */}
          <CopyButton text={message.content} />
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
