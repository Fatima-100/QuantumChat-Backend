/**
 * Build WebRTC ICE server list for call media.
 * STUN is always included. TURN is added only when TURN_* env is configured.
 * Do not log TURN_USERNAME / TURN_CREDENTIAL.
 */

const DEFAULT_STUN = [
  {
    urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'],
  },
];

function parseTurnUrls(raw) {
  return String(raw || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
}

/**
 * @returns {RTCIceServer[]}
 */
export function buildIceServers() {
  const iceServers = [...DEFAULT_STUN];

  const urls = parseTurnUrls(process.env.TURN_URLS);
  const username = String(process.env.TURN_USERNAME || '').trim();
  const credential = String(process.env.TURN_CREDENTIAL || '').trim();

  if (urls.length && username && credential) {
    iceServers.push({
      urls: urls.length === 1 ? urls[0] : urls,
      username,
      credential,
    });
  }

  return iceServers;
}

export function getCallIceConfig() {
  return {
    iceServers: buildIceServers(),
    turnConfigured: Boolean(
      parseTurnUrls(process.env.TURN_URLS).length &&
        String(process.env.TURN_USERNAME || '').trim() &&
        String(process.env.TURN_CREDENTIAL || '').trim()
    ),
  };
}
