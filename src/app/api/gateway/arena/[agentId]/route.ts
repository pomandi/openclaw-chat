import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import { readFile, readdir } from 'fs/promises';
import path from 'path';
import { getRPGClass, calculateHP, calculateMP, calculateLevel, MAX_CONTEXT_TOKENS } from '@/lib/rpg-mapping';
import type { AgentDetailData, QuestInfo } from '@/lib/types-arena';

const AGENTS_PATH = process.env.AGENTS_PATH || '/home/claude/.openclaw/agents';
const CRON_PATH = process.env.CRON_PATH || '/home/claude/.openclaw/cron/jobs.json';

export const dynamic = 'force-dynamic';

async function readJSON(filePath: string): Promise<any> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

async function listDir(dirPath: string): Promise<string[]> {
  try {
    return await readdir(dirPath);
  } catch {
    return [];
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { agentId } = await params;
  const agentPath = path.join(AGENTS_PATH, agentId);

  try {
    // Read SOUL.md
    const soulMd = await readTextFile(path.join(agentPath, 'agent', 'SOUL.md'));

    // Read sessions
    const sessions = (await readJSON(path.join(agentPath, 'sessions', 'sessions.json'))) || {};

    // Calculate tokens
    let activeTokens = 0;
    let lastUpdate = 0;
    let totalXP = 0;
    const sessionCount = Object.keys(sessions).length;

    for (const [key, session] of Object.entries(sessions)) {
      const s = session as any;
      const t = s.totalTokens || 0;
      totalXP += t;
      if (key === `agent:${agentId}:main` || t > activeTokens) {
        activeTokens = Math.max(activeTokens, t);
      }
      const u = s.updatedAt || 0;
      if (u > lastUpdate) lastUpdate = u;
    }

    // Memory files
    const workspacePath = `/home/claude/.openclaw/workspace-${agentId}/memory`;
    let memoryFiles = await listDir(workspacePath);
    memoryFiles = memoryFiles.filter(f => f.endsWith('.md'));

    // Agent dir files (for skills list)
    const agentDirFiles = await listDir(path.join(agentPath, 'agent'));

    // Skills from AGENTS.md or agent config
    const agentsMd = await readTextFile(path.join(agentPath, 'agent', 'AGENTS.md'));
    const skills: string[] = [];
    if (agentsMd) {
      // Extract skill names from AGENTS.md
      const skillMatches = agentsMd.match(/<name>([^<]+)<\/name>/g);
      if (skillMatches) {
        for (const match of skillMatches) {
          const name = match.replace(/<\/?name>/g, '');
          skills.push(name);
        }
      }
    }

    // Quests for this agent
    const cronData = await readJSON(CRON_PATH);
    const quests: QuestInfo[] = (cronData?.jobs || [])
      .filter((job: any) => job.agentId === agentId)
      .map((job: any) => ({
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

    // Determine workspace
    const openclawConfig = await readJSON('/home/claude/.openclaw/openclaw.json');
    const agentConfig = (openclawConfig?.list || []).find((a: any) => a.id === agentId);
    const workspace = agentConfig?.workspace || null;

    const rpg = getRPGClass(agentId);
    const hp = calculateHP(activeTokens, MAX_CONTEXT_TOKENS);
    const mp = calculateMP(activeTokens, MAX_CONTEXT_TOKENS);

    // Status
    const age = lastUpdate ? Date.now() - lastUpdate : Infinity;
    const status = age < 60_000 ? 'working' : age < 300_000 ? 'thinking' : age < 3_600_000 ? 'idle' : 'offline';

    const result: AgentDetailData = {
      id: agentId,
      name: rpg.className,
      rpgClass: rpg.className,
      icon: rpg.icon,
      color: rpg.color,
      description: rpg.description,
      hp,
      mp,
      totalTokens: activeTokens,
      maxTokens: MAX_CONTEXT_TOKENS,
      level: Math.max(1, calculateLevel(totalXP) + memoryFiles.length),
      xp: totalXP,
      status: status as any,
      lastActivity: lastUpdate || null,
      activeQuest: null,
      lastTool: null,
      sessionCount,
      soulMd,
      skills,
      quests,
      contextBreakdown: null,
      recentMemory: memoryFiles.slice(0, 10),
      workspace,
    };

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[Arena Detail API] error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
