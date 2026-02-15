import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { getStoredCredentials, storeChallenge, RP_NAME, RP_ID } from '@/lib/webauthn';

export const dynamic = 'force-dynamic';

// POST /api/auth/webauthn/register-options
// Must be authenticated (password login first)
export async function POST(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Login first' }, { status: 401 });
  }

  const existingCreds = getStoredCredentials();

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: 'owner',
    userDisplayName: 'Owner',
    attestationType: 'none',
    authenticatorSelection: {
      authenticatorAttachment: 'platform', // Face ID / Touch ID only
      userVerification: 'required',
      residentKey: 'preferred',
    },
    excludeCredentials: existingCreds.map(c => ({
      id: c.credentialID,
    })),
  });

  // Store challenge for verification
  storeChallenge('register', options.challenge);

  return NextResponse.json(options);
}
