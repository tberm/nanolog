# Technical Plan

## Stack

- **Framework**: Expo (React Native), bare or managed workflow
- **Language**: TypeScript
- **Navigation**: Expo Router (file-based)
- **HTTP**: native `fetch`
- **JWT signing**: `jose` library (WebCrypto-based, works in Hermes/React Native)

---

## Authentication

### Overview

The app uses a **Google Service Account** rather than OAuth user sign-in. A Service Account is a non-human Google identity that can be granted access to specific resources. Because we own both the app and the spreadsheet, we grant the service account editor access to the sheet directly, and the app authenticates as that service account automatically — no login screen, no user interaction required.

### How Service Account Auth Works

Google's API access requires a short-lived OAuth 2.0 **access token** (valid for 1 hour). For a service account, the app earns this token by presenting a **self-signed JWT** — a signed assertion that proves the app holds the service account's private key. Google verifies the signature and issues the access token.

The full flow:

```
App                                    Google OAuth
 |                                          |
 |-- build JWT (claims + RS256 sig) ------->|
 |<-- { access_token, expires_in } ---------|
 |                                          |
 |-- GET/POST Sheets API (Bearer token) --> Google Sheets API
```

### Service Account JSON Key

When you create a service account key in the Google Cloud Console, Google provides a JSON file with this structure:

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "key-id-hex",
  "private_key": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n",
  "client_email": "nanolog@your-project-id.iam.gserviceaccount.com",
  "client_id": "123456789",
  "token_uri": "https://oauth2.googleapis.com/token"
}
```

The two fields the app actually needs are `client_email` and `private_key`.

### Step 1 — Build the JWT

The signed JWT has three parts: header, claims payload, and signature — all base64url-encoded and joined with dots.

**Header:**
```json
{ "alg": "RS256", "typ": "JWT" }
```

**Claims payload:**
```json
{
  "iss": "nanolog@your-project-id.iam.gserviceaccount.com",
  "scope": "https://www.googleapis.com/auth/spreadsheets",
  "aud": "https://oauth2.googleapis.com/token",
  "iat": 1715000000,
  "exp": 1715003600
}
```

- `iss` — the service account's email address (identifies who is making the claim)
- `scope` — the exact Google API permission being requested; `spreadsheets` scope covers both read and write on any sheet the service account can access
- `aud` — the token endpoint; Google rejects JWTs addressed to anyone else
- `iat` / `exp` — issued-at and expiry as Unix timestamps; max lifetime is 1 hour

**Signature:**

The header and payload are signed using **RS256** (RSASSA-PKCS1-v1_5 with SHA-256) and the service account's RSA private key. This is the cryptographic proof that the request is genuine.

### Step 2 — Exchange the JWT for an Access Token

POST to Google's token endpoint:

```
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer
&assertion=<signed_jwt>
```

Google validates the JWT signature against the service account's public key (looked up via `client_email`), checks the claims, and returns:

```json
{
  "access_token": "ya29.c.b0...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

### Step 3 — Call the Sheets API

All Sheets API requests include the access token as a Bearer header:

```
Authorization: Bearer ya29.c.b0...
```

### Implementation in the App

#### Storing the Credentials

Since this app will never be published to a public app store, the simplest approach is to store the service account JSON key in the source tree and import it directly:

```
src/
  credentials/
    service-account.json   ← gitignored
```

Add `service-account.json` to `.gitignore`. The file is bundled into the app binary at build time, which is acceptable for a private personal app.

#### JWT Signing with `jose`

The `jose` library supports RS256 signing using the WebCrypto API, which is available in React Native via the Hermes engine (RN 0.71+). It handles PEM key parsing, JWT assembly, and signing without native modules.

```ts
import { SignJWT, importPKCS8 } from 'jose';
import serviceAccount from '../credentials/service-account.json';

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWT_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

async function fetchAccessToken(): Promise<string> {
  const privateKey = await importPKCS8(serviceAccount.private_key, 'RS256');

  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope: SCOPES })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(serviceAccount.client_email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent(JWT_GRANT)}&assertion=${jwt}`,
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description ?? 'Token fetch failed');
  return data.access_token;
}
```

**Note on key format:** Google's JSON key file contains the private key in PKCS#8 PEM format (the `-----BEGIN RSA PRIVATE KEY-----` or `-----BEGIN PRIVATE KEY-----` header). `importPKCS8` expects the PKCS#8 variant (`BEGIN PRIVATE KEY`). Google now issues PKCS#8 keys by default; if you see `BEGIN RSA PRIVATE KEY` (PKCS#1), convert it with `openssl pkcs8 -topk8 -nocrypt` before embedding.

#### Token Caching

Access tokens are valid for 1 hour. The app caches the token in memory and reuses it until 5 minutes before expiry, then fetches a new one:

```ts
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now() / 1000;
  if (cachedToken && cachedToken.expiresAt - now > 300) {
    return cachedToken.token;
  }
  const token = await fetchAccessToken();
  cachedToken = { token, expiresAt: now + 3600 };
  return token;
}
```

No persistence to disk is needed — the re-auth round trip is fast (~200 ms) and happens at most once per hour.

### Setup Checklist

1. Create a Google Cloud project (or reuse one).
2. Enable the **Google Sheets API** for that project.
3. Create a **Service Account** (IAM & Admin → Service Accounts).
4. Generate a **JSON key** for the service account and download it.
5. Open the target Google Sheet, click **Share**, and grant the service account's email address **Editor** access.
6. Place the downloaded JSON key at `src/credentials/service-account.json`.
7. Confirm `.gitignore` excludes that path.

---

## Sheets API Usage

The app makes three distinct API calls. All requests go to `https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}` and carry the `Authorization: Bearer <token>` header.

The spreadsheet ID is the long identifier in the sheet's URL (`/spreadsheets/d/<ID>/edit`) and is stored as a constant alongside the service account credentials.

### 1. List Sheets (Home Screen)

`spreadsheets.get` returns spreadsheet metadata including all sheet tabs:

```
GET https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}?fields=sheets.properties
```

The `fields` parameter limits the response to only sheet list data, avoiding the transfer of cell values for the whole spreadsheet. Response shape:

```json
{
  "sheets": [
    { "properties": { "sheetId": 0, "title": "Weight" } },
    { "properties": { "sheetId": 123456, "title": "Sleep" } }
  ]
}
```

The app uses `sheets[].properties.title` to render the home screen list. All sheets in the spreadsheet are shown; any sheet that doesn't follow the standard three-row format will simply fail gracefully when opened.

### 2. Fetch Column Metadata (Logging Screen)

When the user taps a sheet, the app reads the first three rows to build the form. The row-based range `1:3` returns all populated columns in those rows without needing to know the column count in advance:

```
GET https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/{encodedRange}
```

where `encodedRange` is `encodeURIComponent("SheetTitle!1:3")`. Sheet names containing spaces or single quotes must be wrapped in single quotes in the range string (with internal single quotes doubled): `'My Sheet'!1:3`.

Response shape:

```json
{
  "range": "Weight!A1:D3",
  "majorDimension": "ROWS",
  "values": [
    ["Date", "Weight (kg)", "Notes"],
    ["date", "float", "text"],
    ["TRUE", "TRUE", "FALSE"]
  ]
}
```

**Important:** The API trims trailing empty cells from each row. If the last column has no entry in row 2 or row 3, those arrays will be shorter than row 1's. In this case, the app should just show an error to the user saying the sheet is incorrectly formatted.

If the sheet is completely empty the response omits the `values` key entirely; the app should show "No data in sheet" to the user.

### 3. Append a Row (Form Submission)

`spreadsheets.values.append` scans down from the anchor cell to find the first empty row after existing data and writes there:

```
POST https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/{encodedRange}:append
     ?valueInputOption=USER_ENTERED
     &insertDataOption=INSERT_ROWS
