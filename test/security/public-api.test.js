/**
 * /api/public/v1/* is the only surface authenticated by a static API key
 * instead of a per-user JWT — a partner QuantumLogics site's server hits it
 * directly, with no user session involved. These tests pin: valid keys can
 * push a message that the recipient can actually decrypt, invalid/revoked/
 * scope-less keys are rejected, unknown recipients 404, and a recipient who
 * has blocked the QuantumLogics system account is not messaged.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, registerUser } from '../helpers/testServer.js';
import { authHeaders } from '../helpers/attacks.js';
import { unsealMessage } from '../helpers/crypto.js';

const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let ctx;
let bob;
let ApiKey;
let User;
let generateApiKey;
let hashApiKey;
let ensureQuantumLogicsSystemUser;

async function createKey(name, scopes = ['messages:send']) {
  const key = generateApiKey();
  await ApiKey.create({ name, keyHash: hashApiKey(key), keyPrefix: key.slice(0, 12), scopes });
  return key;
}

async function sendSystemMessage(key, body) {
  const res = await fetch(`${ctx.base}/public/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'X-API-Key': key } : {}) },
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => ({}));
  return { status: res.status, body: parsed };
}

before(async () => {
  ctx = await startTestServer();
  bob = await registerUser(ctx.base, `pubapi_bob_${RUN_ID}`);

  ({ default: ApiKey } = await import('../../src/models/ApiKey.js'));
  ({ default: User } = await import('../../src/models/User.js'));
  ({ generateApiKey, hashApiKey } = await import('../../src/middleware/apiKeyAuth.js'));
  ({ ensureQuantumLogicsSystemUser } = await import('../../src/services/quantumLogicsSystemUser.js'));
});

after(async () => {
  await ctx.stop();
});

test('public API: rejects requests with no API key', async () => {
  const { status } = await sendSystemMessage(null, { username: bob.user.username, content: 'hi' });
  assert.equal(status, 401);
});

test('public API: rejects an unknown/garbage API key', async () => {
  const { status } = await sendSystemMessage('qlk_' + 'a'.repeat(64), {
    username: bob.user.username,
    content: 'hi',
  });
  assert.equal(status, 401);
});

test('public API: rejects a key that lacks the messages:send scope', async () => {
  const key = await createKey(`scopeless_${RUN_ID}`, []);
  const { status, body } = await sendSystemMessage(key, { username: bob.user.username, content: 'hi' });
  assert.equal(status, 403);
  assert.equal(body.success, false);
});

test('public API: a revoked key is rejected', async () => {
  const key = await createKey(`revoked_${RUN_ID}`);
  await ApiKey.updateOne({ keyHash: hashApiKey(key) }, { active: false, revokedAt: new Date() });
  const { status } = await sendSystemMessage(key, { username: bob.user.username, content: 'hi' });
  assert.equal(status, 401);
});

test('public API: 404s for a recipient that does not exist', async () => {
  const key = await createKey(`nouser_${RUN_ID}`);
  const { status } = await sendSystemMessage(key, { username: `nobody_${RUN_ID}`, content: 'hi' });
  assert.equal(status, 404);
});

test('public API: requires exactly one of userId/username/email', async () => {
  const key = await createKey(`noident_${RUN_ID}`);
  const { status } = await sendSystemMessage(key, { content: 'hi, missing recipient' });
  assert.equal(status, 400);
});

test('public API: a valid key delivers a message the recipient can decrypt', async () => {
  const key = await createKey(`partner_${RUN_ID}`);
  const plaintext = `hello from a partner site ${RUN_ID}`;
  const { status, body } = await sendSystemMessage(key, {
    username: bob.user.username,
    title: 'QuantumCommunity',
    content: plaintext,
  });
  assert.equal(status, 201);
  assert.equal(body.success, true);
  assert.equal(body.data.to, bob.user.id);

  const convo = await fetch(`${ctx.base}/messages/${(await ensureQuantumLogicsSystemUser())._id}`, {
    headers: authHeaders(bob.token),
  }).then((r) => r.json());
  assert.equal(convo.success, true);
  const delivered = convo.data.find((m) => String(m.id) === String(body.data.messageId));
  assert.ok(delivered, 'delivered message must appear in the recipient conversation');
  assert.equal(delivered.kind, 'system');

  const decrypted = unsealMessage(delivered.forRecipient, bob.keySet[0].secretKey);
  assert.equal(decrypted, `QuantumCommunity\n\n${plaintext}`);
});

test('public API: a recipient who blocked the QuantumLogics account is not messaged', async () => {
  const blocker = await registerUser(ctx.base, `pubapi_blocker_${RUN_ID}`);
  const sender = await ensureQuantumLogicsSystemUser();
  await User.updateOne({ _id: blocker.user.id }, { $addToSet: { blockedUsers: sender._id } });

  const key = await createKey(`blocked_${RUN_ID}`);
  const { status } = await sendSystemMessage(key, { username: blocker.user.username, content: 'hi' });
  assert.equal(status, 403);
});
