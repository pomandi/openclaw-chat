// WebAuthn credential storage (server-side)
import fs from 'node:fs';
import path from 'node:path';

const CRED_FILE = path.join(process.env.AGENTS_PATH || '/data/agents', '.webauthn-credentials.json');

export interface StoredCredential {
  credentialID: string; // base64url
  credentialPublicKey: string; // base64url
  counter: number;
  createdAt: number;
}

export function getStoredCredentials(): StoredCredential[] {
  try {
    if (fs.existsSync(CRED_FILE)) {
      return JSON.parse(fs.readFileSync(CRED_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

export function saveCredential(cred: StoredCredential) {
  const creds = getStoredCredentials();
  // Replace if same ID exists
  const idx = creds.findIndex(c => c.credentialID === cred.credentialID);
  if (idx >= 0) {
    creds[idx] = cred;
  } else {
    creds.push(cred);
  }
  fs.writeFileSync(CRED_FILE, JSON.stringify(creds, null, 2));
}

export function updateCredentialCounter(credentialID: string, newCounter: number) {
  const creds = getStoredCredentials();
  const cred = creds.find(c => c.credentialID === credentialID);
  if (cred) {
    cred.counter = newCounter;
    fs.writeFileSync(CRED_FILE, JSON.stringify(creds, null, 2));
  }
}

// In-memory challenge store (short-lived, fine for single user)
const challenges = new Map<string, { challenge: string; expires: number }>();

export function storeChallenge(sessionId: string, challenge: string) {
  // Clean expired
  const now = Date.now();
  for (const [k, v] of challenges) {
    if (v.expires < now) challenges.delete(k);
  }
  challenges.set(sessionId, { challenge, expires: now + 5 * 60 * 1000 }); // 5 min
}

export function getChallenge(sessionId: string): string | null {
  const entry = challenges.get(sessionId);
  if (!entry || entry.expires < Date.now()) {
    challenges.delete(sessionId);
    return null;
  }
  challenges.delete(sessionId);
  return entry.challenge;
}

// App config
export const RP_NAME = 'OpenClaw Chat';
export const RP_ID = process.env.WEBAUTHN_RP_ID || 'app.pomandi.com';
export const RP_ORIGIN = process.env.WEBAUTHN_ORIGIN || 'https://app.pomandi.com';
