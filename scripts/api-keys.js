// Manage partner API keys for the /api/public/v1 integration surface.
//
// Usage:
//   node scripts/api-keys.js create "QuantumCommunity" [scope ...]
//     Prints the plaintext key ONCE — only its hash is stored, so save it now.
//     Default scope is messages:send if none are given.
//   node scripts/api-keys.js list
//   node scripts/api-keys.js revoke <keyId>
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import ApiKey from '../src/models/ApiKey.js';
import { generateApiKey, hashApiKey } from '../src/middleware/apiKeyAuth.js';

async function create(name, scopes) {
  if (!name) throw new Error('Usage: node scripts/api-keys.js create "<partner name>" [scope ...]');
  const key = generateApiKey();
  const record = await ApiKey.create({
    name,
    keyHash: hashApiKey(key),
    keyPrefix: key.slice(0, 12),
    scopes: scopes.length ? scopes : ['messages:send'],
  });
  console.log(`Created API key for "${name}" (id ${record._id})`);
  console.log(`Scopes: ${record.scopes.join(', ')}`);
  console.log('\nKey (shown once — store it now, it cannot be recovered):');
  console.log(key);
}

async function list() {
  const keys = await ApiKey.find().sort({ createdAt: -1 });
  if (!keys.length) {
    console.log('No API keys yet.');
    return;
  }
  for (const k of keys) {
    console.log(
      `${k._id}  ${k.active ? 'active ' : 'REVOKED'}  ${k.keyPrefix}...  ${k.name}  scopes=[${k.scopes.join(',')}]  lastUsed=${k.lastUsedAt ? k.lastUsedAt.toISOString() : 'never'}`
    );
  }
}

async function revoke(id) {
  if (!id) throw new Error('Usage: node scripts/api-keys.js revoke <keyId>');
  const record = await ApiKey.findByIdAndUpdate(id, { active: false, revokedAt: new Date() }, { new: true });
  if (!record) throw new Error(`No API key found with id ${id}`);
  console.log(`Revoked API key ${record._id} ("${record.name}")`);
}

async function main() {
  const [, , command, ...rest] = process.argv;
  await connectDB();

  if (command === 'create') await create(rest[0], rest.slice(1));
  else if (command === 'list') await list();
  else if (command === 'revoke') await revoke(rest[0]);
  else throw new Error('Usage: node scripts/api-keys.js <create|list|revoke> [args]');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
