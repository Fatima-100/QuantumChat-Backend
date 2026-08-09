// Known Quantum product frontends, merged with CLIENT_URL / CORS_ORIGINS.
// Shared by app.js (browser CORS gate) and attachmentController.js, which
// tells Google which Origin to bind a Drive resumable-upload session to.
export const allowedOrigins = [
  ...new Set([
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'https://chat.quantumlogicslimited.com',
    'https://ai.quantumlogicslimited.com',
    'https://quantum-chat.vercel.app',
    'https://quantum-chat-frontend.vercel.app',
    'https://quantum-chat-frontend-mu.vercel.app',
    'https://quantum-ai-frontend.vercel.app',
    ...String(process.env.CLIENT_URL || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    ...String(process.env.CORS_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ]),
];
