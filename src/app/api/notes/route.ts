import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { isAuthenticatedFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/notes - List all notes
export async function GET(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await query(
      'SELECT * FROM notes ORDER BY pinned DESC, updated_at DESC'
    );
    return NextResponse.json({ notes: result.rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/notes - Create a note
export async function POST(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { title, content, url, note_type, color, pinned, created_by, agent_id } = await req.json();
    
    const result = await query(
      `INSERT INTO notes (title, content, url, note_type, color, pinned, created_by, agent_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        title || '',
        content || '',
        url || null,
        note_type || 'text',
        color || 'default',
        pinned || false,
        created_by || 'user',
        agent_id || null,
      ]
    );
    return NextResponse.json({ note: result.rows[0] }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
