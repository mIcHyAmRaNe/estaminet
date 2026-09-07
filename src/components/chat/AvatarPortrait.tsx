import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../../api/tauri";
import { Midas } from "../../lib/midas/renderer";

// Portraits rendered via <img src=dataURL>: the Midas canvas is rendered
// OFFSCREEN (never attached to the DOM) then captured as PNG. An <img> is
// immune to the WebKitGTK repaint bugs (267986/218292) that wiped live
// canvases on resize / DOM moves.
//
// Module cache per login (lower key): dataURL + source JSON. The JSON is
// kept to invalidate the dataURL when the portrait changes (clothes,
// face). The cache survives tavern changes: key = login, and a stale entry
// is automatically fixed by JSON comparison on the next fetch — keeping it
// avoids a re-render on every tavern entry.
interface PortraitEntry {
  json: string;
  dataUrl: string;
}
const portraitCache = new Map<string, PortraitEntry>();
const PORTRAIT_CACHE_MAX = 200;

function cachePortrait(key: string, entry: PortraitEntry): void {
  if (!entry.dataUrl) return;
  if (!portraitCache.has(key) && portraitCache.size >= PORTRAIT_CACHE_MAX) {
    const oldest = portraitCache.keys().next();
    if (!oldest.done) portraitCache.delete(oldest.value);
  }
  portraitCache.set(key, entry);
}

// In-flight offscreen renders, per login: several cards mounted at the
// same time (tavern + first display) share a single render instead of
// duplicating network fetches and canvas drawing.
const inFlight = new Map<string, Promise<PortraitEntry | null>>();

function renderOffscreen(json: string): Promise<PortraitEntry | null> {
  return Midas.genereCanvasDepuisJSON(json).then((resultat) => {
    if (!resultat) return null;
    try {
      const dataUrl = resultat.canvas.toDataURL("image/png");
      return { json, dataUrl };
    } catch (e) {
      // Tainted canvas (unexpected: ACAO:* verified on the CDN) — fail clean.
      console.warn("[AvatarPortrait] toDataURL failed", e);
      return null;
    }
  });
}

// Render + capture + cache, deduplicating concurrent calls for the same
// login. The JSON is already in hand (fetch done by the caller).
function renderAndCache(key: string, json: string): Promise<PortraitEntry | null> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = renderOffscreen(json)
    .then((entry) => {
      if (entry) cachePortrait(key, entry);
      return entry;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
}

// DOM structure identical to the old Midas render (root __mini + gender
// class): the existing CSS (__homme/__femme cropping, medallion) applies
// as-is to the <img class=__calque>.
function buildPortraitImg(dataUrl: string, sexe: string): HTMLDivElement {
  const racine = document.createElement("div");
  racine.classList.add("apercu_personnage_rar", "apercu_personnage_rar__mini");
  racine.classList.add(sexe === "M" ? "apercu_personnage_rar__homme" : "apercu_personnage_rar__femme");
  const img = document.createElement("img");
  img.classList.add("apercu_personnage_rar__calque");
  img.src = dataUrl;
  img.alt = "";
  img.draggable = false;
  racine.appendChild(img);
  return racine;
}

export default function AvatarPortrait({ login }: { login: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  // Case-insensitive stable key: the hook provides the ucfirst display
  // while the raw login may vary in case for the same player.
  const stableKey = login.toLowerCase();

  useEffect(() => {
    if (!login) return;
    const lower = stableKey;
    setLoaded(false);
    let stale = false;
    let retryTimerId: ReturnType<typeof setTimeout> | null = null;

    const show = (entry: PortraitEntry): boolean => {
      if (stale || !boxRef.current) return false;
      const racine = buildPortraitImg(entry.dataUrl, sexeOf(entry.json));
      const box = boxRef.current;
      box.innerHTML = "";
      box.appendChild(racine);
      setLoaded(true);
      return true;
    };

    // 1) Cache: instant display, no network, no rendering.
    const cached = portraitCache.get(lower);
    if (cached) show(cached);

    // 2) Fresh JSON (fetch + bounded retry 1 + 2, as before): if the JSON
    // changed since the cache, offscreen re-render → dataURL → cache → <img>.
    const FETCH_MAX_ATTEMPTS = 3;
    const FETCH_RETRY_DELAYS_MS = [1500, 3000];
    let attempt = 0;
    const tryFetch = () => {
      if (stale) return;
      attempt += 1;
      api
        .getPortraitJson(login)
        .then((jsonStr: string) => {
          if (stale || !jsonStr) return;
          if (portraitCache.get(lower)?.json === jsonStr) return; // already shown
          return renderAndCache(lower, jsonStr).then((entry) => {
            if (entry) show(entry);
          });
        })
        .catch((err: unknown) => {
          if (stale) return;
          if (attempt < FETCH_MAX_ATTEMPTS) {
            console.warn(
              `[AvatarPortrait] portrait "${login}": attempt ${attempt}/${FETCH_MAX_ATTEMPTS} failed (${String(err)}) — retrying`,
            );
            retryTimerId = setTimeout(() => {
              if (!stale) tryFetch();
            }, FETCH_RETRY_DELAYS_MS[attempt - 1] ?? 3000);
          } else {
            console.warn(
              `[AvatarPortrait] portrait "${login}": giving up after ${attempt} attempts (${String(err)}) — ${
                cached ? "cache shown" : "letter shown"
              }`,
            );
          }
        });
    };
    tryFetch();

    return () => {
      stale = true;
      if (retryTimerId) clearTimeout(retryTimerId);
    };
    // Deliberately stable dependency (lower): preserves display across
    // case variations of the same login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableKey]);

  return (
    <div ref={boxRef} style={{ width: "100%", height: "100%", overflow: "hidden", display: "flex", alignItems: "flex-start", justifyContent: "center", position: "relative" }}>
      {!loaded && (
        <span
          class="portrait-fallback"
          style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", fontWeight: 700, color: "#ddbfaa", zIndex: 1 }}
        >
          {login.charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
}

// Gender encoded in the portrait JSON ("M"/"F"): drives the __homme/__femme
// cropping class. Defaults to "F" on unreadable JSON (like Midas).
function sexeOf(json: string): string {
  try {
    return JSON.parse(json)?.sexe === "M" ? "M" : "F";
  } catch {
    return "F";
  }
}
