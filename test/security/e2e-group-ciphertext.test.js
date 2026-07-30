// [CRYPTO] Group sealed-message confidentiality E2E.
// 5 users in a group exchange sealed envelopes; outsiders and wrong keys
// must not recover SECRET markers.
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
import { generateKeySet, unsealMessage } from '../helpers/crypto.js';
import { assertNoPlaintextLeak, authHeaders, fetchJson } from '../helpers/attacks.js';

const RUN = `${Date.now()}`;
const SECRET = `SECRET_E2E_GROUP_${RUN}`;

let ctx;
let users = [];
let outsider;
let group;
let stored;

before(async () => {
  ctx = await startTestServer();
  for (let i = 0; i < 4; i += 1) {
    users.push(await registerUser(ctx.base, `gcrypto_${RUN}_u${i}`));
  }
  outsider = await registerUser(ctx.base, `gcrypto_${RUN}_out`);
  group = await createGroup(ctx.base, users[0].token, {
    name: `GroupCrypto ${RUN}`,
    memberIds: users.slice(1).map((u) => u.user.id),
  });

  const envelopes = await sealGroupEnvelopes(SECRET, users);
  const sent = await sendGroupMessage(ctx.base, users[0].token, group.id, envelopes);
  assert.ok([200, 201].includes(sent.status), `setup send failed: ${sent.body?.error}`);
  const messageId = sent.body.data.id || sent.body.data._id;
  stored = await mongoose.connection.db
    .collection('messages')
    .findOne({ _id: new mongoose.Types.ObjectId(messageId) });
  assert.ok(stored);
});

after(async () => {
  await ctx.stop();
});

test('[CRYPTO] control: each member opens their own group envelope', () => {
  for (const member of users) {
    const env = (stored.envelopes || []).find((e) => String(e.user) === String(member.user.id));
    assert.ok(env, `missing envelope for ${member.user.id}`);
    const key = member.keySet.find((k) => k.publicKey === env.targetPublicKey);
    assert.ok(key);
    assert.equal(unsealMessage(env, key.secretKey), SECRET);
  }
});

test('[CRYPTO] FAIL GATE: Mongo document must not contain group plaintext', () => {
  assertNoPlaintextLeak(stored, SECRET, 'group mongo doc');
});

test('[CRYPTO] FAIL GATE: outsider keys cannot open any member envelope', () => {
  for (const env of stored.envelopes || []) {
    for (const key of outsider.keySet) {
      assert.equal(unsealMessage(env, key.secretKey), null);
    }
  }
});

test('[CRYPTO] FAIL GATE: random keys cannot open group envelopes', () => {
  const rounds = Number(process.env.SECURITY_FUZZ_KEYS || 128);
  for (const env of stored.envelopes || []) {
    for (let i = 0; i < Math.min(rounds, 64); i += 1) {
      assert.equal(unsealMessage(env, generateKeySet(1)[0].secretKey), null);
    }
  }
});

test('[IDOR] outsider cannot list group messages or see plaintext via API', async () => {
  const { status, body } = await fetchJson(`${ctx.base}/groups/${group.id}/messages`, {
    headers: authHeaders(outsider.token),
  });
  assert.equal(status, 403);
  assertNoPlaintextLeak(body, SECRET, 'outsider API');
});

test('[CRYPTO] member API listing must not embed plaintext', async () => {
  const { status, body } = await fetchJson(`${ctx.base}/groups/${group.id}/messages`, {
    headers: authHeaders(users[1].token),
  });
  assert.equal(status, 200);
  assertNoPlaintextLeak(body, SECRET, 'member API listing');
});

test('[CRYPTO] FAIL GATE: private group rejects plaintext content body', async () => {
  const privateGroup = await createGroup(ctx.base, users[0].token, {
    name: `GroupPlainReject ${RUN}`,
    memberIds: users.slice(1).map((u) => u.user.id),
    visibility: 'private',
  });
  const { status, body } = await sendGroupMessage(ctx.base, users[0].token, privateGroup.id, null, {
    content: SECRET,
  });
  assert.equal(status, 400);
  assertNoPlaintextLeak(body, SECRET, 'private group plaintext reject');
});
