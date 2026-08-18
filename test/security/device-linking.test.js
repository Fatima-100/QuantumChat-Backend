import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { io as ioClient } from 'socket.io-client';
import { startTestServer, registerUser, login } from '../helpers/testServer.js';
import { authHeaders } from '../helpers/attacks.js';
import DeviceLinkRequest from '../../src/models/DeviceLinkRequest.js';

let ctx;
let alice;
let bob;

function waitForSocketEvent(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

before(async () => {
  ctx = await startTestServer({ withSockets: true });
  alice = await registerUser(ctx.base, `alice_link_${Date.now()}`);
  bob = await registerUser(ctx.base, `bob_link_${Date.now()}`);
});

after(async () => {
  await ctx.stop();
});

test('authenticated user can create pairing request', async () => {
  const loginRes = await login(ctx.base, alice.user.email, alice.password);
  assert.ok(loginRes.token);
  assert.ok(loginRes.sessionId);

  const res = await fetch(`${ctx.base}/users/me/sessions/link`, {
    method: 'POST',
    headers: authHeaders(loginRes.token),
  }).then((r) => r.json());

  assert.equal(res.success, true);
  assert.ok(res.data.linkId);
  assert.ok(res.data.token);
  assert.ok(res.data.expiresAt);

  const stored = await DeviceLinkRequest.findOne({ linkId: res.data.linkId });
  assert.ok(stored);
  assert.equal(stored.tokenHash, crypto.createHash('sha256').update(res.data.token).digest('hex'));
  assert.notEqual(stored.tokenHash, res.data.token);
});

test('unauthenticated user cannot create pairing request', async () => {
  const res = await fetch(`${ctx.base}/users/me/sessions/link`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('invalid pairing token is rejected on verify', async () => {
  const loginRes = await login(ctx.base, alice.user.email, alice.password);
  const created = await fetch(`${ctx.base}/users/me/sessions/link`, {
    method: 'POST',
    headers: authHeaders(loginRes.token),
  }).then((r) => r.json());

  const res = await fetch(`${ctx.base}/users/sessions/link/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      linkId: created.data.linkId,
      token: 'wrong-token',
      deviceLabel: 'Chrome on Windows',
    }),
  });
  assert.equal(res.status, 401);
});

test('new device can verify a valid QR and owner receives socket event', async () => {
  const loginRes = await login(ctx.base, alice.user.email, alice.password);
  const created = await fetch(`${ctx.base}/users/me/sessions/link`, {
    method: 'POST',
    headers: authHeaders(loginRes.token),
  }).then((r) => r.json());

  const socket = ioClient(ctx.origin, {
    auth: { token: loginRes.token },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket connect timeout')), 5000);
  });

  const eventPromise = waitForSocketEvent(socket, 'device:link-request');
  const verifyRes = await fetch(`${ctx.base}/users/sessions/link/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      linkId: created.data.linkId,
      token: created.data.token,
      deviceLabel: 'Chrome on Windows',
      deviceInfo: { userAgent: 'Mozilla/5.0 Chrome' },
    }),
  }).then((r) => r.json());

  assert.equal(verifyRes.success, true);
  assert.equal(verifyRes.data.status, 'verified');

  const event = await eventPromise;
  assert.equal(event.linkId, created.data.linkId);
  assert.equal(event.deviceLabel, 'Chrome on Windows');
  assert.ok(!event.token);
  socket.close();
});

test('approval creates separate session and linked device can claim credentials', async () => {
  const deviceA = await login(ctx.base, bob.user.email, bob.password);
  const created = await fetch(`${ctx.base}/users/me/sessions/link`, {
    method: 'POST',
    headers: authHeaders(deviceA.token),
  }).then((r) => r.json());

  await fetch(`${ctx.base}/users/sessions/link/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      linkId: created.data.linkId,
      token: created.data.token,
      deviceLabel: 'Safari on macOS',
    }),
  });

  const approveRes = await fetch(`${ctx.base}/users/me/sessions/link/approve`, {
    method: 'POST',
    headers: authHeaders(deviceA.token),
    body: JSON.stringify({ linkId: created.data.linkId }),
  }).then((r) => r.json());

  assert.equal(approveRes.success, true);
  assert.ok(approveRes.data.session.sessionId);
  assert.notEqual(approveRes.data.session.sessionId, deviceA.sessionId);

  const claimRes = await fetch(`${ctx.base}/users/sessions/link/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      linkId: created.data.linkId,
      token: created.data.token,
    }),
  }).then((r) => r.json());

  assert.equal(claimRes.success, true);
  assert.ok(claimRes.data.token);
  assert.ok(claimRes.data.sessionId);
  assert.equal(claimRes.data.sessionId, approveRes.data.session.sessionId);
  assert.equal(claimRes.data.user.id, bob.user.id);

  const reuse = await fetch(`${ctx.base}/users/sessions/link/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      linkId: created.data.linkId,
      token: created.data.token,
    }),
  });
  assert.equal(reuse.status, 410);
});

test('user can list devices and revoke another session', async () => {
  const deviceA = await login(ctx.base, alice.user.email, alice.password);
  const created = await fetch(`${ctx.base}/users/me/sessions/link`, {
    method: 'POST',
    headers: authHeaders(deviceA.token),
  }).then((r) => r.json());

  await fetch(`${ctx.base}/users/sessions/link/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      linkId: created.data.linkId,
      token: created.data.token,
      deviceLabel: 'Edge on Windows',
    }),
  });

  await fetch(`${ctx.base}/users/me/sessions/link/approve`, {
    method: 'POST',
    headers: authHeaders(deviceA.token),
    body: JSON.stringify({ linkId: created.data.linkId }),
  });

  const claimRes = await fetch(`${ctx.base}/users/sessions/link/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      linkId: created.data.linkId,
      token: created.data.token,
    }),
  }).then((r) => r.json());

  const listRes = await fetch(`${ctx.base}/users/me/sessions`, {
    headers: authHeaders(deviceA.token),
  }).then((r) => r.json());

  assert.ok(listRes.data.length >= 2);
  const current = listRes.data.find((s) => s.isCurrent);
  assert.ok(current);
  assert.equal(current.sessionId, deviceA.sessionId);

  const revokeRes = await fetch(`${ctx.base}/users/me/sessions/${claimRes.data.sessionId}`, {
    method: 'DELETE',
    headers: authHeaders(deviceA.token),
  }).then((r) => r.json());
  assert.equal(revokeRes.success, true);

  const blocked = await fetch(`${ctx.base}/users/me`, {
    headers: authHeaders(claimRes.data.token),
  });
  assert.equal(blocked.status, 401);

  const stillOk = await fetch(`${ctx.base}/users/me`, {
    headers: authHeaders(deviceA.token),
  });
  assert.equal(stillOk.status, 200);
});

test('user cannot revoke another users session', async () => {
  const aliceLogin = await login(ctx.base, alice.user.email, alice.password);
  const bobLogin = await login(ctx.base, bob.user.email, bob.password);

  const res = await fetch(`${ctx.base}/users/me/sessions/${bobLogin.sessionId}`, {
    method: 'DELETE',
    headers: authHeaders(aliceLogin.token),
  });
  assert.equal(res.status, 404);
});

test('reject prevents claim', async () => {
  const deviceA = await login(ctx.base, bob.user.email, bob.password);
  const created = await fetch(`${ctx.base}/users/me/sessions/link`, {
    method: 'POST',
    headers: authHeaders(deviceA.token),
  }).then((r) => r.json());

  await fetch(`${ctx.base}/users/sessions/link/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      linkId: created.data.linkId,
      token: created.data.token,
      deviceLabel: 'Firefox',
    }),
  });

  await fetch(`${ctx.base}/users/me/sessions/link/reject`, {
    method: 'POST',
    headers: authHeaders(deviceA.token),
    body: JSON.stringify({ linkId: created.data.linkId }),
  });

  const claim = await fetch(`${ctx.base}/users/sessions/link/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      linkId: created.data.linkId,
      token: created.data.token,
    }),
  });
  assert.equal(claim.status, 403);
});

test('existing login still works and includes sessionId', async () => {
  const res = await login(ctx.base, alice.user.email, alice.password);
  assert.equal(res.status, 200);
  assert.ok(res.sessionId);
  assert.ok(res.token);
});

test('API responses do not leak raw pairing token from database', async () => {
  const deviceA = await login(ctx.base, alice.user.email, alice.password);
  const created = await fetch(`${ctx.base}/users/me/sessions/link`, {
    method: 'POST',
    headers: authHeaders(deviceA.token),
  }).then((r) => r.json());

  const listRes = await fetch(`${ctx.base}/users/me/sessions`, {
    headers: authHeaders(deviceA.token),
  }).then((r) => r.text());
  assert.ok(!listRes.includes(created.data.token));

  const stored = await DeviceLinkRequest.findOne({ linkId: created.data.linkId });
  assert.notEqual(stored.tokenHash, created.data.token);
});