```

where `encodedRange` is `encodeURIComponent("SheetTitle!A1")`. The anchor `A1` tells the API where the table starts; it locates the append point automatically.

Request body:

```json
{
  "values": [["2024-05-10", "72.5", "", "good"]]
}
```

- **`valueInputOption=USER_ENTERED`**: Sheets interprets values as if a human typed them — dates parse into date cells, numbers stay numeric, `TRUE`/`FALSE` become booleans.
- **`insertDataOption=INSERT_ROWS`**: Physically inserts a new row rather than writing into the first empty cell. This is safer than the default `OVERWRITE` if anything exists below the table (e.g., a summary formula).
- Every column must have an entry in the array, using `""` for optional fields left blank, to preserve column alignment.

Response on success:

```json
{
  "spreadsheetId": "...",
  "tableRange": "Weight!A1:D6",
  "updates": {
    "updatedRange": "Weight!A7:D7",
    "updatedRows": 1,
    "updatedColumns": 4,
    "updatedCells": 4
  }
}
```

### Implementation

```ts
const SPREADSHEET_ID = 'your-spreadsheet-id-here';
const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

async function listSheets(token: string): Promise<string[]> {
  const res = await fetch(`${BASE}?fields=sheets.properties`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? 'listSheets failed');
  return (data.sheets as any[]).map(s => s.properties.title as string);
}

