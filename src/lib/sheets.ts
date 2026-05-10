import { SPREADSHEET_ID } from './config';

const BASE = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function sheetRange(title: string, range: string): string {
  const safe = /[ !'"]/.test(title) ? `'${title.replace(/'/g, "''")}'` : title;
  return encodeURIComponent(`${safe}!${range}`);
}

export async function listSheets(token: string): Promise<string[]> {
  const res = await fetch(`${BASE}?fields=sheets.properties`, {
    headers: authHeader(token),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? 'listSheets failed');
  return (data.sheets as any[]).map((s) => s.properties.title as string);
}

export async function fetchMetadata(token: string, sheetTitle: string): Promise<string[][]> {
  const res = await fetch(`${BASE}/values/${sheetRange(sheetTitle, '1:3')}`, {
    headers: authHeader(token),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? 'fetchMetadata failed');
  return (data.values as string[][] | undefined) ?? [];
}

export async function appendRow(token: string, sheetTitle: string, row: string[]): Promise<void> {
  const url =
    `${BASE}/values/${sheetRange(sheetTitle, 'A1')}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...authHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? 'appendRow failed');
}
