# Security checks before a pull request

Run the Security and Vulnerability Detection System locally:

```powershell
npm ci
npm run test:security
```

Lane shortcuts: `test:security:crypto`, `test:security:auth`, `test:security:api`, `test:security:abuse`, `test:security:socket`.

A failure is a merge blocker — treat it as a vulnerability detection, not a flaky test.

# QuantumChat — Backend

Express API for QuantumChat. Clients seal messages before upload; the backend stores ciphertext envelopes only (except the QuantumAI publish path, which seals server-side after HMAC verification).

Full architecture and crypto design: see the [root README](../README.md).

## Scripts

```bash
npm install
cp .env.example .env    # set MONGODB_URI and JWT_SECRET at minimum
npm run dev               # nodemon, local dev — persistent server + Socket.IO, http://localhost:5000
npm start                  # plain node, same entry point
npm test                   # full Node test discovery under test/
npm run test:security      # Security and Vulnerability Detection System
```

There is no build step — it's plain ESM Node, run directly.

## Project structure

```
server.js                  # local-dev entry point: connects DB, starts HTTP + Socket.IO server
api/index.js                 # Vercel serverless entry point — no Socket.IO, cached DB connection
vercel.json                   # rewrites all paths to api/index for Vercel deployment
src/
  app.js                     # createApp(): express instance, middleware, routes
  config/db.js
  models/
  controllers/
  routes/
  middleware/
    auth.js                  # requireAuth: JWT HS256
    upload.js
    rateLimiter.js           # authLimiter: 20 req/min on /api/auth/*
  socket/index.js            # JWT-authenticated Socket.IO (HS256 pinned)
test/security/               # Security and Vulnerability Detection System
test/helpers/                # server bootstrap + crypto + attack kit
security-canary/             # intentional failing canary (not part of npm test)
```

## Environment variables

| Variable             | Default                       | Description                                      |
| -------------------- | ----------------------------- | ------------------------------------------------ |
| `PORT`               | 5000                          | HTTP/Socket.IO port                              |
| `MONGODB_URI`        | —                             | **Required.** Mongo connection string            |
| `JWT_SECRET`         | —                             | **Required.** JWT signing secret                 |
| `JWT_EXPIRES_IN`     | 7d                            | Token lifetime                                   |
| `GOOGLE_DRIVE_FOLDER_ID` | —                          | **Required** (prod). Drive folder id             |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REFRESH_TOKEN` | — | Personal Google account auth (no Workspace needed) — see below |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` | —          | Service account auth — **requires a Workspace Shared Drive** |
| `CLIENT_URL`         | `http://localhost:5173`       | Comma-separated CORS allowlist                   |
| `SECURITY_FUZZ_KEYS` | `128` (PR) / `1000` (nightly) | Random-key samples in crypto fuzz tests          |

Blob storage is **Google Drive only** in production (no local `uploads/` directory). Two auth modes:

- **Personal Google account (recommended without Workspace):** OAuth2 delegated to your own account — uploads use that account's normal 15GB quota, and `GOOGLE_DRIVE_FOLDER_ID` is just a plain folder in your own My Drive. Run `node scripts/get-drive-oauth-token.mjs` once to obtain `GOOGLE_OAUTH_REFRESH_TOKEN` (see that file for the one-time Google Cloud Console setup).
- **Google Workspace:** a service account + a Shared Drive folder shared with it as Content manager. Service accounts have **no storage quota on regular My Drive**, so this mode fails with `storageQuotaExceeded` unless the folder is actually inside a Shared Drive.

## Testing — Security and Vulnerability Detection System

Ethical-hacking suites attack an ephemeral Express + MongoMemoryServer instance.

**Pass** = every attack rejected and controls still decrypt with the correct keys.  
**Fail** = vulnerability detected (do not merge).

| Category | Techniques | Primary files |
| -------- | ---------- | ------------- |
| CRYPTO | Chosen-ciphertext, wrong-key, E2E DM/group mesh, key fuzz | `e2e-ciphertext-confidentiality`, `e2e-group-ciphertext`, `crypto-fuzz`, `crypto-algorithms`, `randomness-integrity` |
| AUTH | JWT alg confusion, rate limit, QuantumAI reservation, login oracle | `auth-abuse`, `auth-rate-limit`, `socket-auth` |
| IDOR / PRIVILEGE | Group non-member access, admin escalation, stories/invite | `api-vuln-detection`, `stories-invite`, `server-attack-surface` |
| INJECTION | NoSQL operator banks | `api-vuln-detection`, `server-attack-surface` |
| UPLOAD | Path traversal | `input-hardening` |
| HEADERS / ABUSE | Helmet, CORS, body size limit | `transport-hardening` |
| STATIC | CodeQL + `npm audit --audit-level=high` | `security-l0-static.yml` |

### CI lanes (GitHub Actions)

| Lane | Job name | Command |
| ---- | -------- | ------- |
| L0 | Static Analysis | CodeQL + npm audit high |
| L1 | Crypto Confidentiality | `npm run test:security:crypto` |
| L2 | Auth Abuse | `npm run test:security:auth` |
| L3 | API Vuln Detection | `npm run test:security:api` |
| L4 | Transport Hardening | `npm run test:security:abuse` |
| Canary | Security Canary (must fail) | expects canary to fail |
| Nightly | Deep Fuzz and Stress | `SECURITY_FUZZ_KEYS=1000` |

See `.github/BRANCH_PROTECTION.md` for required checks.

## Deploying to Vercel

Static Vite build — Vercel's zero-config detection handles this natively, no `vercel.json` needed. Set `VITE_API_URL` in the project's Environment Variables to your deployed backend's URL. See the [root README](../README.md#deploying-to-vercel) for backend-side deployment notes (Socket.IO and attachments don't work the same way on a serverless backend).

## Community

- [Contributing](docs/CONTRIBUTING.md)
- [Code of Conduct](docs/CODE_OF_CONDUCT.md)
- [Security Policy](docs/SECURITY.md)
- [Support](docs/SUPPORT.md)
- [License (MIT)](LICENSE)
- [Docs index](docs/README.md)
