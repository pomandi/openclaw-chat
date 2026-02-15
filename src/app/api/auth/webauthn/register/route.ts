import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticatedFromRequest } from '@/lib/auth';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { getChallenge, saveCredential, RP_ID, RP_ORIGIN } from '@/lib/webauthn';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

export const dynamic = 'force-dynamic';

function toBase64URL(input: any): string {
  if (typeof input === 'string') return input;
  return isoBase64URL.fromBuffer(input as Uint8Array<ArrayBuffer>);
}

// POST /api/auth/webauthn/register
export async function POST(req: NextRequest) {
  if (!isAuthenticatedFromRequest(req)) {
    return NextResponse.json({ error: 'Login first' }, { status: 401 });
  }

  const body = await req.json();
  const expectedChallenge = getChallenge('register');

  if (!expectedChallenge) {
    return NextResponse.json({ error: 'Challenge expired' }, { status: 400 });
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: 'Verification failed' }, { status: 400 });
    }

    const { credential } = verification.registrationInfo;

    saveCredential({
      credentialID: toBase64URL(credential.id as any),
      credentialPublicKey: toBase64URL(credential.publicKey as any),
      counter: credential.counter,
      createdAt: Date.now(),
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[WebAuthn] register error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
