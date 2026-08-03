export function conversationKey({ group, from, to }) {
  if (group) return `group:${group}`;
  const a = String(from);
  const b = String(to || '');
  return `dm:${[a, b].sort().join(':')}`;
}