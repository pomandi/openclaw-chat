import { Pool, QueryResult, QueryResultRow } from 'pg';

// Singleton pool instance
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.TASKS_DATABASE_URL;
    if (!connectionString) {
      throw new Error('TASKS_DATABASE_URL environment variable is not set');
    }
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const client = getPool();
  return client.query<T>(text, params);
}

export interface AgentTask {
  id: number;
  title: string;
  description: string | null;
  status: 'pending' | 'running' | 'done' | 'failed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  created_by: string;
  assigned_agent: string;
  executing_agent: string | null;
  result: string | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface TaskStats {
  total: number;
  pending: number;
  running: number;
  done: number;
  failed: number;
}

export interface TasksListResult {
  tasks: AgentTask[];
  stats: TaskStats;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
