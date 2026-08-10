import crypto from 'crypto';
import DeviceLinkRequest from '../models/DeviceLinkRequest.js';
import DeviceSession from '../models/DeviceSession.js';
import User from '../models/User.js';
import { generateToken, rememberMeExpiresIn } from '../utils/generateToken.js';
import { appBaseUrl, sendAppMail, shouldExposeEmailLinks } from '../utils/mail.js';
import { registerSession } from './sessionController.js';

const LINK_TTL_MS = 5 * 60 * 1000; // 5 minutes

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function generatePairingToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim().slice(0, 64);
  }
  return String(req.ip || req.socket?.remoteAddress || '').slice(0, 64);
}

function getIo(req) {
  return req.app.get('io') || null;
}

function safeDeviceInfo(body = {}) {
  const label =
    typeof body.deviceLabel === 'string' && body.deviceLabel.trim()
      ? body.deviceLabel.trim().slice(0, 200)
      : '';
  const userAgent =
    typeof body.deviceInfo?.userAgent === 'string'
      ? body.deviceInfo.userAgent.slice(0, 512)
      : typeof body.userAgent === 'string'
        ? body.userAgent.slice(0, 512)
        : '';
  const ip =
    typeof body.deviceInfo?.ip === 'string'
      ? body.deviceInfo.ip.slice(0, 64)
      : '';
  return { label, userAgent, ip };
}

async function findActiveLink(linkId, tokenHash) {
  const link = await DeviceLinkRequest.findOne({ linkId: String(linkId).trim() });
  if (!link) return { link: null, error: 'Link request not found', status: 404 };
  if (link.tokenHash !== tokenHash) {
    return { link: null, error: 'Invalid pairing token', status: 401 };
  }
  if (link.expiresAt <= new Date()) {
    if (link.status !== 'used' && link.status !== 'rejected') {
      link.status = 'expired';
      await link.save();
    }
    return { link: null, error: 'Pairing request expired', status: 410 };
  }
  return { link, error: null, status: null };
}

function emitToUser(io, userId, event, payload) {
  if (!io) return;
  io.to(String(userId)).emit(event, payload);
}

