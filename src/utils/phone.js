/**
 * Normalize phone for storage / lookup.
 * Keeps a leading +, strips other non-digits.
 */
export function normalizePhone(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const hasPlus = value.startsWith('+');
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  return hasPlus ? `+${digits}` : digits;
}

export function phoneLookupVariants(raw) {
  const norm = normalizePhone(raw);
  if (!norm) return [];
  const variants = new Set([norm]);
  if (norm.startsWith('+')) variants.add(norm.slice(1));
  else variants.add(`+${norm}`);
  return [...variants];
}

/** ReDoS-safe email shape check (no nested unbounded quantifiers). */
export function isEmailLike(raw) {
  const value = String(raw || '').trim();
  if (!value || value.length > 254) return false;
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@')) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!local || local.length > 64 || !domain || domain.length > 255) return false;
  if (local.includes(' ') || domain.includes(' ')) return false;
  const dot = domain.lastIndexOf('.');
  if (dot <= 0 || dot >= domain.length - 1) return false;
  return true;
}
