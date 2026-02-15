'use client';

import { useEffect, useState, useCallback } from 'react';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || 'BGmEK_4zsZHsBDuCUvlyG5FF7kB3bP16-gxeio8yyxM9KGNLtGlVRwq_hes7KCBny9LIGI3YrEoaJC5OoWAbfQM';

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer as ArrayBuffer;
}

export default function PWARegister() {
  const [showNotifBanner, setShowNotifBanner] = useState(false);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [notifPermission, setNotifPermission] = useState<string>('default');

  // Register service worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('[SW] Registered:', reg.scope);
        })
        .catch((err) => {
          console.error('[SW] Registration failed:', err);
        });
    }
  }, []);

  // Check notification permission
  useEffect(() => {
    if ('Notification' in window) {
      setNotifPermission(Notification.permission);
      if (Notification.permission === 'default') {
        // Show banner after 5 seconds
        const timer = setTimeout(() => setShowNotifBanner(true), 5000);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  // Listen for install prompt
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Show install banner if not in standalone mode
      if (!window.matchMedia('(display-mode: standalone)').matches) {
        setShowInstallBanner(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Subscribe to push notifications
  const subscribeToPush = useCallback(async () => {
    try {
      const permission = await Notification.requestPermission();
      setNotifPermission(permission);
      setShowNotifBanner(false);

      if (permission !== 'granted') return;

      const registration = await navigator.serviceWorker.ready;
      
      // Check if already subscribed
      let subscription = await registration.pushManager.getSubscription();
      
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      // Send subscription to server
      const subId = `push_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: subId, subscription: subscription.toJSON() }),
      });

      console.log('[Push] Subscribed successfully');
    } catch (err) {
      console.error('[Push] Subscription failed:', err);
    }
  }, []);

  // Handle install prompt
  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    console.log('[PWA] Install result:', result.outcome);
    setDeferredPrompt(null);
    setShowInstallBanner(false);
  }, [deferredPrompt]);

  return (
    <>
      {/* Notification permission banner */}
      {showNotifBanner && notifPermission === 'default' && (
        <div className="fixed top-0 left-0 right-0 z-[100] safe-top">
          <div className="mx-4 mt-4 md:mx-auto md:max-w-md p-4 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl shadow-xl animate-slide-down">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-[var(--accent)]/20 rounded-full flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-medium text-white">Enable Notifications</h3>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Get notified when your agents reply
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setShowNotifBanner(false)}
                className="flex-1 py-2 text-sm text-[var(--text-secondary)] hover:text-white rounded-lg transition-colors"
              >
                Not now
              </button>
              <button
                onClick={subscribeToPush}
                className="flex-1 py-2 text-sm bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg transition-colors font-medium"
              >
                Enable
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Install PWA banner */}
      {showInstallBanner && deferredPrompt && (
        <div className="fixed bottom-20 left-0 right-0 z-[100] safe-bottom">
          <div className="mx-4 md:mx-auto md:max-w-md p-4 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl shadow-xl animate-slide-up">
            <div className="flex items-center gap-3">
              <img src="/icon-192.png" alt="OpenClaw" className="w-12 h-12 rounded-xl" />
              <div className="flex-1">
                <h3 className="text-sm font-medium text-white">Install OpenClaw</h3>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Add to your home screen for the best experience
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setShowInstallBanner(false)}
                className="flex-1 py-2 text-sm text-[var(--text-secondary)] hover:text-white rounded-lg transition-colors"
              >
                Later
              </button>
              <button
                onClick={handleInstall}
                className="flex-1 py-2 text-sm bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg transition-colors font-medium"
              >
                Install
              </button>
            </div>
          </div>
        </div>
      )}

      {/* iOS install hint (shown on Safari iOS when not standalone) */}
      <IOSInstallHint />
    </>
  );
}

function IOSInstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Check if iOS Safari and not in standalone mode
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as any).standalone === true;
    const dismissed = localStorage.getItem('ios-install-dismissed');

    if (isIOS && !isStandalone && !dismissed) {
      const timer = setTimeout(() => setShow(true), 10000);
      return () => clearTimeout(timer);
    }
  }, []);

  if (!show) return null;

  return (
    <div className="fixed bottom-6 left-0 right-0 z-[100] safe-bottom">
      <div className="mx-4 md:mx-auto md:max-w-sm p-4 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl shadow-xl animate-slide-up">
        <div className="flex items-start gap-3">
          <img src="/icon-192.png" alt="" className="w-10 h-10 rounded-xl" />
          <div className="flex-1">
            <h3 className="text-sm font-medium text-white">Install OpenClaw</h3>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Tap <span className="inline-flex items-center"><svg className="w-4 h-4 mx-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M16 5l-1.42 1.42-1.59-1.59V16h-1.98V4.83L9.42 6.42 8 5l4-4 4 4zm4 5v11c0 1.1-.9 2-2 2H6c-1.11 0-2-.9-2-2V10c0-1.11.89-2 2-2h3v2H6v11h12V10h-3V8h3c1.1 0 2 .89 2 2z"/></svg></span> then <strong>&quot;Add to Home Screen&quot;</strong>
            </p>
          </div>
          <button
            onClick={() => {
              setShow(false);
              localStorage.setItem('ios-install-dismissed', '1');
            }}
            className="text-[var(--text-muted)] hover:text-white p-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
