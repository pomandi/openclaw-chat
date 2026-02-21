import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { getRPGClass, calculateHP, calculateMP, calculateLevel, MAX_CONTEXT_TOKENS } from '@/lib/rpg-mapping';
import type { AgentRPGState, QuestInfo, ArenaData, AgentStatus } from '@/lib/types-arena';

const AGENTS_PATH = process.env.AGENTS_PATH || '/home/claude/.openclaw/agents';
const CRON_PATH = process.env.CRON_PATH || `${AGENTS_PATH}/_cron/jobs.json`;

export const dynamic = 'force-dynamic';

async function readJSON(filePath: string): Promise<any> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function getAgentDirs(): Promise<string[]> {
  try {
    return await readdir(AGENTS_PATH);
  } catch {
    return [];
  }
}

async function countMemoryFiles(agentId: string): Promise<number> {
  // Check workspace memory directory
  try {
    const workspacePath = `/home/claude/.openclaw/workspace-${agentId}/memory`;
    const files = await readdir(workspacePath);
    return files.filter(f => f.endsWith('.md')).length;
  } catch {
    // No workspace memory dir
  }
  // Check agent dir for SOUL.md as fallback
  try {
    const agentPath = path.join(AGENTS_PATH, agentId, 'agent');
    const files = await readdir(agentPath);
    return files.filter(f => f.endsWith('.md') || f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

async function getAgentSessions(agentId: string): Promise<Record<string, any>> {
  const sessionsPath = path.join(AGENTS_PATH, agentId, 'sessions', 'sessions.json');
  return (await readJSON(sessionsPath)) || {};
}

function getActiveSession(sessions: Record<string, any>, agentId: string): { totalTokens: number; updatedAt: number } {
  // Find the main session for the agent
  const mainKey = `agent:${agentId}:main`;
  const mainSession = sessions[mainKey];

  // Also sum up all session tokens for XP
  let maxTokens = 0;
  let lastUpdate = 0;

  for (const [, session] of Object.entries(sessions)) {
    const s = session as any;
    const t = s.totalTokens || 0;
    if (t > maxTokens) maxTokens = t;
    const u = s.updatedAt || 0;
    if (u > lastUpdate) lastUpdate = u;
  }

  return {
    totalTokens: mainSession?.totalTokens || maxTokens,
    updatedAt: lastUpdate,
  };
}

function getTotalXP(sessions: Record<string, any>): number {
  let total = 0;
  for (const [, session] of Object.entries(sessions)) {
    total += (session as any).totalTokens || 0;
  }
  return total;
}

function getAgentStatus(updatedAt: number): AgentStatus {
  if (!updatedAt) return 'offline';
  const age = Date.now() - updatedAt;
  if (age < 60_000) return 'working';       // active in last minute
  if (age < 300_000) return 'thinking';      // active in last 5 min
  if (age < 3_600_000) return 'idle';        // active in last hour
  return 'offline';
}

async function loadQuests(): Promise<QuestInfo[]> {
  const data = await readJSON(CRON_PATH);
  if (!data?.jobs) return [];

  return data.jobs.map((job: any) => ({
    id: job.id,
    name: job.name,
    agentId: job.agentId,
    enabled: job.enabled,
    cronExpr: job.schedule?.expr || '',
    timezone: job.schedule?.tz || 'UTC',
    nextRunAtMs: job.state?.nextRunAtMs || null,
    lastRunAtMs: job.state?.lastRunAtMs || null,
    lastStatus: job.state?.lastStatus || null,
    lastDurationMs: job.state?.lastDurationMs || null,
  }));
}

export async function GET(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const agentDirs = await getAgentDirs();
    const quests = await loadQuests();

    const agents: AgentRPGState[] = await Promise.all(
      agentDirs.map(async (agentId) => {
        const rpg = getRPGClass(agentId);
        const sessions = await getAgentSessions(agentId);
        const { totalTokens, updatedAt } = getActiveSession(sessions, agentId);
        const xp = getTotalXP(sessions);
        const memoryCount = await countMemoryFiles(agentId);
        const status = getAgentStatus(updatedAt);
        const sessionCount = Object.keys(sessions).length;

        // Find active quest for this agent
        const agentQuests = quests.filter(q => q.agentId === agentId && q.enabled);
        const now = Date.now();
        const runningQuest = agentQuests.find(q =>
          q.lastRunAtMs && q.lastStatus === 'ok' && (now - q.lastRunAtMs) < 120_000
        );

        return {
          id: agentId,
          name: rpg.className,
          rpgClass: rpg.className,
          icon: rpg.icon,
          color: rpg.color,
          description: rpg.description,
          hp: calculateHP(totalTokens, MAX_CONTEXT_TOKENS),
          mp: calculateMP(totalTokens, MAX_CONTEXT_TOKENS),
          totalTokens,
          maxTokens: MAX_CONTEXT_TOKENS,
          level: Math.max(1, calculateLevel(xp) + memoryCount),
          xp,
          status,
          lastActivity: updatedAt || null,
          activeQuest: runningQuest?.name || null,
          lastTool: null,
          sessionCount,
        };
      })
    );

    // Sort: working/thinking first, then idle, then offline
    const statusOrder: Record<AgentStatus, number> = {
      working: 0, thinking: 1, error: 2, idle: 3, offline: 4,
    };
    agents.sort((a, b) => (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5));

    const result: ArenaData = {
      agents,
      quests,
      timestamp: Date.now(),
    };

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[Arena API] error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
