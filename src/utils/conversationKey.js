export function conversationKey({ group, from, to }) {
  if (group) return `group:${group}`;
  const a = String(from);
  const b = String(to || '');
  return `dm:${[a, b].sort().join(':')}`;
}

/**
 * Given a user's `clearedConversations` array and a conversationKey, return the
 * Date the conversation was last cleared for that user, or null if never.
 */
export function clearedAtFor(clearedConversations, key) {
  if (!Array.isArray(clearedConversations) || !key) return null;
  const entry = clearedConversations.find((c) => c && c.conversationKey === key);
  return entry && entry.clearedAt ? new Date(entry.clearedAt) : null;
}

/**
 * Parse a conversationKey back into its parts:
 *   "group:<id>"    -> { group: '<id>' }
 *   "dm:<idA>:<idB>" -> { dm: ['<idA>', '<idB>'] }
 * Returns null for anything malformed.
 */
export function parseConversationKey(key) {
  if (typeof key !== 'string') return null;
  if (key.startsWith('group:')) {
    const id = key.slice('group:'.length);
    return id ? { group: id } : null;
  }
  if (key.startsWith('dm:')) {
    const ids = key.slice('dm:'.length).split(':');
    if (ids.length !== 2 || !ids[0] || !ids[1]) return null;
    return { dm: ids };
  }
  return null;
}
