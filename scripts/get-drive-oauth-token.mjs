// One-time helper: obtains a Google OAuth2 refresh token delegated to your
// personal Google account, so Drive blob storage works without a Workspace
// Shared Drive (service accounts have no quota on regular My Drive folders).
//
// Prerequisites (Google Cloud Console, same project as your Drive folder):
//   1. APIs & Services > OAuth consent screen: add yourself as a test user
//      (External / Testing is fine — no verification needed for personal use).
//   2. APIs & Services > Credentials > Create Credentials > OAuth client ID
//      > Application type: "Desktop app". Copy the Client ID and Client Secret.
//
// Usage:
//   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... node scripts/get-drive-oauth-token.mjs
//
// It opens a local server, prints an authorization URL for you to open in a
// browser, and — after you sign in and approve — prints the refresh token to
// paste into backend/.env as GOOGLE_OAUTH_REFRESH_TOKEN.
import http from 'http';
import { google } from 'googleapis';

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET before running this script.');
  process.exit(1);
}

const PORT = 53682;
const redirectUri = `http://localhost:${PORT}`;
const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // force a refresh_token even if you've authorized this app before
  scope: ['https://www.googleapis.com/auth/drive'],
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end('Missing authorization code.');
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>Authorized.</h1>You can close this tab and go back to the terminal.');
  server.close();

  try {
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      console.error(
        '\nNo refresh_token returned. This usually means you already granted access before.\n' +
          'Revoke access at https://myaccount.google.com/permissions and re-run this script.'
      );
      process.exit(1);
    }
    console.log('\nSuccess. Add this to backend/.env:\n');
    console.log(`GOOGLE_OAUTH_CLIENT_ID=${clientId}`);
    console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${clientSecret}`);
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(
      '\nAlso set GOOGLE_DRIVE_FOLDER_ID to a folder in your own My Drive (no sharing needed) ' +
        'and remove GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY.'
    );
    process.exit(0);
  } catch (err) {
    console.error('\nToken exchange failed:', err.message);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log('Open this URL in a browser and sign in with the Google account that should own the uploads:\n');
  console.log(authUrl);
  console.log(`\nWaiting for the redirect on ${redirectUri} ...`);
});
