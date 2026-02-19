import { NextRequest, NextResponse } from 'next/server';
import { query, AgentTask, TasksListResult, TaskStats } from '@/lib/db';

// GET /api/tasks - List tasks with filters and pagination
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // pending, running, done, failed
    const assignedAgent = searchParams.get('assignedAgent');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const offset = (page - 1) * limit;

    // Build WHERE clause
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    if (assignedAgent) {
      conditions.push(`assigned_agent = $${paramIndex++}`);
      params.push(assignedAgent);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM agent_tasks ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Get tasks - active (pending/running) first, then completed by date desc
    const tasksResult = await query<AgentTask>(
      `SELECT * FROM agent_tasks
       ${whereClause}
       ORDER BY
         CASE WHEN status IN ('pending', 'running') THEN 0 ELSE 1 END,
         CASE WHEN status = 'running' THEN 0 WHEN status = 'pending' THEN 1 ELSE 2 END,
         COALESCE(completed_at, created_at) DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset]
    );

    // Get stats
    const statsResult = await query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) as count FROM agent_tasks GROUP BY status`
    );

    const stats: TaskStats = {
      total: 0,
      pending: 0,
      running: 0,
      done: 0,
      failed: 0,
    };

    for (const row of statsResult.rows) {
      const count = parseInt(row.count, 10);
      stats.total += count;
      if (row.status === 'pending') stats.pending = count;
      else if (row.status === 'running') stats.running = count;
      else if (row.status === 'done') stats.done = count;
      else if (row.status === 'failed') stats.failed = count;
    }

    const result: TasksListResult = {
      tasks: tasksResult.rows,
      stats,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('GET /api/tasks error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tasks' },
      { status: 500 }
    );
  }
}

// POST /api/tasks - Create new task
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      title,
      description,
      createdBy,
      assignedAgent,
      executingAgent,
      priority = 'normal',
      metadata,
    } = body;

    if (!title || !createdBy || !assignedAgent) {
      return NextResponse.json(
        { error: 'title, createdBy, and assignedAgent are required' },
        { status: 400 }
      );
    }

    const result = await query<AgentTask>(
      `INSERT INTO agent_tasks
       (title, description, created_by, assigned_agent, executing_agent, priority, metadata, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW())
       RETURNING *`,
      [
        title,
        description || null,
        createdBy,
        assignedAgent,
        executingAgent || null,
        priority,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error('POST /api/tasks error:', error);
    return NextResponse.json(
      { error: 'Failed to create task' },
      { status: 500 }
    );
  }
}