function sheetRange(title: string, range: string): string {
  // Single-quote sheet names that contain spaces, quotes, or special chars.
  const safe = /[ !'"]/.test(title) ? `'${title.replace(/'/g, "''")}'` : title;
  return encodeURIComponent(`${safe}!${range}`);
}

async function fetchMetadata(token: string, sheetTitle: string): Promise<string[][]> {
  const res = await fetch(`${BASE}/values/${sheetRange(sheetTitle, '1:3')}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? 'fetchMetadata failed');
  return (data.values as string[][] | undefined) ?? [];
}

async function appendRow(token: string, sheetTitle: string, row: string[]): Promise<void> {
  const url =
    `${BASE}/values/${sheetRange(sheetTitle, 'A1')}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? 'appendRow failed');
}
```

---

## Screens / navigation

### File layout (Expo Router)

```
app/
  index.tsx          ← Home screen
  sheet/
    [title].tsx      ← Logging screen; sheet title passed as URL param
```

The sheet title is passed via Expo Router's dynamic segment. Because sheet names may contain spaces or special characters, encode with `encodeURIComponent` when pushing and decode with `decodeURIComponent` when reading the param.

### Home screen

Displays a list of all sheet names fetched from the spreadsheet. States:

- **Loading** — spinner shown while the access token and sheet list are being fetched (these happen on mount).
- **Error** — if the token fetch or `listSheets` call fails, show an error message with a Retry button.
- **Loaded** — flat list of sheet name labels; tapping one navigates to `sheet/[title]`.

### Logging screen (sheet input screen)

Displays the dynamically generated form for the selected sheet. The sheet name is shown as the screen's navigation title via `<Stack.Screen options={{ title }} />`. There is a back chevron (Expo Router default) to return to the home screen.

States:

- **Loading** — spinner shown while column metadata is being fetched on mount.
- **Error** — if the metadata fetch fails, show an error message with a Retry button.
- **Loaded** — the form is rendered. On submit:
  - A spinner replaces the submit button while the append request is in flight.
  - On success: show a brief inline "Logged!" confirmation, then reset all fields.
  - On failure: show an inline error message; the form data is preserved so the user can retry.

---

## Dynamic Form Generation

The metadata for a sheet is contained in the first 3 rows.
- Row 1: name of each column, which is shown as a form input label
- Row 2: type of each column, which determines the type of input widget used
- Row 3: required flag, which determines whether input data is required to submit the form

### Row 3 parsing

Row 3 cells are treated as required (`true`) if their value, after trimming whitespace and converting to uppercase, equals `"TRUE"`. Any other value (including empty) is treated as not required.

### Allowed input types

The values in row 2 of the spreadsheet may be one of the following:
- `date`: show a date picker; defaults to today's date
- `float`: show a numeric input (decimal keyboard)
- `integer`: show a numeric input (integer keyboard); the value submitted must be a whole number
- `text`: show a free text input
- `enum:{value1}|{value2}...`: show a select dropdown with the allowed options, given as a `|`-separated list
- `boolean`: show a checkbox, unchecked as default (value written to spreadsheet should be TRUE or FALSE)

### Form validation

Validation runs when the user taps Submit. No errors are shown before submission is attempted.

- A required field that is empty blocks submission.
- An `integer` field whose value is not a whole number blocks submission.

Each failing field displays an inline error message directly below the input. The submit request is not made until all fields pass validation.