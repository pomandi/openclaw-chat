// Push notification utilities (server-side)
import webpush from 'web-push';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || 'BGmEK_4zsZHsBDuCUvlyG5FF7kB3bP16-gxeio8yyxM9KGNLtGlVRwq_hes7KCBny9LIGI3YrEoaJC5OoWAbfQM';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'qmLt-pLMPE6CYSTiAPxzi4173adjS1RbVvnACP6AYig';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:info@pomandi.com';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// In-memory subscription store (persists across requests but not restarts)
// For production, use a database
const subscriptions = new Map<string, webpush.PushSubscription>();

export function addSubscription(id: string, subscription: webpush.PushSubscription) {
  subscriptions.set(id, subscription);
}

export function removeSubscription(id: string) {
  subscriptions.delete(id);
}

export function getSubscriptions(): webpush.PushSubscription[] {
  return Array.from(subscriptions.values());
}

export async function sendPushNotification(
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  const payload = JSON.stringify({
    title,
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: data || {},
  });

  const subs = getSubscriptions();
  const results = await Promise.allSettled(
    subs.map(sub => webpush.sendNotification(sub, payload))
  );

  // Remove invalid subscriptions
  let i = 0;
  const keys = Array.from(subscriptions.keys());
  for (const result of results) {
    if (result.status === 'rejected') {
      const err = result.reason;
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        subscriptions.delete(keys[i]);
      }
    }
    i++;
  }
}

export { VAPID_PUBLIC_KEY };
