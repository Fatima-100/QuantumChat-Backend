import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import webpush from 'web-push';
import PushSubscription from '../models/PushSubscription.js';
import User from '../models/User.js';
import { toObjectId } from '../utils/toObjectId.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VAPID_FILE = path.resolve(__dirname, '../../data/vapid-keys.json');

let vapidPublicKey = null;
let pushReady = false;

function isWithinDoNotDisturb(dnd) {
  if (!dnd?.enabled) return false;
  const [startH, startM] = String(dnd.startTime || '22:00').split(':').map(Number);
  const [endH, endM] = String(dnd.endTime || '07:00').split(':').map(Number);
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  if (startMinutes === endMinutes) return true;
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function loadOrCreateVapidKeys() {
  let publicKey = process.env.VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@quantumchat.local';

  if (publicKey && privateKey) {
    return { publicKey, privateKey, subject, source: 'env' };
  }

  try {
    if (fs.existsSync(VAPID_FILE)) {
      const saved = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
      if (saved?.publicKey && saved?.privateKey) {
        return {
          publicKey: saved.publicKey,
          privateKey: saved.privateKey,
          subject: saved.subject || subject,
          source: 'file',
        };
      }
    }
  } catch (err) {
    console.warn('[push] Could not read saved VAPID keys:', err.message);
  }

  const generated = webpush.generateVAPIDKeys();
  try {
    fs.mkdirSync(path.dirname(VAPID_FILE), { recursive: true });
    fs.writeFileSync(
      VAPID_FILE,
      JSON.stringify(
        {
          publicKey: generated.publicKey,
          privateKey: generated.privateKey,
          subject,
          createdAt: new Date().toISOString(),
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
    console.warn(
      '[push] Generated and saved VAPID keys to backend/data/vapid-keys.json. ' +
        'For production, set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT in .env.'
    );
  } catch (err) {
    console.warn('[push] Could not persist VAPID keys:', err.message);
  }

  return {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject,
    source: 'generated',
  };
}

function initFromEnv() {
  if (vapidPublicKey !== null) return;

  const { publicKey, privateKey, subject } = loadOrCreateVapidKeys();

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidPublicKey = publicKey;
    pushReady = true;
  } catch (err) {
    console.warn('[push] Failed to initialize web-push:', err.message);
    vapidPublicKey = publicKey || '';
    pushReady = false;
  }
}

initFromEnv();

export function getVapidPublicKey() {
  initFromEnv();
  return vapidPublicKey || '';
}

export async function saveSubscription(userId, sub) {
  const endpoint = String(sub?.endpoint || '').trim();
  const p256dh = String(sub?.keys?.p256dh || '').trim();
  const auth = String(sub?.keys?.auth || '').trim();
  if (!endpoint || !p256dh || !auth) {
    const err = new Error('endpoint and keys.p256dh / keys.auth are required');
    err.status = 400;
    throw err;
  }

  await PushSubscription.findOneAndUpdate(
    { endpoint },
    {
      user: userId,
      endpoint,
      keys: { p256dh, auth },
      userAgent: String(sub?.userAgent || '').slice(0, 512),
      createdAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

export async function removeSubscription(userId, endpoint) {
  const ep = String(endpoint || '').trim();
  if (!ep) {
    const err = new Error('endpoint is required');
    err.status = 400;
    throw err;
  }
  await PushSubscription.deleteOne({ user: userId, endpoint: ep });
}

async function shouldSendPush(userId, payload) {
  const user = await User.findById(userId)
    .select('notificationSettings mutedChats')
    .lean();
  if (!user) return false;

  const ns = user.notificationSettings || {};
  if (ns.webNotifications?.enabled === false) return false;
  if (ns.priority === 'silent') return false;
  if (isWithinDoNotDisturb(ns.doNotDisturb)) return false;

  const kind = payload?.kind || 'dm';
  if (kind === 'dm' && ns.messageNotifications === 'direct_only') {
    // allowed
  }
  if (kind === 'group') {
    const mode = ns.groupNotifications || 'all';
    if (mode === 'off') return false;
    if ((mode === 'mentions_only' || mode === 'important_only') && !payload?.isMention) {
      return false;
    }
  }

  const convKey = payload?.conversationKey;
  if (convKey && Array.isArray(user.mutedChats)) {
    const now = Date.now();
    const muted = user.mutedChats.some((m) => {
      if (m.conversationKey !== convKey) return false;
      if (!m.expiresAt) return true;
      return new Date(m.expiresAt).getTime() > now;
    });
    if (muted) return false;
  }

  return true;
}

export async function notifyUser(userId, payload) {
  initFromEnv();
  if (!pushReady) return;

  const uid = toObjectId(userId);
  if (!uid) return;

  const allowed = await shouldSendPush(uid, payload).catch(() => true);
  if (!allowed) return;

  const subs = await PushSubscription.find({ user: uid });
  if (!subs.length) return;

  // E2E: never put message plaintext or ciphertext into push payloads.
  const title = String(payload?.title || 'QuantumChat').slice(0, 64);
  const bodyText = String(payload?.body || 'New notification').slice(0, 120);
  if (/SECRET_E2E_|ciphertext|forRecipient|v=0/i.test(`${title}\n${bodyText}`)) {
    console.warn('[push] blocked unsafe notification payload');
    return;
  }

  const silent = payload?.silent === true;
  const body = JSON.stringify({
    title,
    body: bodyText,
    icon: '/logo.png',
    badge: '/logo.png',
    tag: payload?.tag || 'quantumchat',
    silent,
    url: payload?.url || '/chat',
    data: { url: payload?.url || '/chat' },
  });

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.keys.p256dh,
              auth: sub.keys.auth,
            },
          },
          body
        );
      } catch (err) {
        const status = err?.statusCode || err?.status;
        if (status === 404 || status === 410) {
          await PushSubscription.deleteOne({ _id: sub._id }).catch(() => {});
        }
      }
    })
  );
}
