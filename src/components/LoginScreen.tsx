'use client';

import { useState, useEffect, FormEvent } from 'react';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

interface LoginScreenProps {
  onLogin: () => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  // Check if biometric login is available
  useEffect(() => {
    checkBiometric();
  }, []);

  async function checkBiometric() {
    try {
      // Check if WebAuthn is supported
      if (!window.PublicKeyCredential) return;
      
      // Check if platform authenticator (Face ID / Touch ID) is available
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!available) return;

      // Check if we have registered credentials on server
      const res = await fetch('/api/auth/webauthn/login-options', { method: 'POST' });
      if (res.ok) {
        setBiometricAvailable(true);
      }
    } catch {
      // Not available
    }
  }

  // Face ID / Touch ID login
  async function handleBiometricLogin() {
    setBiometricLoading(true);
    setError('');

    try {
      // Get options from server
      const optRes = await fetch('/api/auth/webauthn/login-options', { method: 'POST' });
      if (!optRes.ok) throw new Error('Could not start biometric login');
      const options = await optRes.json();

      // Trigger Face ID / Touch ID
      const assertion = await startAuthentication({ optionsJSON: options });

      // Verify with server
      const verifyRes = await fetch('/api/auth/webauthn/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assertion),
      });

      if (verifyRes.ok) {
        onLogin();
      } else {
        setError('Biometric verification failed');
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        // User cancelled
        setError('');
      } else {
        setError('Biometric login failed');
        console.error('[Biometric]', err);
      }
    } finally {
      setBiometricLoading(false);
    }
  }

  // Auto-trigger Face ID on load if available
  useEffect(() => {
    if (biometricAvailable) {
      // Small delay so UI renders first
      const timer = setTimeout(() => handleBiometricLogin(), 500);
      return () => clearTimeout(timer);
    }
  }, [biometricAvailable]); // eslint-disable-line react-hooks/exhaustive-deps

  // Password login
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        // Check if biometric setup is possible and not yet done
        if (window.PublicKeyCredential) {
          const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
          if (available && !biometricAvailable) {
            setShowSetup(true);
            return;
          }
        }
        onLogin();
      } else {
        setError('Invalid password');
      }
    } catch {
      setError('Connection failed');
    } finally {
      setLoading(false);
    }
  }

  // Register Face ID after password login
  async function handleSetupBiometric() {
    setBiometricLoading(true);
    setError('');

    try {
      // Get registration options
      const optRes = await fetch('/api/auth/webauthn/register-options', { method: 'POST' });
      if (!optRes.ok) throw new Error('Failed to start registration');
      const options = await optRes.json();

      // Trigger Face ID enrollment
      const credential = await startRegistration({ optionsJSON: options });

      // Send to server
      const verifyRes = await fetch('/api/auth/webauthn/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credential),
      });

      if (verifyRes.ok) {
        onLogin();
      } else {
        setError('Registration failed');
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        // User cancelled, just proceed
        onLogin();
      } else {
        console.error('[Biometric setup]', err);
        onLogin(); // Still login, just without biometric
      }
    } finally {
      setBiometricLoading(false);
    }
  }

  // Face ID setup prompt after password login
  if (showSetup) {
    return (
      <div className="flex items-center justify-center h-full bg-[var(--bg-primary)]">
        <div className="w-full max-w-sm px-6 text-center">
          <div className="text-6xl mb-6">🔐</div>
          <h2 className="text-xl font-bold text-white mb-2">Enable Face ID?</h2>
          <p className="text-[var(--text-secondary)] text-sm mb-8">
            Log in faster with Face ID or Touch ID next time
          </p>

          <div className="space-y-3">
            <button
              onClick={handleSetupBiometric}
              disabled={biometricLoading}
              className="w-full py-3 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium rounded-xl transition-colors disabled:opacity-50"
            >
              {biometricLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Setting up...
                </span>
              ) : (
                'Enable Face ID'
              )}
            </button>

            <button
              onClick={() => onLogin()}
              className="w-full py-3 text-[var(--text-secondary)] hover:text-white text-sm transition-colors"
            >
              Skip for now
            </button>
          </div>

          {error && (
            <p className="text-[var(--error)] text-sm mt-4">{error}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-full bg-[var(--bg-primary)]">
      <div className="w-full max-w-sm px-6">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🐾</div>
          <h1 className="text-2xl font-bold text-white">OpenClaw Chat</h1>
          <p className="text-[var(--text-secondary)] mt-2 text-sm">
            Sign in to chat with your AI agents
          </p>
        </div>

        {/* Face ID button — shown prominently when available */}
        {biometricAvailable && (
          <div className="mb-6">
            <button
              onClick={handleBiometricLogin}
              disabled={biometricLoading}
              className="w-full py-4 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-white font-medium rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-3"
            >
              {biometricLoading ? (
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <>
                  {/* Face ID icon */}
                  <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M7 3H5a2 2 0 00-2 2v2" />
                    <path d="M17 3h2a2 2 0 012 2v2" />
                    <path d="M7 21H5a2 2 0 01-2-2v-2" />
                    <path d="M17 21h2a2 2 0 002-2v-2" />
                    <circle cx="9" cy="10" r="0.5" fill="currentColor" />
                    <circle cx="15" cy="10" r="0.5" fill="currentColor" />
                    <path d="M12 10v3h-1" />
                    <path d="M8 15c1 1.333 2.333 2 4 2s3-.667 4-2" />
                  </svg>
                  Sign in with Face ID
                </>
              )}
            </button>

            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px bg-[var(--border)]" />
              <span className="text-xs text-[var(--text-muted)]">or use password</span>
              <div className="flex-1 h-px bg-[var(--border)]" />
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full px-4 py-3 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-xl text-white placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              autoFocus={!biometricAvailable}
              disabled={loading}
            />
          </div>

          {error && (
            <p className="text-[var(--error)] text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-3 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Signing in...
              </span>
            ) : (
              'Sign In'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
