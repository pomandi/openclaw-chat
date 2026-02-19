import { NextRequest, NextResponse } from 'next/server';
import { query, AgentTask } from '@/lib/db';

type RouteParams = { params: Promise<{ id: string }> };

// PATCH /api/tasks/[id] - Update task
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const taskId = parseInt(id, 10);

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }

    const body = await request.json();
    const { status, result, error, metadata } = body;

    // Build SET clause dynamically
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);

      // Auto-set timestamps based on status
      if (status === 'running') {
        updates.push(`started_at = COALESCE(started_at, NOW())`);
      } else if (status === 'done' || status === 'failed') {
        updates.push(`completed_at = NOW()`);
      }
    }

    if (result !== undefined) {
      updates.push(`result = $${paramIndex++}`);
      values.push(result);
    }

    if (error !== undefined) {
      updates.push(`error = $${paramIndex++}`);
      values.push(error);
    }

    if (metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify(metadata));
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    values.push(taskId);

    const updateResult = await query<AgentTask>(
      `UPDATE agent_tasks SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    if (updateResult.rowCount === 0) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    return NextResponse.json(updateResult.rows[0]);
  } catch (err) {
    console.error('PATCH /api/tasks/[id] error:', err);
    return NextResponse.json(
      { error: 'Failed to update task' },
      { status: 500 }
    );
  }
}

// DELETE /api/tasks/[id] - Delete task
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const taskId = parseInt(id, 10);

    if (isNaN(taskId)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }

    const deleteResult = await query(
      `DELETE FROM agent_tasks WHERE id = $1`,
      [taskId]
    );

    if (deleteResult.rowCount === 0) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/tasks/[id] error:', err);
    return NextResponse.json(
      { error: 'Failed to delete task' },
      { status: 500 }
    );
  }
}
