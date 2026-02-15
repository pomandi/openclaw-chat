import { NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { getStoredCredentials, storeChallenge, RP_ID } from '@/lib/webauthn';

export const dynamic = 'force-dynamic';

// POST /api/auth/webauthn/login-options
export async function POST() {
  const creds = getStoredCredentials();

  if (creds.length === 0) {
    return NextResponse.json({ error: 'No credentials registered' }, { status: 404 });
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'required',
    allowCredentials: creds.map(c => ({
      id: c.credentialID,
    })),
  });

  storeChallenge('login', options.challenge);

  return NextResponse.json(options);
}
