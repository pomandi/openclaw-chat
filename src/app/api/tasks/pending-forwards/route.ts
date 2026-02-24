import { NextRequest, NextResponse } from 'next/server';
import { query, AgentTask } from '@/lib/db';

// GET /api/tasks/pending-forwards?sourceAgent=investor
// Returns open forward tasks created by the given agent
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceAgent = searchParams.get('sourceAgent');

    if (!sourceAgent) {
      return NextResponse.json(
        { error: 'sourceAgent is required' },
        { status: 400 }
      );
    }

    const result = await query<Pick<AgentTask, 'id' | 'title' | 'assigned_agent' | 'status' | 'created_at'>>(
      `SELECT id, title, assigned_agent, status, created_at
       FROM agent_tasks
       WHERE metadata->>'type' = 'forward'
         AND created_by = $1
         AND status IN ('pending', 'running')
       ORDER BY created_at DESC`,
      [sourceAgent]
    );

    return NextResponse.json({ tasks: result.rows });
  } catch (error) {
    console.error('GET /api/tasks/pending-forwards error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pending forwards' },
      { status: 500 }
    );
  }
}
