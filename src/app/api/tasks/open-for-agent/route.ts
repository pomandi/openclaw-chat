import { NextRequest, NextResponse } from 'next/server';
import { query, AgentTask } from '@/lib/db';

// GET /api/tasks/open-for-agent?agentId=main
// Returns open forward tasks assigned to the given agent
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');

    if (!agentId) {
      return NextResponse.json(
        { error: 'agentId is required' },
        { status: 400 }
      );
    }

    const result = await query<AgentTask>(
      `SELECT id, title, created_by, status, metadata, created_at
       FROM agent_tasks
       WHERE metadata->>'type' = 'forward'
         AND assigned_agent = $1
         AND status IN ('pending', 'running', 'blocked')
       ORDER BY created_at DESC`,
      [agentId]
    );

    return NextResponse.json({ tasks: result.rows });
  } catch (error) {
    console.error('GET /api/tasks/open-for-agent error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch open tasks for agent' },
      { status: 500 }
    );
  }
}
