import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { getChallenge, getStoredCredentials, updateCredentialCounter, RP_ID, RP_ORIGIN } from '@/lib/webauthn';
import { getAuthToken, AUTH_COOKIE } from '@/lib/auth';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

export const dynamic = 'force-dynamic';

// POST /api/auth/webauthn/login
export async function POST(req: NextRequest) {
  const body = await req.json();
  const expectedChallenge = getChallenge('login');

  if (!expectedChallenge) {
    return NextResponse.json({ error: 'Challenge expired' }, { status: 400 });
  }

  const creds = getStoredCredentials();
  const credentialID = body.id;
  const matchingCred = creds.find(c => c.credentialID === credentialID);

  if (!matchingCred) {
    return NextResponse.json({ error: 'Unknown credential' }, { status: 400 });
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: matchingCred.credentialID,
        publicKey: isoBase64URL.toBuffer(matchingCred.credentialPublicKey),
        counter: matchingCred.counter,
      },
    });

    if (!verification.verified) {
      return NextResponse.json({ error: 'Verification failed' }, { status: 401 });
    }

    // Update counter
    updateCredentialCounter(matchingCred.credentialID, verification.authenticationInfo.newCounter);

    // Set auth cookie (same as password login)
    const response = NextResponse.json({ ok: true });
    response.cookies.set(AUTH_COOKIE, getAuthToken(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    });

    return response;
  } catch (err: any) {
    console.error('[WebAuthn] login error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