/** Authenticated device creates a new pairing request (QR payload source). */
export async function createLinkRequest(req, res) {
  try {
    const linkId = crypto.randomUUID();
    const token = generatePairingToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);

    await DeviceLinkRequest.create({
      user: req.user._id,
      linkId,
      tokenHash,
      status: 'pending',
      expiresAt,
    });

    res.json({
      success: true,
      data: {
        linkId,
        token,
        expiresAt: expiresAt.toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/** New device submits QR payload for verification (unauthenticated). */
export async function verifyLinkRequest(req, res) {
  try {
    const linkId = String(req.body?.linkId || '').trim();
    const token = String(req.body?.token || '').trim();
    if (!linkId || !token) {
      return res.status(400).json({ success: false, error: 'linkId and token are required' });
    }

    const { link, error, status } = await findActiveLink(linkId, hashToken(token));
    if (!link) {
      return res.status(status).json({ success: false, error });
    }

    if (!['pending', 'verified'].includes(link.status)) {
      return res.status(409).json({
        success: false,
        error: `Link request is ${link.status}`,
      });
    }

    const deviceInfo = safeDeviceInfo(req.body);
    if (!deviceInfo.label && deviceInfo.userAgent) {
      deviceInfo.label = deviceInfo.userAgent.slice(0, 120);
    }
    if (!deviceInfo.ip) {
      deviceInfo.ip = clientIp(req);
    }
    if (!deviceInfo.userAgent) {
      deviceInfo.userAgent = String(req.headers['user-agent'] || '').slice(0, 512);
    }

    link.status = 'verified';
    link.requestingDeviceInfo = deviceInfo;
    await link.save();

    const io = getIo(req);
    emitToUser(io, link.user, 'device:link-request', {
      linkId: link.linkId,
      deviceLabel: deviceInfo.label || 'Unknown device',
      userAgent: deviceInfo.userAgent,
      ip: deviceInfo.ip,
      status: link.status,
      expiresAt: link.expiresAt.toISOString(),
    });

    res.json({
      success: true,
      data: {
        linkId: link.linkId,
        status: link.status,
        expiresAt: link.expiresAt.toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/** Existing authenticated device approves the link request. */
export async function approveLinkRequest(req, res) {
  try {
    const linkId = String(req.body?.linkId || '').trim();
    if (!linkId) {
      return res.status(400).json({ success: false, error: 'linkId is required' });
    }

    const link = await DeviceLinkRequest.findOne({ linkId, user: req.user._id });
    if (!link) {
      return res.status(404).json({ success: false, error: 'Link request not found' });
    }
    if (link.expiresAt <= new Date()) {
      link.status = 'expired';
      await link.save();
      return res.status(410).json({ success: false, error: 'Pairing request expired' });
    }
    if (link.status !== 'verified') {
      return res.status(409).json({
        success: false,
        error: `Cannot approve link in status: ${link.status}`,
      });
    }

    const deviceLabel =
      link.requestingDeviceInfo?.label ||
      link.requestingDeviceInfo?.userAgent?.slice(0, 120) ||
      'Linked device';

    const fakeReq = {
      headers: { 'user-agent': link.requestingDeviceInfo?.userAgent || '' },
      ip: link.requestingDeviceInfo?.ip || '',
      socket: { remoteAddress: link.requestingDeviceInfo?.ip || '' },
    };
    const session = await registerSession(link.user, fakeReq, { deviceLabel });

    link.status = 'approved';
    link.approvedAt = new Date();
    link.linkedSessionId = session.sessionId;
    await link.save();

    const io = getIo(req);
    emitToUser(io, link.user, 'device:link-approved', {
      linkId: link.linkId,
      sessionId: session.sessionId,
      deviceLabel,
      status: link.status,
    });
    emitToUser(io, link.user, 'device:linked', {
      linkId: link.linkId,
      sessionId: session.sessionId,
      deviceLabel,
      userAgent: session.userAgent,
      createdAt: session.createdAt?.toISOString?.() || new Date().toISOString(),
    });

    res.json({
      success: true,
      data: {
        linkId: link.linkId,
        status: link.status,
        session: session.toJSON(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/** Existing authenticated device rejects the link request. */
export async function rejectLinkRequest(req, res) {
  try {
    const linkId = String(req.body?.linkId || '').trim();
    if (!linkId) {
      return res.status(400).json({ success: false, error: 'linkId is required' });
    }

    const link = await DeviceLinkRequest.findOne({ linkId, user: req.user._id });
    if (!link) {
      return res.status(404).json({ success: false, error: 'Link request not found' });
    }
    if (['used', 'rejected', 'expired'].includes(link.status)) {
      return res.status(409).json({
        success: false,
        error: `Link request is ${link.status}`,
      });
    }

    link.status = 'rejected';
    await link.save();

    const io = getIo(req);
    emitToUser(io, link.user, 'device:link-rejected', {
      linkId: link.linkId,
      status: link.status,
    });

    res.json({
      success: true,
      data: {
        linkId: link.linkId,
        status: link.status,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/** New device polls claim status or claims session credentials after approval. */
export async function linkStatusOrClaim(req, res) {
  try {
    const linkId = String(req.body?.linkId || '').trim();
    const token = String(req.body?.token || '').trim();
    if (!linkId || !token) {
      return res.status(400).json({ success: false, error: 'linkId and token are required' });
    }

    const { link, error, status } = await findActiveLink(linkId, hashToken(token));
    if (!link) {
      return res.status(status).json({ success: false, error });
    }

    if (link.status === 'pending') {
      return res.json({
        success: true,
        data: { linkId: link.linkId, status: link.status },
      });
    }

    if (link.status === 'verified') {
      return res.json({
        success: true,
        data: {
          linkId: link.linkId,
          status: link.status,
          deviceLabel: link.requestingDeviceInfo?.label || '',
        },
      });
    }

    if (link.status === 'rejected') {
      return res.status(403).json({
        success: false,
        error: 'Link request was rejected',
        data: { linkId: link.linkId, status: link.status },
      });
    }

    if (link.status === 'used') {
      return res.status(410).json({
        success: false,
        error: 'Pairing credentials already claimed',
        data: { linkId: link.linkId, status: link.status },
      });
    }

    if (link.status !== 'approved' || !link.linkedSessionId) {
      return res.status(409).json({
        success: false,
        error: `Link request is ${link.status}`,
      });
    }

    const session = await DeviceSession.findOne({
      user: link.user,
      sessionId: link.linkedSessionId,
      revokedAt: null,
    });
    if (!session) {
      return res.status(410).json({ success: false, error: 'Linked session no longer valid' });
    }

    const user = await User.findById(link.user);
    if (!user) {
      return res.status(410).json({ success: false, error: 'User not found' });
    }

    const expiresIn = rememberMeExpiresIn();
    const jwt = generateToken(user._id, { expiresIn, sessionId: session.sessionId });

    link.status = 'used';
    link.usedAt = new Date();
    await link.save();

    res.json({
      success: true,
      data: {
        status: 'used',
        token: jwt,
        user: user.toSelfJSON(),
        sessionId: session.sessionId,
        expiresIn,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/** Optional email pairing link sent to the authenticated user's email. */
export async function sendLinkEmail(req, res) {
  try {
    const linkId = String(req.body?.linkId || '').trim();
    const token = String(req.body?.token || '').trim();
    if (!linkId || !token) {
      return res.status(400).json({ success: false, error: 'linkId and token are required' });
    }

    const link = await DeviceLinkRequest.findOne({
      linkId,
      user: req.user._id,
      tokenHash: hashToken(token),
    });
    if (!link) {
      return res.status(404).json({ success: false, error: 'Link request not found' });
    }
    if (link.expiresAt <= new Date()) {
      link.status = 'expired';
      await link.save();
      return res.status(410).json({ success: false, error: 'Pairing request expired' });
    }
    if (!['pending', 'verified'].includes(link.status)) {
      return res.status(409).json({
        success: false,
        error: `Link request is ${link.status}`,
      });
    }

    const pairUrl = `${appBaseUrl()}/link-device?linkId=${encodeURIComponent(linkId)}&token=${encodeURIComponent(token)}`;
    await sendAppMail({
      to: req.user.email,
      subject: 'Link a device to QuantumChat',
      text: `Link a new device to your QuantumChat account.\n\nOpen this link on the device you want to link (expires in 5 minutes):\n${pairUrl}\n\nIf you did not request this, ignore this email.`,
    });

    const data = { message: 'Pairing link sent to your email' };
    if (shouldExposeEmailLinks()) {
      data.pairUrl = pairUrl;
    }
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
