// Arena type definitions

export type AgentStatus = 'idle' | 'thinking' | 'working' | 'error' | 'offline';

export interface ContextBreakdown {
  systemPrompt: number;
  skills: number;
  conversation: number;
  total: number;
}

export interface QuestInfo {
  id: string;
  name: string;
  agentId: string;
  enabled: boolean;
  cronExpr: string;
  timezone: string;
  nextRunAtMs: number | null;
  lastRunAtMs: number | null;
  lastStatus: string | null;
  lastDurationMs: number | null;
}

export interface AgentRPGState {
  id: string;
  name: string;
  rpgClass: string;
  icon: string;
  color: string;
  description: string;

  // HP = context usage ratio (0-1), MP = remaining ratio (0-1)
  hp: number;
  mp: number;
  totalTokens: number;
  maxTokens: number;

  // Level = memory depth, XP = total historical tokens
  level: number;
  xp: number;

  status: AgentStatus;
  lastActivity: number | null;

  // Active quest (current cron or conversation)
  activeQuest: string | null;

  // Last tool usage
  lastTool: string | null;

  // Session count
  sessionCount: number;
}

export interface ArenaEvent {
  id: string;
  timestamp: number;
  agentId: string;
  type: 'tool_call' | 'chat' | 'quest_start' | 'quest_complete' | 'quest_fail' | 'status_change' | 'message';
  message: string;
  icon: string;
  color: string;
}

export interface AgentDetailData extends AgentRPGState {
  soulMd: string | null;
  skills: string[];
  quests: QuestInfo[];
  contextBreakdown: ContextBreakdown | null;
  recentMemory: string[];
  workspace: string | null;
}

export interface ArenaData {
  agents: AgentRPGState[];
  quests: QuestInfo[];
  timestamp: number;
}
