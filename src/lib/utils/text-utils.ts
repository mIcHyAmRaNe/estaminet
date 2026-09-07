// Search normalization: case- and accent-insensitive.
// "Éléonore" → "eleonore" — used by tavern and town search.
export function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}
