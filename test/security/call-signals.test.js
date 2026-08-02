import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startTestServer, registerUser } from '../helpers/testServer.js';
import { authHeaders } from '../helpers/attacks.js';
import { sealMessage, unsealMessage } from '../helpers/crypto.js';

let ctx;
let alice;
let bob;

before(async () => {
  ctx = await startTestServer();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  alice = await registerUser(ctx.base, `call_alice_${suffix}`);
  bob = await registerUser(ctx.base, `call_bob_${suffix}`);
});

after(async () => {
  await ctx.stop();
});

test('REST call signaling relays only an X5 sealed envelope to its recipient', async () => {
  const callId = crypto.randomUUID();
  const plaintext = JSON.stringify({ type: 'invite', callId, video: true });
  const envelope = sealMessage(plaintext, bob.keySet[0].publicKey);

  const created = await fetch(`${ctx.base}/call-signals`, {
    method: 'POST',
    headers: authHeaders(alice.token),
    body: JSON.stringify({
      to: bob.user.id,
      callId,
      event: 'call:invite',
      envelope,
    }),
  });
  assert.equal(created.status, 201);

  const inbox = await fetch(
    `${ctx.base}/call-signals?after=${encodeURIComponent(new Date(Date.now() - 10_000).toISOString())}`,
    { headers: authHeaders(bob.token) }
  ).then((res) => res.json());

  assert.equal(inbox.success, true);
  const signal = inbox.data.signals.find((item) => item.callId === callId);
  assert.ok(signal);
  assert.equal(signal.event, 'call:invite');
  assert.equal(String(signal.from), String(alice.user.id));
  assert.equal(unsealMessage(signal.envelope, bob.keySet[0].secretKey), plaintext);
  assert.equal(JSON.stringify(signal).includes(plaintext), false);

  const aliceInbox = await fetch(
    `${ctx.base}/call-signals?after=${encodeURIComponent(new Date(Date.now() - 10_000).toISOString())}`,
    { headers: authHeaders(alice.token) }
  ).then((res) => res.json());
  assert.equal(aliceInbox.data.signals.some((item) => item.callId === callId), false);
});

test('REST call signaling rejects plaintext SDP and candidates', async () => {
  const response = await fetch(`${ctx.base}/call-signals`, {
    method: 'POST',
    headers: authHeaders(alice.token),
    body: JSON.stringify({
      to: bob.user.id,
      callId: crypto.randomUUID(),
      event: 'call:offer',
      sdp: { type: 'offer', sdp: 'v=0' },
    }),
  });
  assert.equal(response.status, 400);
});

test('REST meeting signaling relays only an X5 sealed envelope to its recipient (meetingId reuses the callId field)', async () => {
  const meetingId = crypto.randomUUID();
  const plaintext = JSON.stringify({ type: 'invite', callId: meetingId, video: true, groupId: 'g1' });
  const envelope = sealMessage(plaintext, bob.keySet[0].publicKey);

  const created = await fetch(`${ctx.base}/call-signals`, {
    method: 'POST',
    headers: authHeaders(alice.token),
    body: JSON.stringify({
      to: bob.user.id,
      callId: meetingId,
      event: 'meeting:invite',
      envelope,
    }),
  });
  assert.equal(created.status, 201);

  const inbox = await fetch(
    `${ctx.base}/call-signals?after=${encodeURIComponent(new Date(Date.now() - 10_000).toISOString())}`,
    { headers: authHeaders(bob.token) }
  ).then((res) => res.json());

  assert.equal(inbox.success, true);
  const signal = inbox.data.signals.find((item) => item.callId === meetingId);
  assert.ok(signal);
  assert.equal(signal.event, 'meeting:invite');
  assert.equal(unsealMessage(signal.envelope, bob.keySet[0].secretKey), plaintext);
});

test('REST call signaling still requires auth (limiter must not run before requireAuth)', async () => {
  const unauth = await fetch(`${ctx.base}/call-signals`, {
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(unauth.status, 401);
});

test('call signal budget is per-user, so one caller cannot exhaust another behind the same IP', async () => {
  // Both users share an IP in this test process. Alice burns a large number of
  // polls; Bob must still be served. With an IP-keyed limiter Bob would 429
  // here, which is what left calls stuck on "connecting" mid-ICE.
  const after = encodeURIComponent(new Date(Date.now() - 10_000).toISOString());

  // Dedicated user — exhausting alice here would 429 her in later tests.
  const heavy = await registerUser(ctx.base, `call_heavy_${Date.now()}`);

  // Deliberately blow past the whole window budget. Batched rather than one
  // big Promise.all — a few hundred simultaneous sockets exhausts the test
  // server's connection pool and fails the fetch itself.
  const statuses = [];
  for (let sent = 0; sent < 260; sent += 20) {
    const batch = await Promise.all(
      Array.from({ length: 20 }, () =>
        fetch(`${ctx.base}/call-signals?after=${after}`, { headers: authHeaders(heavy.token) })
      )
    );
    statuses.push(...batch.map((r) => r.status));
  }
  assert.ok(
    statuses.some((s) => s === 429),
    'the heavy user should exhaust their own budget (otherwise this test proves nothing)'
  );

  // Bob shares alice's IP but has his own budget, so he must still be served.
  const bobRes = await fetch(`${ctx.base}/call-signals?after=${after}`, {
    headers: authHeaders(bob.token),
  });
  assert.equal(bobRes.status, 200, 'bob must not be rate limited by alice traffic');
});

test('REST call signaling rejects unknown event names', async () => {
  const response = await fetch(`${ctx.base}/call-signals`, {
    method: 'POST',
    headers: authHeaders(alice.token),
    body: JSON.stringify({
      to: bob.user.id,
      callId: crypto.randomUUID(),
      event: 'meeting:not-a-real-event',
      envelope: sealMessage(JSON.stringify({ type: 'invite' }), bob.keySet[0].publicKey),
    }),
  });
  assert.equal(response.status, 400);
});
