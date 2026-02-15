// Simple password-based auth using cookies
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

const AUTH_COOKIE = 'openclaw-auth';
const APP_PASSWORD = process.env.APP_PASSWORD || 'openclaw2024';

function hashPassword(password: string): string {
  // Simple hash for cookie verification
  let hash = 0;
  const str = password + 'openclaw-salt-2024';
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

export function verifyPassword(password: string): boolean {
  return password === APP_PASSWORD;
}

export function getAuthToken(): string {
  return hashPassword(APP_PASSWORD);
}

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get(AUTH_COOKIE);
  return authCookie?.value === getAuthToken();
}

export function isAuthenticatedFromRequest(req: NextRequest): boolean {
  const authCookie = req.cookies.get(AUTH_COOKIE);
  return authCookie?.value === getAuthToken();
}

export { AUTH_COOKIE };
