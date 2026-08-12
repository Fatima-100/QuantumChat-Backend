import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, registerUser } from '../helpers/testServer.js';
import { authHeaders, fetchJson } from '../helpers/attacks.js';
import { sealForPublicKey } from '../../src/utils/sealedBox.js';

const RUN = `${Date.now()}`;
let ctx;
let userA;
let userB;
let userC;

before(async () => {
  ctx = await startTestServer();
  userA = await registerUser(ctx.base, `priv_${RUN}_a`);
  userB = await registerUser(ctx.base, `priv_${RUN}_b`);
  userC = await registerUser(ctx.base, `priv_${RUN}_c`);
});

after(async () => {
  await ctx.stop();
});

test('PATCH /users/me/privacy validates enum fields and updates partial settings', async () => {
  // Invalid enum
  const bad = await fetchJson(`${ctx.base}/users/me/privacy`, {
    method: 'PATCH',
    headers: authHeaders(userA.token),
    body: JSON.stringify({ lastSeen: 'invalid_value' }),
  });
  assert.equal(bad.status, 400);

  // Valid partial update
  const ok = await fetchJson(`${ctx.base}/users/me/privacy`, {
    method: 'PATCH',
    headers: authHeaders(userA.token),
    body: JSON.stringify({
      lastSeen: 'friends',
      readReceipts: 'nobody',
      whoCanMessage: 'friends',
      discoverable: 'nobody',
    }),
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.lastSeen, 'friends');
  assert.equal(ok.body.data.readReceipts, 'nobody');
  assert.equal(ok.body.data.whoCanMessage, 'friends');
  assert.equal(ok.body.data.discoverable, 'nobody');
});

test('whoCanMessage gate blocks messaging from unauthorized senders', async () => {
  // userA has whoCanMessage: 'friends'
  const pubKeyA = userA.user.publicKeys[0];
  const envA = sealForPublicKey('test msg', pubKeyA);

  // Non-friend userB tries to message userA -> expected 403
  const blocked = await fetchJson(`${ctx.base}/messages`, {
    method: 'POST',
    headers: authHeaders(userB.token),
    body: JSON.stringify({
      to: userA.user.id,
      forRecipient: envA,
      forSender: envA,
    }),
  });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body?.code, 'NOT_FRIENDS');
  assert.match(String(blocked.body?.error || ''), /accepting messages/i);

  // Add friend relationship between userA and userB
  const reqRes = await fetchJson(`${ctx.base}/users/friend-requests`, {
    method: 'POST',
    headers: authHeaders(userB.token),
    body: JSON.stringify({ to: userA.user.id }),
  });
  assert.equal(reqRes.status, 201);
  const reqId = reqRes.body.data.id;

  const acceptRes = await fetchJson(`${ctx.base}/users/friend-requests/${reqId}/accept`, {
    method: 'POST',
    headers: authHeaders(userA.token),
  });
  assert.equal(acceptRes.status, 200);

  // Now userB can message userA
  const allowed = await fetchJson(`${ctx.base}/messages`, {
    method: 'POST',
    headers: authHeaders(userB.token),
    body: JSON.stringify({
      to: userA.user.id,
      forRecipient: envA,
      forSender: envA,
    }),
  });
  assert.equal(allowed.status, 201);
});

test('discoverUsers excludes accounts set to discoverable: nobody', async () => {
  // userA has discoverable: 'nobody'
  const search = await fetchJson(`${ctx.base}/users/discover?q=priv_${RUN}_a`, {
    headers: authHeaders(userC.token),
  });
  assert.equal(search.status, 200);
  const found = (search.body.data || []).some((u) => String(u.id) === String(userA.user.id));
  assert.equal(found, false);
});

test('lastSeen is withheld from unauthorized viewers', async () => {
  // userA has lastSeen: 'friends'. userB is a friend, userC is not.
  const asC = await fetchJson(`${ctx.base}/users/${userA.user.id}`, {
    headers: authHeaders(userC.token),
  });
  assert.equal(asC.status, 200);
  assert.equal(asC.body.data.lastLoginAt, null);

  const asB = await fetchJson(`${ctx.base}/users/${userA.user.id}`, {
    headers: authHeaders(userB.token),
  });
  assert.equal(asB.status, 200);
  assert.ok('lastLoginAt' in asB.body.data);
});
