import { useMemo } from "preact/hooks";
import { RK_BASE } from "../../lib/config";

interface Props {
  text: string;
  // Display logins of the other players (presence list). Matched
  // case-insensitively against the message text (official .lienPerso).
  players: string[];
  // Joined-lower memo key for `players` (the array identity changes every
  // render): the parent computes it once per render so the scan below only
  // re-runs when the text or the player set actually changes.
  playersKey: string;
  // Author login: never linkified (the header already shows it).
  skipLogin?: string;
}

// Same profile URL pattern as PlayerMenu (official FichePersonnage.php).
export function profileUrl(login: string): string {
  return `${RK_BASE}/FichePersonnage.php?login=${encodeURIComponent(login)}`;
}

// Login alphabet (official logins: unicode letters, digits, _ and -).
// A match must sit on name boundaries so "Marc" doesn't hit "Marco".
function isNameChar(ch: string): boolean {
  return /[\p{L}\p{N}_-]/u.test(ch);
}

type Chunk =
  | { kind: "text"; value: string }
  | { kind: "link"; login: string; display: string };

// Lane F2 — lienPerso: plain single-pass string scan (longest names first,
// no regex overkill). Names < 2 chars are skipped (too noisy).
export default function LinkifiedText({ text, players, playersKey, skipLogin }: Props) {
  const chunks = useMemo<Chunk[]>(() => {
    const skipLower = (skipLogin ?? "").trim().toLowerCase();
    const seen = new Set<string>();
    const names: string[] = [];
    const byLength = [...players].sort((a, b) => b.length - a.length);
    for (const p of byLength) {
      const clean = p.trim();
      if (clean.length < 2) continue;
      const lower = clean.toLowerCase();
      if (lower === skipLower || seen.has(lower)) continue;
      seen.add(lower);
      names.push(clean);
    }
    if (names.length === 0 || !text) return [{ kind: "text", value: text }];
    const lowered = names.map((n) => n.toLowerCase());
    const lowerText = text.toLowerCase();
    const out: Chunk[] = [];
    let i = 0;
    while (i < text.length) {
      let hit = -1;
      for (let k = 0; k < names.length; k++) {
        const n = lowered[k]!;
        if (!lowerText.startsWith(n, i)) continue;
        const before = i > 0 ? text[i - 1]! : "";
        const after = i + n.length < text.length ? text[i + n.length]! : "";
        if ((before === "" || !isNameChar(before)) && (after === "" || !isNameChar(after))) {
          hit = k;
          break;
        }
      }
      if (hit === -1) {
        const ch = text[i]!;
        const last = out[out.length - 1];
        if (last && last.kind === "text") last.value += ch;
        else out.push({ kind: "text", value: ch });
        i++;
      } else {
        const login = names[hit]!;
        out.push({ kind: "link", login, display: text.slice(i, i + login.length) });
        i += login.length;
      }
    }
    return out;
    // `players` is consumed via `playersKey` (same content ⇒ same key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, playersKey, skipLogin]);

  return (
    <>
      {chunks.map((c, idx) =>
        c.kind === "text" ? (
          <span key={idx}>{c.value}</span>
        ) : (
          <a
            key={idx}
            class="lien-perso"
            href={profileUrl(c.login)}
            target="_blank"
            rel="noreferrer"
            onClick={(e: Event) => e.stopPropagation()}
          >
            {c.display}
          </a>
        ),
      )}
    </>
  );
}
