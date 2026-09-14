// Canonical login helpers (moved from useTaverne.ts:26-30 — single source).
// Case-insensitive keys (lower) + ucfirst display (official JS mirror).

export function loginKey(login: string): string {
  return login.trim().toLowerCase();
}

export function displayLogin(login: string): string {
  const clean = login.trim();
  if (!clean) return clean;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
