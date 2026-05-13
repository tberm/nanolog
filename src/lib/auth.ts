import forge from 'node-forge';

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWT_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

const CLIENT_EMAIL = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_EMAIL ?? '';
// EAS/env stores newlines as the two-character sequence \n; restore them for PEM parsing
const PRIVATE_KEY = (process.env.EXPO_PUBLIC_GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');

let cachedToken: { token: string; expiresAt: number } | null = null;

function base64url(binaryStr: string): string {
  return forge.util
    .encode64(binaryStr)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function encodeJsonPart(obj: object): string {
  // Encode as UTF-8 binary string then base64url
  return base64url(forge.util.encodeUtf8(JSON.stringify(obj)));
}

function buildJwt(now: number): string {
  const header = encodeJsonPart({ alg: 'RS256', typ: 'JWT' });
  const payload = encodeJsonPart({
    iss: CLIENT_EMAIL,
    scope: SCOPES,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  });

  const signingInput = `${header}.${payload}`;
  const privateKey = forge.pki.privateKeyFromPem(PRIVATE_KEY);
  const md = forge.md.sha256.create();
  md.update(signingInput, 'utf8');
  const signature = privateKey.sign(md);

  return `${signingInput}.${base64url(signature)}`;
}

async function fetchAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = buildJwt(now);

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent(JWT_GRANT)}&assertion=${jwt}`,
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description ?? 'Token fetch failed');
  return data.access_token;
}

export async function getAccessToken(): Promise<string> {
  const now = Date.now() / 1000;
  if (cachedToken && cachedToken.expiresAt - now > 300) {
    return cachedToken.token;
  }
  const token = await fetchAccessToken();
  cachedToken = { token, expiresAt: now + 3600 };
  return token;
}
