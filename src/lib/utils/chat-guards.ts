/**
 * Shared chopine / chope detection helpers.
 * Used by ChatRoom and MessageList to avoid duplication.
 */
export function isChopineText(content: string): boolean {
  const c = content.toLowerCase();
  return c.includes("chopine") || c.includes("chope") || c.includes("verre");
}

/** Alias kept for backwards compat with MessageList's isChopine */
export const isChopine = isChopineText;
