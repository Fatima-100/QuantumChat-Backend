/**
 * Future E2E encryption violation gates.
 * CI must fail if plaintext DMs, plaintext reactions, private-group plaintext,
 * unsealed attachments, vault private-key fields, or NoSQL friend ids are accepted.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  startTestServer,
  registerUser,
  createGroup,
  sendGroupMessage,
  sealGroupEnvelopes,
} from '../helpers/testServer.js';
import { sealMessage } from '../helpers/crypto.js';
import { assertNoPlaintextLeak, authHeaders, fetchJson, NOSQL_OPERATOR_PAYLOADS } from '../helpers/attacks.js';

const RUN = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const SECRET = `SECRET_E2E_VIOLATION_${RUN}`;

let ctx;
let alice;
let bob;
let carol;

before(async () => {
  ctx = await startTestServer();
  alice = await registerUser(ctx.base, `viol_a_${RUN}`);
  bob = await registerUser(ctx.base, `viol_b_${RUN}`);
  carol = await registerUser(ctx.base, `viol_c_${RUN}`);
});

after(async () => {
  if (ctx) await ctx.stop();
});

test('[VIOLATION] DM POST with plaintext content/text (no envelopes) is rejected', async () => {
  for (const body of [
    { to: bob.user.id, content: SECRET },
    { to: bob.user.id, text: SECRET },
    { to: bob.user.id, plaintext: SECRET },
    { to: bob.user.id, content: SECRET, text: SECRET },
  ]) {
    const { status, body: res } = await fetchJson(`${ctx.base}/messages`, {
      method: 'POST',
      headers: authHeaders(alice.token),
      body: JSON.stringify(body),
    });
    assert.equal(status, 400, `expected 400 for ${JSON.stringify(body)}`);
    assert.equal(res?.success, false);
    assertNoPlaintextLeak(res, SECRET, 'plaintext DM reject response');
  }
});

test('[VIOLATION] DM POST that mixes sealed envelopes with plaintext fields stores no plaintext', async () => {
  const forRecipient = sealMessage(SECRET, bob.keySet[0].publicKey);
  const forSender = sealMessage(SECRET, alice.keySet[0].publicKey);
  const { status, body } = await fetchJson(`${ctx.base}/messages`, {
    method: 'POST',
    headers: authHeaders(alice.token),
    body: JSON.stringify({
      to: bob.user.id,
      forRecipient,
      forSender,
      content: SECRET,
      text: SECRET,
      plaintext: SECRET,
    }),
  });
  assert.ok([200, 201].includes(status), body?.error);
  assert.equal(body.success, true);
  assertNoPlaintextLeak(body, SECRET, 'mixed DM API response');

  const id = body.data.id || body.data._id;
  const doc = await mongoose.connection.db
    .collection('messages')
    .findOne({ _id: new mongoose.Types.ObjectId(id) });
  assert.ok(doc);
  assertNoPlaintextLeak(doc, SECRET, 'mixed DM mongo doc');
  assert.equal(doc.content, undefined);
  assert.equal(doc.text, undefined);
  assert.equal(doc.plaintext, undefined);
});

test('[VIOLATION] reaction with plaintext emoji (no envelopes) is rejected', async () => {
  const forRecipient = sealMessage('hi', bob.keySet[0].publicKey);
  const forSender = sealMessage('hi', alice.keySet[0].publicKey);
  const sent = await fetchJson(`${ctx.base}/messages`, {
    method: 'POST',
    headers: authHeaders(alice.token),
    body: JSON.stringify({ to: bob.user.id, forRecipient, forSender }),
  });
  assert.equal(sent.body.success, true, sent.body.error);
  const messageId = sent.body.data.id || sent.body.data._id;

  const { status, body } = await fetchJson(`${ctx.base}/messages/${messageId}/reactions`, {
    method: 'POST',
    headers: authHeaders(bob.token),
    body: JSON.stringify({ emoji: '❤️', text: SECRET }),
  });
  assert.equal(status, 400);
  assert.equal(body?.success, false);

  const doc = await mongoose.connection.db
    .collection('messages')
    .findOne({ _id: new mongoose.Types.ObjectId(messageId) });
  assertNoPlaintextLeak(doc, SECRET, 'reaction mongo');
  assert.equal((doc.reactions || []).length, 0);
});

test('[VIOLATION] private group rejects plaintext content without envelopes', async () => {
  const group = await createGroup(ctx.base, alice.token, {
    name: `PrivateViol ${RUN}`,
    memberIds: [bob.user.id],
    visibility: 'private',
  });

  const { status, body } = await sendGroupMessage(ctx.base, alice.token, group.id, null, {
    content: SECRET,
  });
  assert.equal(status, 400);
  assert.equal(body?.success, false);
  assertNoPlaintextLeak(body, SECRET, 'private group plaintext reject');
});

test('[VIOLATION] private group sealed message never stores plaintext content field', async () => {
  const group = await createGroup(ctx.base, alice.token, {
    name: `PrivateSeal ${RUN}`,
    memberIds: [bob.user.id, carol.user.id],
    visibility: 'private',
  });
  const members = [alice, bob, carol];
  const envelopes = await sealGroupEnvelopes(SECRET, members);
  const sent = await sendGroupMessage(ctx.base, alice.token, group.id, envelopes, {
    content: SECRET,
    text: SECRET,
  });
  assert.ok([200, 201].includes(sent.status), sent.body?.error);
  const id = sent.body.data.id || sent.body.data._id;
  const doc = await mongoose.connection.db
    .collection('messages')
    .findOne({ _id: new mongoose.Types.ObjectId(id) });
  assert.ok(doc);
  assert.ok(Array.isArray(doc.envelopes) && doc.envelopes.length >= 2);
  assert.equal(doc.content, undefined);
  assertNoPlaintextLeak(doc, SECRET, 'private group mongo');
});

test('[CONTROL] public group intentionally stores plaintext content (not E2E)', async () => {
  const group = await createGroup(ctx.base, alice.token, {
    name: `PublicViol ${RUN}`,
    memberIds: [],
    visibility: 'public',
    joinPolicy: 'open',
  });
  // Ensure bob can post if needed — public open groups may only need creator
  const sent = await sendGroupMessage(ctx.base, alice.token, group.id, null, {
    content: SECRET,
  });
  assert.ok([200, 201].includes(sent.status), sent.body?.error);
  const id = sent.body.data.id || sent.body.data._id;
  const doc = await mongoose.connection.db
    .collection('messages')
    .findOne({ _id: new mongoose.Types.ObjectId(id) });
  assert.ok(doc);
  assert.equal(doc.content, SECRET);
  assert.equal(doc.envelopes == null || doc.envelopes.length === 0, true);
});

test('[VIOLATION] attachment upload without sealed headers is rejected', async () => {
  const { status, body } = await fetchJson(`${ctx.base}/attachments/init`, {
    method: 'POST',
    headers: authHeaders(alice.token),
    body: JSON.stringify({
      recipientId: bob.user.id,
      filename: 'leak.txt',
      mimetype: 'text/plain',
      size: Buffer.byteLength(SECRET),
    }),
  });
  assert.equal(status, 400);
  assert.equal(body.success, false);
  assert.match(String(body.error || ''), /nonce|ephemeralPublicKey|targetPublicKey/i);
});

test('[VIOLATION] vault PUT ignores secretKey/privateKey fields and never persists them', async () => {
  const { status, body } = await fetchJson(`${ctx.base}/users/me/vault`, {
    method: 'PUT',
    headers: authHeaders(alice.token),
    body: JSON.stringify({
      ciphertext: 'opaque-cipher',
      nonce: 'opaque-nonce',
      salt: 'opaque-salt',
      kdf: 'pbkdf2',
      secretKey: SECRET,
      privateKey: SECRET,
      secretKeys: [SECRET],
    }),
  });
  assert.ok([200, 201].includes(status), body?.error);
  assertNoPlaintextLeak(body, SECRET, 'vault API');

  const docs = await mongoose.connection.db.listCollections().toArray();
  const vaultCol = docs.map((d) => d.name).find((n) => /vault/i.test(n));
  assert.ok(vaultCol, `vault collection missing: ${docs.map((d) => d.name).join(',')}`);
  const doc = await mongoose.connection.db.collection(vaultCol).findOne({
    user: new mongoose.Types.ObjectId(alice.user.id),
  });
  assert.ok(doc, 'vault document missing');
  assertNoPlaintextLeak(doc, SECRET, 'vault mongo');
  assert.equal(doc.secretKey, undefined);
  assert.equal(doc.privateKey, undefined);
  assert.equal(doc.secretKeys, undefined);
});

test('[VIOLATION] friend request rejects NoSQL operator objects as `to`', async () => {
  for (const payload of NOSQL_OPERATOR_PAYLOADS.slice(0, 4)) {
    const { status, body } = await fetchJson(`${ctx.base}/users/friend-requests`, {
      method: 'POST',
      headers: authHeaders(alice.token),
      body: JSON.stringify({ to: payload }),
    });
    assert.ok([400, 404].includes(status), `payload ${JSON.stringify(payload)} => ${status}`);
    assert.equal(body?.success, false);
  }
});
