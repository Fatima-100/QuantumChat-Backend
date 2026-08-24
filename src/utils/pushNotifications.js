import client from '../api/client.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

/**
 * Request notification permission, register the service worker,
 * subscribe with the server VAPID key, and POST the subscription.
 *
 * Always resolves to { permission, push, error? } — never throws — since
 * every caller in SettingsModal.jsx reads `.permission`/`.push` off the
 * return value directly with no try/catch.
 */
export async function enablePushNotifications() {
  if (typeof window === 'undefined') {
    return { permission: 'unsupported', push: false };
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return {
      permission: 'unsupported',
      push: false,
      error: 'Push notifications are not supported in this browser',
    };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { permission, push: false };
    }

    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const vapidRes = await client.get('/users/me/push/vapid-public-key');
    const publicKey = vapidRes?.data?.data?.publicKey;
    if (!publicKey) {
      return { permission, push: false, error: 'Could not reach the notification server' };
    }

    // Always start clean rather than trusting a cached subscription. A
    // subscription created against a previous VAPID keypair (e.g. after a
    // server restart with rotated/newly-configured keys) still LOOKS valid
    // to the browser — getSubscription() happily returns it — but every
    // push to it fails server-side with HTTP 403 forever, silently, since
    // the browser has no way to know the server's key changed. Since the
    // user just explicitly clicked "Enable", it's safe and cheap to
    // unsubscribe and re-subscribe fresh against whatever key is current.
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      await existing.unsubscribe().catch(() => {});
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const json = subscription.toJSON();
    await client.post('/users/me/push/subscribe', {
      endpoint: json.endpoint,
      keys: json.keys,
    });

    return { permission, push: true };
  } catch (err) {
    return {
      permission: getNotificationPermission(),
      push: false,
      error: err?.response?.data?.error || err?.message || 'Failed to enable notifications',
    };
  }
}
/**
 * Current browser notification permission, without prompting the user.
 * Returns 'granted' | 'denied' | 'default' | 'unsupported'.
 */
export function getNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

/**
 * Unsubscribe this browser from push, both locally and on the server.
 * Safe to call even if there was never an active subscription.
 */
export async function disablePushNotifications() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    const registration = await navigator.serviceWorker.getRegistration('/sw.js');
    if (!registration) return;

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    const endpoint = subscription.endpoint;

    // Tell the server first — if this fails, the browser subscription is
    // still removed below, but a stray server-side record is easier to
    // clean up than a client that silently keeps pushing after "disable".
    await client.delete('/users/me/push/subscribe', { data: { endpoint } }).catch(() => {
      // Non-fatal — proceed to unsubscribe locally regardless.
    });

    await subscription.unsubscribe();
  } catch {
    // Nothing meaningful to recover here — disabling push should never
    // throw and block the rest of the Settings save/UI flow.
  }
}
